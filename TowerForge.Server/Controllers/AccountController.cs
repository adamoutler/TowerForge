using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using TowerForge.Server.Data;

namespace TowerForge.Server.Controllers;

// ============================================================
//  Accounts: register, sign in/out, synced stats, and the
//  player's own share codes.
//  Registering uploads whatever the player had entered locally;
//  signing in to an existing account never uploads local data.
//  Forgotten passwords: a recovery code (UserStore) sets a new one;
//  the player gets a code with the account and can make a new one
//  while signed in, and can change the password.
//  Deleting an account removes it and everything tied to it.
// ============================================================
[ApiController]
[Route("api/account")]
public class AccountController : ControllerBase
{
    // Full TowerForge export (module library included) — generous headroom.
    private const int MaxSaveBytes = 2 * 1024 * 1024;

    private static readonly Regex UsernamePattern = new(@"^[A-Za-z0-9_-]{3,24}$", RegexOptions.Compiled);
    private const int MinPasswordLength = 8;
    private const int MaxPasswordLength = 128;

    private readonly UserStore _users;
    private readonly ShareStore _shares;
    private readonly PreviewFeatures _previews;

    public AccountController(UserStore users, ShareStore shares, PreviewFeatures previews)
    {
        _users = users;
        _shares = shares;
        _previews = previews;
    }

    public record ShareClaim(string Code, string Token);
    public record RegisterRequest(string Username, string Password, JsonElement? Save, List<ShareClaim>? Claims);
    public record LoginRequest(string Username, string Password);
    public record ResetRequest(string Username, string RecoveryCode, string NewPassword);
    public record PasswordRequest(string CurrentPassword, string NewPassword);
    public record DeleteRequest(string Password);

    private static bool PasswordOk(string? password) =>
        (password?.Length ?? 0) >= MinPasswordLength && password!.Length <= MaxPasswordLength;
    private static readonly object PasswordRule = new { error = $"Passwords must be at least {MinPasswordLength} characters." };

