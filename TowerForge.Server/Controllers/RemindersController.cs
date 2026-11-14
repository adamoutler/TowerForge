using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using TowerForge.Server.Push;

namespace TowerForge.Server.Controllers;

// ============================================================
//  Lab reminders (Profile → "Remind me"): a browser that allowed
//  notifications sends its push address and the times its labs
//  finish; the server sends a notification at each (ReminderService).
//    GET  /api/reminders/key   TowerForge's public push key
//    PUT  /api/reminders       { subscription: { endpoint, keys: { p256dh, auth } },
//                                reminders: [{ title, body, url, at (ms) }] }
//                              replaces that browser's reminders ([] = none)
//    POST /api/reminders/off   { endpoint } — forget this browser
//  No account needed; nothing about the player beyond the lab names and
//  times. Rate limited per IP.
// ============================================================
[ApiController]
[Route("api/reminders")]
public partial class RemindersController(ReminderStore store, PushKeys keys) : ControllerBase
{
    public const int MaxReminders = 12;

    public sealed record SubscriptionKeys(string P256dh, string Auth);
    public sealed record Subscription(string Endpoint, SubscriptionKeys Keys);
    public sealed record ReminderIn(string Title, string Body, string Url, long At);
    public sealed record PutRequest(Subscription Subscription, List<ReminderIn> Reminders);
    public sealed record OffRequest(string Endpoint);

    [HttpGet("key")]
    public IActionResult Key() => Ok(new { publicKey = keys.Keys.PublicKey });

    [HttpPut]
    [EnableRateLimiting("reminders")]
    [RequestSizeLimit(16 * 1024)]
    public async Task<IActionResult> Put([FromBody] PutRequest req)
    {
        var sub = req.Subscription;
        if (sub is null || !WebPush.IsPushService(sub.Endpoint ?? "") || sub.Endpoint!.Length > 1000)
            return BadRequest(new { error = "That isn't a browser's push address." });
        if (!KeyOk(sub.Keys?.P256dh, 65) || !KeyOk(sub.Keys?.Auth, 16))
            return BadRequest(new { error = "The browser's push keys are missing or wrong." });
        var list = req.Reminders ?? [];
        if (list.Count > MaxReminders) return BadRequest(new { error = $"At most {MaxReminders} reminders." });

        var now = DateTimeOffset.UtcNow;
        var clean = new List<ReminderStore.NewReminder>();
        foreach (var r in list)
        {
            var at = DateTimeOffset.FromUnixTimeMilliseconds(r.At);
            if (string.IsNullOrWhiteSpace(r.Title) || r.Title.Length > 100 || (r.Body?.Length ?? 0) > 200
                || !PagePath().IsMatch(r.Url ?? "") || at < now.AddMinutes(-1) || at > now.AddDays(60))
                return BadRequest(new { error = "A reminder isn't right (words, page or time)." });
            clean.Add(new ReminderStore.NewReminder(r.Title.Trim(), r.Body?.Trim() ?? "", r.Url!, at));
        }
        await store.ReplaceAsync(sub.Endpoint, sub.Keys!.P256dh, sub.Keys.Auth, clean);
        return Ok(new { count = clean.Count });
    }

    [HttpPost("off")]
    [EnableRateLimiting("reminders")]
    public async Task<IActionResult> Off([FromBody] OffRequest req)
    {
        if (!WebPush.IsPushService(req.Endpoint ?? "")) return BadRequest(new { error = "That isn't a browser's push address." });
        await store.DeleteEndpointAsync(req.Endpoint!);
        return Ok();
    }

    private static bool KeyOk(string? b64, int length)
    {
        try { return b64 is not null && WebPush.FromB64Url(b64).Length == length; }
        catch (FormatException) { return false; }
    }

    // A page of the site to open: "/labs", "/" — nothing else.
    [GeneratedRegex("^/[a-z-]{0,40}$")]
    private static partial Regex PagePath();
}
