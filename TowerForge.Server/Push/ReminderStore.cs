using Microsoft.Data.Sqlite;
using TowerForge.Server.Data;

namespace TowerForge.Server.Push;

// ============================================================
//  Reminders waiting to be sent (table push_reminders): lab finished
//  ("labs") and tournament day ("tourney"). One row per reminder: the
//  browser's push address and its two keys (what Web Push needs to
//  reach and encrypt for that browser), the notification's words and
//  where it opens, and when to send it. No account, no IP. A browser's
//  rows of a kind are replaced whenever it sends that kind again,
//  deleted when it turns that kind off, each one once it's sent, and
//  anything left after 45 days (docs/privacy.md).
// ============================================================
public sealed class ReminderStore(AppDb db)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(45);
    public static readonly string[] Kinds = ["labs", "tourney"];

    public sealed record Reminder(long Id, string Endpoint, string P256dh, string Auth, string Title, string Body, string Url);
    public sealed record NewReminder(string Title, string Body, string Url, DateTimeOffset At);

    // This browser's reminders of one kind, in place of the ones it had.
    public async Task ReplaceAsync(string endpoint, string kind, string p256dh, string auth, IReadOnlyList<NewReminder> reminders)
    {
        await using var conn = await db.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        await using (var del = conn.CreateCommand())
        {
            del.CommandText = "DELETE FROM push_reminders WHERE endpoint = $e AND kind = $kind";
            del.Parameters.AddWithValue("$e", endpoint);
            del.Parameters.AddWithValue("$kind", kind);
            await del.ExecuteNonQueryAsync();
        }
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        foreach (var r in reminders)
        {
            await using var ins = conn.CreateCommand();
            ins.CommandText = """
                INSERT INTO push_reminders (endpoint, kind, p256dh, auth, title, body, url, due_at, created_at)
                VALUES ($e, $kind, $k, $a, $t, $b, $u, $d, $c)
                """;
            ins.Parameters.AddWithValue("$e", endpoint);
            ins.Parameters.AddWithValue("$kind", kind);
            ins.Parameters.AddWithValue("$k", p256dh);
            ins.Parameters.AddWithValue("$a", auth);
            ins.Parameters.AddWithValue("$t", r.Title);
            ins.Parameters.AddWithValue("$b", r.Body);
            ins.Parameters.AddWithValue("$u", r.Url);
            ins.Parameters.AddWithValue("$d", r.At.ToUnixTimeSeconds());
            ins.Parameters.AddWithValue("$c", now);
            await ins.ExecuteNonQueryAsync();
        }
        await tx.CommitAsync();
    }

    // One kind of this browser's reminders, or all of them (kind null).
    public async Task DeleteEndpointAsync(string endpoint, string? kind = null)
    {
        await using var conn = await db.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = kind is null
            ? "DELETE FROM push_reminders WHERE endpoint = $e"
            : "DELETE FROM push_reminders WHERE endpoint = $e AND kind = $kind";
        cmd.Parameters.AddWithValue("$e", endpoint);
        if (kind is not null) cmd.Parameters.AddWithValue("$kind", kind);
        await cmd.ExecuteNonQueryAsync();
    }

    // Due now, oldest first; and anything past its lifetime goes.
    public async Task<List<Reminder>> DueAsync(DateTimeOffset now, int limit = 100)
    {
        await using var conn = await db.OpenAsync();
        await using (var old = conn.CreateCommand())
        {
            old.CommandText = "DELETE FROM push_reminders WHERE created_at < $old";
            old.Parameters.AddWithValue("$old", (now - Lifetime).ToUnixTimeSeconds());
            await old.ExecuteNonQueryAsync();
        }
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, endpoint, p256dh, auth, title, body, url FROM push_reminders WHERE due_at <= $now ORDER BY due_at LIMIT $n";
        cmd.Parameters.AddWithValue("$now", now.ToUnixTimeSeconds());
        cmd.Parameters.AddWithValue("$n", limit);
        var list = new List<Reminder>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            list.Add(new Reminder(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4), r.GetString(5), r.GetString(6)));
        return list;
    }

    public async Task DeleteAsync(long id)
    {
        await using var conn = await db.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM push_reminders WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        await cmd.ExecuteNonQueryAsync();
    }
}