    // POST /api/account/register
    [HttpPost("register")]
    [RequestSizeLimit(MaxSaveBytes)]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest req)
    {
        var username = req.Username?.Trim() ?? "";
        if (!UsernamePattern.IsMatch(username))
            return BadRequest(new { error = "Usernames are 3–24 characters: letters, numbers, _ and -." });
        if (!PasswordOk(req.Password))
            return BadRequest(PasswordRule);

        string? saveData = null;
        if (req.Save is { ValueKind: JsonValueKind.Object } save)
            saveData = save.GetRawText();

        var user = await _users.CreateAsync(username, req.Password!, saveData);
        if (user is null)
            return Conflict(new { error = "That username is already taken." });

        if (req.Claims is { Count: > 0 })
            await _shares.ClaimAsync(user.Id, req.Claims.Select(c => (c.Code, c.Token)));

        // Shown once, for the player to keep: it resets a forgotten password.
        var recoveryCode = await _users.IssueRecoveryCodeAsync(user.Id, "player");
        await SignInAsync(user);
        return Ok(new { username = user.Username, features = _previews.For(user.Username), recoveryCode, recoveryCodeSet = true });
    }

    // POST /api/account/reset-password — a new password with the account's
    // recovery code. Signs in, loads the saved stats like signing in, and
    // returns a fresh recovery code (the old one is used up).
    [HttpPost("reset-password")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> ResetPassword([FromBody] ResetRequest req)
    {
        if (!PasswordOk(req.NewPassword))
            return BadRequest(PasswordRule);
        var user = await _users.ResetPasswordAsync(req.Username?.Trim() ?? "", req.RecoveryCode ?? "", req.NewPassword);
        if (user is null)
            return Unauthorized(new { error = "That username and recovery code don’t match." });

        var recoveryCode = await _users.IssueRecoveryCodeAsync(user.Id, "player");
        await SignInAsync(user);
        var save = await _users.GetSaveAsync(user.Id);
        return Ok(new
        {
            username = user.Username,
            features = _previews.For(user.Username),
            save = ParseSave(save),
            updatedAt = save?.UpdatedAt,
            recoveryCode,
            recoveryCodeSet = true,
        });
    }

    // POST /api/account/recovery-code — replaces the account's recovery code
    // with a new one, shown once.
    [Authorize]
    [HttpPost("recovery-code")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> NewRecoveryCode() =>
        Ok(new { recoveryCode = await _users.IssueRecoveryCodeAsync(CurrentUserId(), "player") });

    // POST /api/account/password — changes the password of the signed-in account.
    [Authorize]
    [HttpPost("password")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> ChangePassword([FromBody] PasswordRequest req)
    {
        if (!PasswordOk(req.NewPassword))
            return BadRequest(PasswordRule);
        return await _users.ChangePasswordAsync(CurrentUserId(), req.CurrentPassword ?? "", req.NewPassword)
            ? NoContent()
            : BadRequest(new { error = "Your current password isn’t right." });
    }

    // POST /api/account/delete — deletes the signed-in account and
    // everything tied to it (UserStore.DeleteAccountAsync), then signs out.
    // The password is asked again so a device left signed in can't do it.
    [Authorize]
    [HttpPost("delete")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> DeleteAccount([FromBody] DeleteRequest req)
    {
        if (!await _users.DeleteAccountAsync(CurrentUserId(), req.Password ?? ""))
            return BadRequest(new { error = "Your password isn’t right." });
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return NoContent();
    }

    // POST /api/account/login — returns the account's saved stats so the
    // client can load them onto this device.
    [HttpPost("login")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        var user = await _users.VerifyAsync(req.Username?.Trim() ?? "", req.Password ?? "");
        if (user is null)
            return Unauthorized(new { error = "Incorrect username or password." });

        await SignInAsync(user);
        var save = await _users.GetSaveAsync(user.Id);
        return Ok(new
        {
            username = user.Username,
            features = _previews.For(user.Username),
            save = ParseSave(save),
            updatedAt = save?.UpdatedAt,
            recoveryCodeSet = await _users.RecoveryCodeCreatedAsync(user.Id) is not null,
        });
    }

    // POST /api/account/logout
    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return NoContent();
    }

    // GET /api/account/me — 200 { username, features, recoveryCodeSet } when
    // signed in, else 401. features: the preview parts of the site this
    // account can see; recoveryCodeSet: whether it holds a recovery code.
    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var user = await CurrentUserAsync();
        if (user is null)
        {
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Unauthorized();
        }
        return Ok(new
        {
            username = user.Username,
            features = _previews.For(user.Username),
            recoveryCodeSet = await _users.RecoveryCodeCreatedAsync(user.Id) is not null,
        });
    }

    // GET /api/account/save — the account's synced stats.
    [Authorize]
    [HttpGet("save")]
    public async Task<IActionResult> GetSave()
    {
        var save = await _users.GetSaveAsync(CurrentUserId());
        return Ok(new
        {
            save = ParseSave(save),
            updatedAt = save?.UpdatedAt,
        });
    }

    // PUT /api/account/save — replaces the account's synced stats.
    [Authorize]
    [HttpPut("save")]
    [RequestSizeLimit(MaxSaveBytes)]
    [EnableRateLimiting("save")]
    public async Task<IActionResult> PutSave([FromBody] JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object)
            return BadRequest(new { error = "Save must be a JSON object." });

        var updatedAt = await _users.PutSaveAsync(CurrentUserId(), body.GetRawText());
        return Ok(new { updatedAt });
    }

    // GET /api/account/shares — the player's active share codes.
    [Authorize]
    [HttpGet("shares")]
    public async Task<IActionResult> Shares() =>
        Ok(await _shares.ListForOwnerAsync(CurrentUserId()));

    // Standalone element (no JsonDocument to dispose) for the response body.
    private static JsonElement? ParseSave(UserStore.Save? save) =>
        save is null ? null : JsonSerializer.Deserialize<JsonElement>(save.Data);

    private long CurrentUserId() =>
        long.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private Task<UserStore.User?> CurrentUserAsync() =>
        _users.FindByIdAsync(CurrentUserId());

    private Task SignInAsync(UserStore.User user)
    {
        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Name, user.Username),
            ],
            CookieAuthenticationDefaults.AuthenticationScheme);

        return HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(identity),
            new AuthenticationProperties { IsPersistent = true });
    }
}
