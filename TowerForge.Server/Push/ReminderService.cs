using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace TowerForge.Server.Push;

// ============================================================
//  Sends lab reminders when they're due (checked every 30 s):
//  each one encrypted for its browser (WebPush.Encrypt) and signed
//  with TowerForge's key (VAPID), then deleted whether it went or
//  not, so nothing is retried forever. A browser that unsubscribed
//  (the push service answers 404 or 410) loses all its reminders.
//  The keys are made once and kept in push-keys.json in the data
//  directory — on the server only, never in the repo.
// ============================================================
public sealed class ReminderService(ReminderStore store, PushKeys keys, IHttpClientFactory http, ILogger<ReminderService> log) : BackgroundService
{
    public const string HttpClientName = "web-push";
    private const string Subject = "https://towerforge.net";
    private static readonly TimeSpan Every = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        using var tick = new PeriodicTimer(Every);
        try
        {
            do
            {
                try
                {
                    foreach (var r in await store.DueAsync(DateTimeOffset.UtcNow))
                    {
                        await SendAsync(r, stop);
                        await store.DeleteAsync(r.Id);
                    }
                }
                catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException or IOException)
                {
                    log.LogWarning("Lab reminders: {Error}", ex.Message);
                }
            } while (await tick.WaitForNextTickAsync(stop));
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
    }

    private async Task SendAsync(ReminderStore.Reminder r, CancellationToken stop)
    {
        try
        {
            var payload = JsonSerializer.SerializeToUtf8Bytes(new { title = r.Title, body = r.Body, url = r.Url, tag = $"lab-{r.Id}" });
            var body = WebPush.Encrypt(payload, WebPush.FromB64Url(r.P256dh), WebPush.FromB64Url(r.Auth));
            using var req = new HttpRequestMessage(HttpMethod.Post, r.Endpoint) { Content = new ByteArrayContent(body) };
            req.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            req.Content.Headers.ContentEncoding.Add("aes128gcm");
            req.Headers.TryAddWithoutValidation("Authorization", WebPush.VapidAuthorization(r.Endpoint, keys.Keys, Subject, DateTimeOffset.UtcNow));
            req.Headers.Add("TTL", "86400");      // a phone that's off gets it within a day, or not at all
            req.Headers.Add("Urgency", "normal");
            using var res = await http.CreateClient(HttpClientName).SendAsync(req, stop);
            if (res.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
                await store.DeleteEndpointAsync(r.Endpoint);
            else if (!res.IsSuccessStatusCode)
                log.LogWarning("Lab reminder not accepted by the push service: {Status}", (int)res.StatusCode);
        }
        catch (Exception ex) when (!stop.IsCancellationRequested && ex is HttpRequestException or TaskCanceledException or ArgumentException or FormatException or System.Security.Cryptography.CryptographicException)
        {
            log.LogWarning("Lab reminder couldn't be sent: {Error}", ex.Message);
        }
    }
}

// TowerForge's VAPID key pair: made on first start, then read from the data directory.
public sealed class PushKeys
{
    public VapidKeys Keys { get; }

    public PushKeys(string path, ILogger<PushKeys> log)
    {
        if (File.Exists(path))
        {
            Keys = JsonSerializer.Deserialize<VapidKeys>(File.ReadAllText(path))
                ?? throw new InvalidDataException($"{path} is empty");
            return;
        }
        Keys = WebPush.NewVapidKeys();
        File.WriteAllText(path, JsonSerializer.Serialize(Keys));
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        log.LogInformation("Made TowerForge's push keys in {Path}", path);
    }
}
