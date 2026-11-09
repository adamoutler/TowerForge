using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using TowerForge.Server.Data;
using TowerForge.Server.LiveStreams;

var builder = WebApplication.CreateBuilder(args);

// ── Data directory ─────────────────────────────────────────────
// Holds the SQLite database and the cookie encryption keys. In
// production this lives outside the deploy folder (which is wiped on
// every deploy) — see appsettings.Production.json.
var dataDir = builder.Configuration["Data:Directory"]
    ?? Path.Combine(builder.Environment.ContentRootPath, "App_Data");
Directory.CreateDirectory(dataDir);

// ── Owner command: a recovery code for a player who's locked out ──
//   TowerForge.Server --recovery-code <username>
// Prints a new recovery code for that account (replacing any it had) and
// exits without starting the site. On the VPS run it as the service user
// from the deploy folder: ops/accounts/recovery-code.sh <username>.
if (args.Length >= 1 && args[0] == "--recovery-code")
{
    if (args.Length < 2)
    {
        Console.Error.WriteLine("Usage: TowerForge.Server --recovery-code <username>");
        Environment.ExitCode = 2;
        return;
    }
    var cliDb = new AppDb(dataDir);
    cliDb.EnsureSchema();
    var cliUsers = new UserStore(cliDb);
    var who = await cliUsers.FindByUsernameAsync(args[1].Trim());
    if (who is null)
    {
        Console.Error.WriteLine($"No account named \"{args[1]}\".");
        Environment.ExitCode = 1;
        return;
    }
    var code = await cliUsers.IssueRecoveryCodeAsync(who.Id, "owner");
    Console.WriteLine($"Recovery code for {who.Username}: {code}");
    Console.WriteLine("It replaces any code they had. On the site: Player → Account → Sign In → Forgot your password?");
    return;
}

builder.Services.AddSingleton(new AppDb(dataDir));
builder.Services.AddSingleton<ShareStore>();
builder.Services.AddSingleton<UserStore>();
builder.Services.AddSingleton<AiReportStore>();
// Parts of the site only some accounts see while they're tried out.
builder.Services.AddSingleton(sp => new PreviewFeatures(
    Path.Combine(dataDir, "features.json"), sp.GetRequiredService<ILogger<PreviewFeatures>>()));

// ── Creators live on Twitch / YouTube (Creator Codes) ──────────
// The API keys are in the data directory, never in the repo
// (LiveStreams/LiveStreamService.cs has the file's shape).
builder.Configuration.AddJsonFile(Path.Combine(Path.GetFullPath(dataDir), "stream-keys.json"), optional: true, reloadOnChange: true);
builder.Services.AddHttpClient(LiveStreamService.HttpClientName, c =>
{
    c.Timeout = TimeSpan.FromSeconds(20);
    c.DefaultRequestHeaders.UserAgent.ParseAdd("TowerForge/1.0 (+https://towerforge.net)");
});
builder.Services.AddSingleton(sp => new LiveStreamService(
    sp.GetRequiredService<IHttpClientFactory>(),
    sp.GetRequiredService<IConfiguration>(),
    sp.GetRequiredService<ILogger<LiveStreamService>>(),
    Path.Combine(builder.Environment.ContentRootPath, "creator-channels.json"),
    Path.Combine(dataDir, "youtube-channels.json")));
builder.Services.AddHostedService(sp => sp.GetRequiredService<LiveStreamService>());

// Persist keys so sign-in cookies survive restarts and deploys.
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataDir, "keys")))
    .SetApplicationName("TowerForge");

// ── Auth ───────────────────────────────────────────────────────
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "tf_session";
        options.Cookie.HttpOnly = true;
        // Strict: the browser never sends the cookie on cross-site requests (CSRF guard).
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.ExpireTimeSpan = TimeSpan.FromDays(30);
        options.SlidingExpiration = true;
        // API only — answer with status codes instead of redirecting to a login page.
        options.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
        options.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
    });
builder.Services.AddAuthorization();

// nginx forwards the real client IP (used for rate limiting) and scheme.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
});

// ── Rate limiting (per client IP) ──────────────────────────────
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (ctx, token) =>
    {
        ctx.HttpContext.Response.ContentType = "application/json";
        await ctx.HttpContext.Response.WriteAsync(
            "{\"error\":\"Too many requests. Please wait a minute and try again.\"}", token);
    };

    options.AddPolicy("auth", ctx => PerIp(ctx, permitsPerMinute: 10));
    options.AddPolicy("share-create", ctx => PerIp(ctx, permitsPerMinute: 20));
    options.AddPolicy("save", ctx => PerIp(ctx, permitsPerMinute: 60));
    options.AddPolicy("ai-report", ctx => PerIp(ctx, permitsPerMinute: 10));
});

builder.Services.AddControllers();
// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// ── Database setup ─────────────────────────────────────────────
var db = app.Services.GetRequiredService<AppDb>();
db.EnsureSchema();
db.ImportLegacyShares(
    app.Configuration["Shares:Directory"] ?? Path.Combine(dataDir, "shares"),
    app.Logger);

app.UseForwardedHeaders();

app.UseDefaultFiles();
app.UseStaticFiles();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.MapFallbackToFile("/index.html");

app.Run();

static RateLimitPartition<string> PerIp(HttpContext ctx, int permitsPerMinute) =>
    RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permitsPerMinute,
            Window = TimeSpan.FromMinutes(1),
        });
