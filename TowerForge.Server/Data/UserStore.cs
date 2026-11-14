using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;

namespace TowerForge.Server.Data;

// ============================================================
//  Accounts and their synced stats.
//  Passwords are hashed with ASP.NET Core Identity's
//  PasswordHasher (PBKDF2); plain passwords are never stored.
//
//  Recovery codes (accounts have no email): each account can hold one
//  random code, hashed the same way, that sets a new password. The
//  player gets one when the account is made and can make a new one
//  while signed in; the site owner can issue one with the server's
//  --recovery-code command. A code works once, then a fresh one is
//  issued.
// ============================================================
public sealed class UserStore
{
    public record User(long Id, string Username, string PasswordHash);
    public record Save(string Data, DateTimeOffset UpdatedAt);

    private readonly AppDb _db;
    private readonly PasswordHasher<string> _hasher = new();

    // Verified against when a username doesn't exist, so a failed login
    // takes the same time whether or not the account is real.
    private readonly string _dummyHash;

    public UserStore(AppDb db)
    {
        _db = db;
        _dummyHash = _hasher.HashPassword("", Guid.NewGuid().ToString());
    }

    // Returns null when the username is already taken.
    public async Task<User?> CreateAsync(string username, string password, string? saveData)
    {
        var hash = _hasher.HashPassword(username, password);
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        await using var conn = await _db.OpenAsync();
        await using var tx = (SqliteTransaction)await conn.BeginTransactionAsync();

        long id;
        await using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = """
                INSERT OR IGNORE INTO users (username, password_hash, created_at)
                VALUES ($username, $hash, $now);
                SELECT changes(), last_insert_rowid();
                """;
            cmd.Parameters.AddWithValue("$username", username);
            cmd.Parameters.AddWithValue("$hash", hash);
            cmd.Parameters.AddWithValue("$now", now);

            await using var reader = await cmd.ExecuteReaderAsync();
            await reader.ReadAsync();
            if (reader.GetInt64(0) == 0) return null;
            id = reader.GetInt64(1);
        }

