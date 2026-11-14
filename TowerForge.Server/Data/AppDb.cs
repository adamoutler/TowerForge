using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace TowerForge.Server.Data;

// ============================================================
//  SQLite database: accounts, synced stats, and share codes.
//  One file in the data directory; the schema is created on
//  startup with CREATE ... IF NOT EXISTS, so it is safe to run
//  on every boot.
// ============================================================
public sealed class AppDb
{
    private readonly string _connectionString;

    public AppDb(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(dataDirectory, "towerforge.db"),
            ForeignKeys = true,
        }.ToString();
    }

    public async Task<SqliteConnection> OpenAsync()
    {
        var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync();
        return conn;
    }

    public void EnsureSchema()
    {
        using var conn = new SqliteConnection(_connectionString);
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT    NOT NULL,
                created_at    INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_saves (
                user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                data       TEXT    NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shares (
                code             TEXT    PRIMARY KEY,
                owner_id         INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                claim_token_hash TEXT    NULL,
                sections         TEXT    NOT NULL,
                data             TEXT    NOT NULL,
                created_at       INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS ix_shares_owner ON shares(owner_id);

            -- One recovery code per account (hashed like a password): it
            -- sets a new password when the old one is forgotten. issued_by
            -- 'player' (made while signed in) or 'owner' (the reset command).
            CREATE TABLE IF NOT EXISTS recovery_codes (
                user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                code_hash  TEXT    NOT NULL,
                created_at INTEGER NOT NULL,
                issued_by  TEXT    NOT NULL
            );

            -- Ask AI answers a player chose to send (👎 → Send): the question,
            -- the answer and what it looked at, as JSON. status 'open' or
            -- 'fixed'; read on the owner's AI reports page.
            CREATE TABLE IF NOT EXISTS ai_reports (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at INTEGER NOT NULL,
                status     TEXT    NOT NULL DEFAULT 'open',
                data       TEXT    NOT NULL
            );

            CREATE INDEX IF NOT EXISTS ix_ai_reports_created ON ai_reports(created_at);

            -- Lab reminders waiting to be sent (Push/ReminderStore.cs): a
            -- browser's push address and keys, the words, the page and when.
            CREATE TABLE IF NOT EXISTS push_reminders (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                endpoint   TEXT    NOT NULL,
                p256dh     TEXT    NOT NULL,
                auth       TEXT    NOT NULL,
                title      TEXT    NOT NULL,
                body       TEXT    NOT NULL,
                url        TEXT    NOT NULL,
                due_at     INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS ix_push_reminders_due ON push_reminders(due_at);
            CREATE INDEX IF NOT EXISTS ix_push_reminders_endpoint ON push_reminders(endpoint);
            """;
        cmd.ExecuteNonQuery();
    }

    // Shares used to be one JSON file each ({ createdAt, data }). Pull any
    // that are still on disk into the database, then move the file into an
    // "imported" folder so it is never imported twice.
    public void ImportLegacyShares(string directory, ILogger logger)
    {
        if (!Directory.Exists(directory)) return;

        var files = Directory.GetFiles(directory, "*.json");
        if (files.Length == 0) return;

        var importedDir = Path.Combine(directory, "imported");
        Directory.CreateDirectory(importedDir);

        using var conn = new SqliteConnection(_connectionString);
        conn.Open();

        foreach (var file in files)
        {
            try
            {
                var record = JsonNode.Parse(File.ReadAllText(file))?.AsObject();
                var data = record?["data"]?.AsObject();
                var createdAt = record?["createdAt"]?.GetValue<string>();
                if (data is null || createdAt is null) continue;

                using var cmd = conn.CreateCommand();
                cmd.CommandText = """
                    INSERT OR IGNORE INTO shares (code, owner_id, claim_token_hash, sections, data, created_at)
                    VALUES ($code, NULL, NULL, $sections, $data, $createdAt)
                    """;
                cmd.Parameters.AddWithValue("$code", Path.GetFileNameWithoutExtension(file).ToUpperInvariant());
                cmd.Parameters.AddWithValue("$sections", ShareStore.SectionsOf(data));
                cmd.Parameters.AddWithValue("$data", data.ToJsonString());
                cmd.Parameters.AddWithValue("$createdAt", DateTimeOffset.Parse(createdAt).ToUnixTimeSeconds());
                cmd.ExecuteNonQuery();

                File.Move(file, Path.Combine(importedDir, Path.GetFileName(file)), overwrite: true);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Could not import legacy share file {File}", file);
            }
        }
    }
}
