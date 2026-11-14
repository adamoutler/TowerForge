using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TowerForge.Server.Push;
using Xunit;

namespace TowerForge.Server.Tests;

// ============================================================
//  Web Push: the encryption matches RFC 8291's own worked example
//  (Appendix A, byte for byte), the VAPID token verifies with the
//  public key and says the right things, and only push services'
//  addresses are accepted.
// ============================================================
public class WebPushTests
{
    [Fact]
    public void Encrypts_RFC_8291_Appendix_A_byte_for_byte()
    {
        var body = WebPush.Encrypt(
            plaintext: Encoding.UTF8.GetBytes("When I grow up, I want to be a watermelon"),
            uaPublic: WebPush.FromB64Url("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
            authSecret: WebPush.FromB64Url("BTBZMqHH6r4Tts7J_aSIgg"),
            asPrivate: WebPush.FromB64Url("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
            asPublic: WebPush.FromB64Url("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"),
            salt: WebPush.FromB64Url("DGv6ra1nlYgDCS1FRnbzlw"));
        Assert.Equal(
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
            WebPush.B64Url(body));
    }

    [Fact]
    public void Signs_a_VAPID_token_the_push_service_can_check()
    {
        var keys = WebPush.NewVapidKeys();
        var now = DateTimeOffset.FromUnixTimeSeconds(1_800_000_000);
        var auth = WebPush.VapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, "https://towerforge.net", now);
        Assert.StartsWith("vapid t=", auth);
        Assert.EndsWith($", k={keys.PublicKey}", auth);
        var jwt = auth["vapid t=".Length..auth.IndexOf(',')].Split('.');

        var claims = JsonDocument.Parse(WebPush.FromB64Url(jwt[1])).RootElement;
        Assert.Equal("https://fcm.googleapis.com", claims.GetProperty("aud").GetString());
        Assert.Equal(now.AddHours(12).ToUnixTimeSeconds(), claims.GetProperty("exp").GetInt64());
        Assert.Equal("https://towerforge.net", claims.GetProperty("sub").GetString());

        var pub = WebPush.FromB64Url(keys.PublicKey);
        using var verifier = ECDsa.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = pub[1..33], Y = pub[33..65] },
        });
        Assert.True(verifier.VerifyData(Encoding.ASCII.GetBytes($"{jwt[0]}.{jwt[1]}"), WebPush.FromB64Url(jwt[2]), HashAlgorithmName.SHA256));
    }

    [Theory]
    [InlineData("https://fcm.googleapis.com/fcm/send/abc", true)]
    [InlineData("https://updates.push.services.mozilla.com/wpush/v2/abc", true)]
    [InlineData("https://web.push.apple.com/QGuQ", true)]
    [InlineData("https://wns2-bl2p.notify.windows.com/w/?token=abc", true)]
    [InlineData("http://fcm.googleapis.com/fcm/send/abc", false)]        // not https
    [InlineData("https://fcm.googleapis.com:8443/x", false)]             // another port
    [InlineData("https://evil.example/fcm.googleapis.com", false)]
    [InlineData("https://127.0.0.1/x", false)]
    [InlineData("https://push.apple.com.evil.example/x", false)]
    public void Accepts_only_push_services(string endpoint, bool ok) => Assert.Equal(ok, WebPush.IsPushService(endpoint));
}
