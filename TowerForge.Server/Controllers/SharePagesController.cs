using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using TowerForge.Server.Data;
using TowerForge.Server.ShareCards;

namespace TowerForge.Server.Controllers;

// ============================================================
//  Share links with their own preview (2026-11-14):
//    GET /s/{code}           the site's index.html with this share's
//                            title, description and card in its head, so
//                            Discord, Reddit and X show the shared tier and
//                            best wave; the app then opens the share
//    GET /s/{code}/card.png  the card (ShareCards/ShareCard.cs)
//  Older ?share=CODE links still open, with the site's own preview.
//  nginx passes /s/ to the server (ops/nginx/towerforge-pages.md). Share
//  pages ask search engines not to list them: they're one player's
//  snapshot and expire after 90 days.
// ============================================================
[Route("s")]
public partial class SharePagesController(ShareStore shares, IWebHostEnvironment env, IConfiguration config, ShareCardRenderer cards) : ControllerBase
{
    // Cards for shares that still exist, so a link posted in a busy channel
    // is drawn once; cleared when it grows past this.
    private static readonly ConcurrentDictionary<string, byte[]> Drawn = new();
    private const int MaxDrawn = 300;

    private static string? _index;
    private static DateTime _indexTime;

    [HttpGet("{code}")]
    [EnableRateLimiting("share-page")]
    public async Task<IActionResult> Page(string code)
    {
        var index = Index();
        if (index is null) return NotFound();
        code = code.Trim().ToUpperInvariant();
        var data = CodePattern().IsMatch(code) ? await shares.GetDataAsync(code) : null;
        Response.Headers.CacheControl = "no-cache";
        if (data is null)
        {
            // The app says the share is gone.
            return new ContentResult { Content = SharePage.NoIndex(index), ContentType = "text/html; charset=utf-8", StatusCode = 404 };
        }
        var summary = ShareSummary.From(JsonNode.Parse(data)!.AsObject());
        var origin = (config["Site:Origin"] ?? "https://towerforge.net").TrimEnd('/');
        return Content(SharePage.Html(index, summary, $"{origin}/s/{code}"), "text/html; charset=utf-8");
    }

    [HttpGet("{code}/card.png")]
    [EnableRateLimiting("share-page")]
    public async Task<IActionResult> Card(string code)
    {
        code = code.Trim().ToUpperInvariant();
        if (!CodePattern().IsMatch(code)) return NotFound();
        var data = await shares.GetDataAsync(code);
        if (data is null)
        {
            Drawn.TryRemove(code, out _);
            return NotFound();
        }
        if (!Drawn.TryGetValue(code, out var png))
        {
            png = cards.Render(ShareSummary.From(JsonNode.Parse(data)!.AsObject()), code);
            if (Drawn.Count >= MaxDrawn) Drawn.Clear();
            Drawn[code] = png;
        }
        Response.Headers.CacheControl = "public, max-age=86400";
        return File(png, "image/png");
    }

    // index.html, read again when a deploy replaces it.
    private string? Index()
    {
        var path = env.WebRootPath is null ? null : Path.Combine(env.WebRootPath, "index.html");
        if (path is null || !System.IO.File.Exists(path)) return null;
        var time = System.IO.File.GetLastWriteTimeUtc(path);
        if (_index is null || time != _indexTime)
        {
            _index = System.IO.File.ReadAllText(path);
            _indexTime = time;
        }
        return _index;
    }

    [GeneratedRegex(@"^[A-Z2-9]{8}$")]
    private static partial Regex CodePattern();
}
