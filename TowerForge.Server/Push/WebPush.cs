using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace TowerForge.Server.Push;

// ============================================================
//  Web Push, the two standards it takes, with .NET's own crypto
//  (no outside package):
//   • RFC 8291 — the notification is encrypted for the one browser
//     that asked (aes128gcm: ECDH P-256 with the browser's key, HKDF,
//     AES-128-GCM), so the push service that carries it (Google,
//     Apple, Mozilla, Microsoft — whichever the browser uses) can't
//     read it. Checked against RFC 8291 Appendix A
//     (TowerForge.Server.Tests/WebPushTests.cs).
//   • RFC 8292 (VAPID) — a signed token (ES256 JWT) tells the push
//     service the message comes from TowerForge's key.
//  Pure functions; ReminderService does the sending.
// ============================================================
public static class WebPush
{
    public const int RecordSize = 4096;

    public static string B64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static byte[] FromB64Url(string s)
    {
        var b = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(b.PadRight(b.Length + (4 - b.Length % 4) % 4, '='));
    }

    // An uncompressed P-256 point (0x04 ‖ X ‖ Y) as a key.
    private static ECParameters Point(byte[] uncompressed, byte[]? d = null)
    {
        if (uncompressed.Length != 65 || uncompressed[0] != 4) throw new ArgumentException("Not an uncompressed P-256 key.");
        return new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = uncompressed[1..33], Y = uncompressed[33..65] },
            D = d,
        };
    }

    private static byte[] Uncompressed(ECParameters p) => [4, .. p.Q.X!, .. p.Q.Y!];

    private static byte[] Hmac(byte[] key, params byte[][] parts) =>
        HMACSHA256.HashData(key, parts.SelectMany(x => x).ToArray());

    // RFC 8291 §3.4: the body for one browser. asPrivate/salt are for the
    // RFC's own test values; normally both are new for every message.
    public static byte[] Encrypt(byte[] plaintext, byte[] uaPublic, byte[] authSecret, byte[]? asPrivate = null, byte[]? asPublic = null, byte[]? salt = null)
    {
        if (authSecret.Length != 16) throw new ArgumentException("The auth secret is 16 bytes.");
        using var server = asPrivate is null ? ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256)
            : ECDiffieHellman.Create(Point(asPublic!, asPrivate));
        var serverPublic = Uncompressed(server.ExportParameters(false));
        using var browser = ECDiffieHellman.Create(Point(uaPublic));
        var ecdhSecret = server.DeriveRawSecretAgreement(browser.PublicKey);

        // Combine the ECDH secret with the browser's auth secret…
        var prkKey = Hmac(authSecret, ecdhSecret);
        var keyInfo = Encoding.ASCII.GetBytes("WebPush: info\0").Concat(uaPublic).Concat(serverPublic).ToArray();
        var ikm = Hmac(prkKey, keyInfo, [1]);
        // …then the content key and nonce from it and a fresh salt.
        salt ??= RandomNumberGenerator.GetBytes(16);
        var prk = Hmac(salt, ikm);
        var cek = Hmac(prk, Encoding.ASCII.GetBytes("Content-Encoding: aes128gcm\0"), [1])[..16];
        var nonce = Hmac(prk, Encoding.ASCII.GetBytes("Content-Encoding: nonce\0"), [1])[..12];

        // One record: the text, then 0x02 (the last record's delimiter).
        var padded = new byte[plaintext.Length + 1];
        plaintext.CopyTo(padded, 0);
        padded[^1] = 2;
        if (padded.Length + 16 > RecordSize) throw new ArgumentException("The notification is too long for one record.");
        var cipher = new byte[padded.Length];
        var tag = new byte[16];
        using (var gcm = new AesGcm(cek, 16)) gcm.Encrypt(nonce, padded, cipher, tag);

        // Header: salt ‖ record size ‖ key length ‖ the server's one-off public key.
        var header = new byte[16 + 4 + 1 + serverPublic.Length];
        salt.CopyTo(header, 0);
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(16, 4), RecordSize);
        header[20] = (byte)serverPublic.Length;
        serverPublic.CopyTo(header, 21);
        return [.. header, .. cipher, .. tag];
    }

    // RFC 8292: "vapid t=<signed token>, k=<TowerForge's public key>" for
    // the push service the endpoint belongs to; good for 12 hours.
    public static string VapidAuthorization(string endpoint, VapidKeys keys, string subject, DateTimeOffset now)
    {
        var uri = new Uri(endpoint);
        var audience = $"{uri.Scheme}://{uri.Authority}";
        var header = B64Url(JsonSerializer.SerializeToUtf8Bytes(new { typ = "JWT", alg = "ES256" }));
        var claims = B64Url(JsonSerializer.SerializeToUtf8Bytes(new { aud = audience, exp = now.AddHours(12).ToUnixTimeSeconds(), sub = subject }));
        using var signer = ECDsa.Create(Point(FromB64Url(keys.PublicKey), FromB64Url(keys.PrivateKey)));
        // ES256 wants r ‖ s (IEEE P1363), which SignData gives by default.
        var signature = signer.SignData(Encoding.ASCII.GetBytes($"{header}.{claims}"), HashAlgorithmName.SHA256);
        return $"vapid t={header}.{claims}.{B64Url(signature)}, k={keys.PublicKey}";
    }

    public static VapidKeys NewVapidKeys()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var p = key.ExportParameters(true);
        return new VapidKeys(B64Url(Uncompressed(p)), B64Url(p.D!));
    }

    // Push services TowerForge sends to (each browser's own); anything else
    // is refused, so a made-up address can't make the server call a site.
    private static readonly string[] PushHosts =
        ["fcm.googleapis.com", "updates.push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];

    public static bool IsPushService(string endpoint) =>
        Uri.TryCreate(endpoint, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps && u.IsDefaultPort
        && PushHosts.Any(h => h.StartsWith('.') ? u.Host.EndsWith(h, StringComparison.OrdinalIgnoreCase) : u.Host.Equals(h, StringComparison.OrdinalIgnoreCase));
}

// TowerForge's push key pair (base64url): public = the 65-byte point, private = d.
public sealed record VapidKeys(string PublicKey, string PrivateKey);