        if (saveData is not null)
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "INSERT INTO user_saves (user_id, data, updated_at) VALUES ($id, $data, $now)";
            cmd.Parameters.AddWithValue("$id", id);
            cmd.Parameters.AddWithValue("$data", saveData);
            cmd.Parameters.AddWithValue("$now", now);
            await cmd.ExecuteNonQueryAsync();
        }

        await tx.CommitAsync();
        return new User(id, username, hash);
    }

    // Returns the user when the username/password pair is valid.
    public async Task<User?> VerifyAsync(string username, string password)
    {
        var user = await FindByUsernameAsync(username);
        var hash = user?.PasswordHash ?? _dummyHash;
        var result = _hasher.VerifyHashedPassword(user?.Username ?? "", hash, password);
        return user is not null && result != PasswordVerificationResult.Failed ? user : null;
    }

    public async Task<User?> FindByIdAsync(long id)
    {
        await using var conn = await _db.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, username, password_hash FROM users WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        await using var reader = await cmd.ExecuteReaderAsync();
        return await reader.ReadAsync() ? new User(reader.GetInt64(0), reader.GetString(1), reader.GetString(2)) : null;
    }

    public async Task<Save?> GetSaveAsync(long userId)
    {
        await using var conn = await _db.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT data, updated_at FROM user_saves WHERE user_id = $id";
        cmd.Parameters.AddWithValue("$id", userId);
        await using var reader = await cmd.ExecuteReaderAsync();
        return await reader.ReadAsync()
            ? new Save(reader.GetString(0), DateTimeOffset.FromUnixTimeSeconds(reader.GetInt64(1)))
            : null;
    }

    public async Task<DateTimeOffset> PutSaveAsync(long userId, string data)
    {
        var now = DateTimeOffset.UtcNow;
        await using var conn = await _db.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO user_saves (user_id, data, updated_at) VALUES ($id, $data, $now)
            ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
            """;
        cmd.Parameters.AddWithValue("$id", userId);
        cmd.Parameters.AddWithValue("$data", data);
        cmd.Parameters.AddWithValue("$now", now.ToUnixTimeSeconds());
        await cmd.ExecuteNonQueryAsync();
        return now;
    }

    // ── Passwords and recovery codes ──────────────────────────────

    // 16 characters from 31 that can't be mistaken for each other (no 0/O,
    // 1/I/L): about 79 bits, shown as XXXX-XXXX-XXXX-XXXX.
    private const string CodeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

    private static string NewCode()
    {
        var raw = System.Security.Cryptography.RandomNumberGenerator.GetString(CodeAlphabet, 16);
        return string.Join('-', Enumerable.Range(0, 4).Select(i => raw.Substring(i * 4, 4)));
    }

    // Spaces, dashes and case don't matter when a code is typed back.
    private static string NormalizeCode(string code) =>
        new(code.ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());

    // Replaces the account's recovery code with a new one and returns it
    // (the only time it's readable).
    public async Task<string> IssueRecoveryCodeAsync(long userId, string issuedBy)
    {
        var code = NewCode();
        await using var conn = await _db.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO recovery_codes (user_id, code_hash, created_at, issued_by) VALUES ($id, $hash, $now, $by)
            ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, created_at = excluded.created_at,
                issued_by = excluded.issued_by
            """;
        cmd.Parameters.AddWithValue("$id", userId);
        cmd.Parameters.AddWithValue("$hash", _hasher.HashPassword("", NormalizeCode(code)));
        cmd.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        cmd.Parameters.AddWithValue("$by", issuedBy);
        await cmd.ExecuteNonQueryAsync();
        return code;
    }

    // When the account's recovery code was made, or null when it has none.
    public async Task<DateTimeOffset?> RecoveryCodeCreatedAsync(long userId)
    {
        await using var conn = await _db.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT created_at FROM recovery_codes WHERE user_id = $id";
        cmd.Parameters.AddWithValue("$id", userId);
        var at = await cmd.ExecuteScalarAsync();
        return at is long secs ? DateTimeOffset.FromUnixTimeSeconds(secs) : null;
    }

    // Sets a new password with the account's recovery code, and uses the
    // code up. Returns the user, or null when the name and code don't match
    // (the same work either way, so a wrong name can't be told apart).
    public async Task<User?> ResetPasswordAsync(string username, string code, string newPassword)
    {
        var user = await FindByUsernameAsync(username);
        string? hash = null;
        if (user is not null)
        {
            await using var conn = await _db.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT code_hash FROM recovery_codes WHERE user_id = $id";
            cmd.Parameters.AddWithValue("$id", user.Id);
            hash = await cmd.ExecuteScalarAsync() as string;
        }
        var result = _hasher.VerifyHashedPassword("", hash ?? _dummyHash, NormalizeCode(code));
        if (user is null || hash is null || result == PasswordVerificationResult.Failed) return null;

        var newHash = _hasher.HashPassword(user.Username, newPassword);
        await using (var conn = await _db.OpenAsync())
        {
            await using var tx = (SqliteTransaction)await conn.BeginTransactionAsync();
            await using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = "UPDATE users SET password_hash = $hash WHERE id = $id";
                cmd.Parameters.AddWithValue("$hash", newHash);
                cmd.Parameters.AddWithValue("$id", user.Id);
                await cmd.ExecuteNonQueryAsync();
            }
            await using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = "DELETE FROM recovery_codes WHERE user_id = $id";
                cmd.Parameters.AddWithValue("$id", user.Id);
                await cmd.ExecuteNonQueryAsync();
            }
            await tx.CommitAsync();
        }
        return user with { PasswordHash = newHash };
    }

    // Changes the password of a signed-in account; false when the current
    // password is wrong.
    public async Task<bool> ChangePasswordAsync(long userId, string currentPassword, string newPassword)
    {
        var user = await FindByIdAsync(userId);
        if (user is null) return false;
        if (_hasher.VerifyHashedPassword(user.Username, user.PasswordHash, currentPassword) == PasswordVerificationResult.Failed)
            return false;
        await using var conn = await _db.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE users SET password_hash = $hash WHERE id = $id";
        cmd.Parameters.AddWithValue("$hash", _hasher.HashPassword(user.Username, newPassword));
        cmd.Parameters.AddWithValue("$id", userId);
        await cmd.ExecuteNonQueryAsync();
        return true;
    }

    // Deletes an account and everything tied to it, once its password
    // checks out: the saved stats and recovery code (cascade), its share
    // links and the Ask AI answers it sent. False when the password is
    // wrong. Players have this right under privacy laws (GDPR erasure);
    // the Privacy page promises it.
    public async Task<bool> DeleteAccountAsync(long userId, string password)
    {
        var user = await FindByIdAsync(userId);
        if (user is null) return false;
        if (_hasher.VerifyHashedPassword(user.Username, user.PasswordHash, password) == PasswordVerificationResult.Failed)
            return false;

        await using var conn = await _db.OpenAsync();
        await using var tx = (SqliteTransaction)await conn.BeginTransactionAsync();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = """
                DELETE FROM shares WHERE owner_id = $id;
                DELETE FROM ai_reports WHERE user_id = $id;
                DELETE FROM users WHERE id = $id;
                """;
            cmd.Parameters.AddWithValue("$id", userId);
            await cmd.ExecuteNonQueryAsync();
        }
        await tx.CommitAsync();
        return true;
    }

    public async Task<User?> FindByUsernameAsync(string username)
    {
        await using var conn = await _db.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, username, password_hash FROM users WHERE username = $username";
        cmd.Parameters.AddWithValue("$username", username);
        await using var reader = await cmd.ExecuteReaderAsync();
        return await reader.ReadAsync() ? new User(reader.GetInt64(0), reader.GetString(1), reader.GetString(2)) : null;
    }
}

