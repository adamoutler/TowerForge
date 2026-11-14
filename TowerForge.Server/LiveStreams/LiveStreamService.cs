using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Xml;

namespace TowerForge.Server.LiveStreams;

// ============================================================
//  Which creators are streaming The Tower right now, for Creator
//  Codes' LIVE badges. The server asks Twitch and YouTube; visitors'
//  browsers never contact them (only a click on "Watch" does), and
//  nothing about visitors is sent.
//
//  Channels: creator-channels.json beside the server, written from
//  the client's creator list by `npm run creator-channels`.
//  Keys: stream-keys.json in the data directory — on the server,
//  never in the repo:
//      { "LiveStreams": { "TwitchClientId": "…", "TwitchClientSecret": "…",
//                         "YouTubeApiKey": "…" } }
//  Read again when it changes; without keys a platform is skipped.
//
//  Twitch: one Helix request for every channel, every 2 minutes.
//  YouTube: each channel's free feed for its newest videos, then one
//  videos.list call (1 quota unit) per 50 of them, every 4 minutes —
//  about 1,100 of the 10,000 free units a day. "Is this channel live"
//  by search costs 100 units a call, too much for 24 channels.
//  docs/live-streams.md has how this was checked.
// ============================================================
public sealed class LiveStreamService : BackgroundService
{
    public const string HttpClientName = "live-streams";
    public static readonly TimeSpan TwitchEvery = TimeSpan.FromMinutes(2);
    public static readonly TimeSpan YouTubeEvery = TimeSpan.FromMinutes(4);
    // A platform that couldn't be reached for this long shows nobody live.
    private static readonly TimeSpan StaleAfter = TimeSpan.FromMinutes(15);
    // YouTube's rules: stored API data is refreshed within 30 days.
    private static readonly TimeSpan ChannelIdRefresh = TimeSpan.FromDays(30);
    private static readonly TimeSpan MissingChannelRetry = TimeSpan.FromDays(1);
    // A stream is in the feed from when it's scheduled; newer uploads
    // push it down, so look at a few.
    private const int FeedVideos = 5;

    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _config;
    private readonly ILogger<LiveStreamService> _log;
    private readonly List<CreatorChannel> _channels;
    private readonly string _channelIdCachePath;

    private readonly Dictionary<string, ChannelIdEntry> _channelIds;
    private readonly Dictionary<string, List<string>> _feeds = new();
    private string? _twitchToken;
    private string? _twitchTokenFor;
    private DateTimeOffset _twitchTokenExpires;
    private PlatformResult? _twitch;
    private PlatformResult? _youtube;

    private sealed record PlatformResult(DateTimeOffset At, List<LiveStream> Live);
    public sealed record ChannelIdEntry(string? Id, DateTimeOffset Checked);

    public LiveStreamService(IHttpClientFactory http, IConfiguration config, ILogger<LiveStreamService> log,
        string channelsPath, string channelIdCachePath)
    {
        _http = http;
        _config = config;
        _log = log;
        _channels = CreatorChannel.Load(channelsPath, log);
        _channelIdCachePath = channelIdCachePath;
        _channelIds = LoadChannelIds(channelIdCachePath);
    }

    // What the site shows: the streams from each platform's last good check.
    public LiveSnapshot Snapshot
    {
        get
        {
            var now = DateTimeOffset.UtcNow;
            var fresh = new[] { _twitch, _youtube }.Where(r => r is not null && now - r.At < StaleAfter).Select(r => r!).ToList();
            return new LiveSnapshot(
                fresh.Count > 0 ? fresh.Max(r => r.At) : null,
                fresh.SelectMany(r => r.Live).ToList());
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var nextTwitch = DateTimeOffset.MinValue;
        var nextYouTube = DateTimeOffset.MinValue;
        var saidOff = false;
        using var tick = new PeriodicTimer(TimeSpan.FromSeconds(20));
        try
        {
            do
            {
                var now = DateTimeOffset.UtcNow;
                var twitchId = _config["LiveStreams:TwitchClientId"];
                var twitchSecret = _config["LiveStreams:TwitchClientSecret"];
                var youtubeKey = _config["LiveStreams:YouTubeApiKey"];
                var hasTwitch = !string.IsNullOrWhiteSpace(twitchId) && !string.IsNullOrWhiteSpace(twitchSecret);
                var hasYouTube = !string.IsNullOrWhiteSpace(youtubeKey);
                if (!hasTwitch && !hasYouTube && !saidOff)
                    _log.LogInformation("Live streams are off: no keys in stream-keys.json in the data directory");
                saidOff = !hasTwitch && !hasYouTube;

                if (hasTwitch && now >= nextTwitch)
                {
                    nextTwitch = now + TwitchEvery;
                    var live = await Try("Twitch", () => CheckTwitch(twitchId!, twitchSecret!, stop), stop);
                    if (live is not null) _twitch = new(DateTimeOffset.UtcNow, live);
                }
                if (hasYouTube && now >= nextYouTube)
                {
                    nextYouTube = now + YouTubeEvery;
                    var live = await Try("YouTube", () => CheckYouTube(youtubeKey!, stop), stop);
                    if (live is not null) _youtube = new(DateTimeOffset.UtcNow, live);
                }
            } while (await tick.WaitForNextTickAsync(stop));
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
    }

    private async Task<List<LiveStream>?> Try(string platform, Func<Task<List<LiveStream>>> check, CancellationToken stop)
    {
        try
        {
            return await check();
        }
        catch (Exception ex) when (!stop.IsCancellationRequested && ex is HttpRequestException or JsonException or TaskCanceledException or InvalidOperationException or KeyNotFoundException)
        {
            _log.LogWarning("Checking {Platform} for live creators failed: {Error}", platform, ex.Message);
            return null;
        }
    }

    private HttpClient Client => _http.CreateClient(HttpClientName);

    // ── Twitch ─────────────────────────────────────────────────

    private async Task<List<LiveStream>> CheckTwitch(string clientId, string secret, CancellationToken ct)
    {
        var byLogin = _channels.Where(c => c.Twitch is not null)
            .ToDictionary(c => c.Twitch!.ToLowerInvariant(), c => c.Code);
        var live = new List<LiveStream>();
        // Helix takes up to 100 channels a request.
        foreach (var chunk in byLogin.Keys.Chunk(100))
        {
            var token = await TwitchToken(clientId, secret, ct);
            var url = "https://api.twitch.tv/helix/streams?first=100&"
                + string.Join('&', chunk.Select(l => "user_login=" + Uri.EscapeDataString(l)));
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Add("Client-Id", clientId);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var res = await Client.SendAsync(req, ct);
            if (res.StatusCode == HttpStatusCode.Unauthorized)
            {
                _twitchToken = null;
                throw new HttpRequestException("Twitch turned the token down; a new one is fetched next time");
            }
            res.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await res.Content.ReadAsByteArrayAsync(ct));
            foreach (var s in doc.RootElement.GetProperty("data").EnumerateArray())
            {
                if (s.GetProperty("type").GetString() != "live") continue;
                if (!StreamCheck.IsTowerTwitch(s.GetProperty("game_id").GetString())) continue;
                var login = (s.GetProperty("user_login").GetString() ?? "").ToLowerInvariant();
                if (!byLogin.TryGetValue(login, out var code)) continue;
                live.Add(new LiveStream(code, "twitch", $"https://www.twitch.tv/{login}",
                    s.GetProperty("title").GetString() ?? "",
                    s.GetProperty("started_at").GetDateTimeOffset(),
                    s.GetProperty("viewer_count").GetInt32()));
            }
        }
        return live;
    }

    // An app token (no user is signed in); Twitch gives it for about 60 days.
    private async Task<string> TwitchToken(string clientId, string secret, CancellationToken ct)
    {
        if (_twitchToken is not null && _twitchTokenFor == clientId && DateTimeOffset.UtcNow < _twitchTokenExpires)
            return _twitchToken;
        using var res = await Client.PostAsync("https://id.twitch.tv/oauth2/token", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["client_secret"] = secret,
            ["grant_type"] = "client_credentials",
        }), ct);
        res.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await res.Content.ReadAsByteArrayAsync(ct));
        _twitchToken = doc.RootElement.GetProperty("access_token").GetString()
            ?? throw new InvalidOperationException("Twitch sent no token");
        _twitchTokenFor = clientId;
        _twitchTokenExpires = DateTimeOffset.UtcNow.AddSeconds(doc.RootElement.GetProperty("expires_in").GetInt32() - 300);
        return _twitchToken;
    }

    // ── YouTube ────────────────────────────────────────────────

    private async Task<List<LiveStream>> CheckYouTube(string key, CancellationToken ct)
    {
        var codeByChannel = await ChannelIds(key, ct);

        // Each channel's newest videos; a feed that fails keeps its last list.
        var failed = 0;
        await Parallel.ForEachAsync(codeByChannel.Keys, new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = ct }, async (channel, ct2) =>
        {
            try
            {
                var xml = await Client.GetStringAsync($"https://www.youtube.com/feeds/videos.xml?channel_id={Uri.EscapeDataString(channel)}", ct2);
                var ids = StreamCheck.FeedVideoIds(xml, FeedVideos);
                lock (_feeds) _feeds[channel] = ids;
            }
            catch (Exception ex) when (!ct2.IsCancellationRequested && ex is HttpRequestException or XmlException or TaskCanceledException)
            {
                Interlocked.Increment(ref failed);
            }
        });
        if (codeByChannel.Count > 0 && failed == codeByChannel.Count)
            throw new HttpRequestException("none of the channel feeds could be read");

        List<string> videos;
        lock (_feeds) videos = codeByChannel.Keys.SelectMany(c => _feeds.GetValueOrDefault(c) ?? []).Distinct().ToList();

        var live = new List<LiveStream>();
        foreach (var chunk in videos.Chunk(50))
        {
            using var doc = await YouTubeGet(
                $"videos?part=snippet,liveStreamingDetails&id={string.Join(',', chunk)}", key, ct);
            foreach (var v in doc.RootElement.GetProperty("items").EnumerateArray())
            {
                var snippet = v.GetProperty("snippet");
                if (snippet.GetProperty("liveBroadcastContent").GetString() != "live") continue;
                if (!codeByChannel.TryGetValue(snippet.GetProperty("channelId").GetString() ?? "", out var code)) continue;
                var title = snippet.GetProperty("title").GetString() ?? "";
                var tags = snippet.TryGetProperty("tags", out var t) ? t.EnumerateArray().Select(x => x.GetString() ?? "").ToList() : null;
                var description = snippet.TryGetProperty("description", out var d) ? d.GetString() : null;
                if (!StreamCheck.IsTowerYouTube(title, tags, description)) continue;

                DateTimeOffset started = DateTimeOffset.UtcNow;
                int? viewers = null;
                if (v.TryGetProperty("liveStreamingDetails", out var details))
                {
                    if (details.TryGetProperty("actualStartTime", out var s)) started = s.GetDateTimeOffset();
                    // Hidden when the creator turns the count off.
                    if (details.TryGetProperty("concurrentViewers", out var n) && int.TryParse(n.GetString(), out var count)) viewers = count;
                }
                live.Add(new LiveStream(code, "youtube", $"https://www.youtube.com/watch?v={v.GetProperty("id").GetString()}",
                    title, started, viewers));
            }
        }
        return live;
    }

    // Channel ids for the creators' @handles (1 unit each), kept in the
    // data directory and looked up again after 30 days.
    private async Task<Dictionary<string, string>> ChannelIds(string key, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var changed = false;
        foreach (var handle in _channels.Select(c => c.Youtube).OfType<string>())
        {
            if (_channelIds.TryGetValue(handle, out var known)
                && now - known.Checked < (known.Id is null ? MissingChannelRetry : ChannelIdRefresh)) continue;
            try
            {
                using var doc = await YouTubeGet($"channels?part=id&forHandle=%40{Uri.EscapeDataString(handle)}", key, ct);
                var items = doc.RootElement.TryGetProperty("items", out var i) ? i.EnumerateArray().ToList() : [];
                var id = items.Count > 0 ? items[0].GetProperty("id").GetString() : null;
                if (id is null) _log.LogWarning("YouTube has no channel @{Handle}", handle);
                _channelIds[handle] = new ChannelIdEntry(id, now);
                changed = true;
            }
            catch (HttpRequestException ex)
            {
                _log.LogWarning("Looking up YouTube channel @{Handle} failed: {Error}", handle, ex.Message);
            }
        }
        if (changed) SaveChannelIds();
        return _channels
            .Where(c => c.Youtube is not null && _channelIds.GetValueOrDefault(c.Youtube)?.Id is not null)
            .GroupBy(c => _channelIds[c.Youtube!].Id!)
            .ToDictionary(g => g.Key, g => g.First().Code);
    }

    // A YouTube Data API call. The key goes in a header, not the address,
    // so it's never in a log; an error says YouTube's reason (quotaExceeded…).
    private async Task<JsonDocument> YouTubeGet(string pathAndQuery, string key, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, "https://www.googleapis.com/youtube/v3/" + pathAndQuery);
        req.Headers.Add("X-Goog-Api-Key", key);
        using var res = await Client.SendAsync(req, ct);
        // Read as bytes: JSON is UTF-8, whatever charset a header names.
        var body = await res.Content.ReadAsByteArrayAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            var reason = "";
            try
            {
                using var err = JsonDocument.Parse(body);
                reason = err.RootElement.GetProperty("error").GetProperty("errors")[0].GetProperty("reason").GetString() ?? "";
            }
            catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException or IndexOutOfRangeException) { }
            throw new HttpRequestException($"YouTube answered {(int)res.StatusCode} {reason}".Trim());
        }
        return JsonDocument.Parse(body);
    }

    private static Dictionary<string, ChannelIdEntry> LoadChannelIds(string path)
    {
        try
        {
            if (File.Exists(path))
                return JsonSerializer.Deserialize<Dictionary<string, ChannelIdEntry>>(File.ReadAllText(path)) ?? new();
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { }
        return new();
    }

    private void SaveChannelIds()
    {
        try
        {
            File.WriteAllText(_channelIdCachePath, JsonSerializer.Serialize(_channelIds, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _log.LogWarning("Could not save {Path}: {Error}", _channelIdCachePath, ex.Message);
        }
    }
}

public sealed record LiveStream(string Code, string Platform, string Url, string Title, DateTimeOffset StartedAt, int? Viewers);

public sealed record LiveSnapshot(DateTimeOffset? CheckedAt, IReadOnlyList<LiveStream> Live);

// A creator's channels: their YouTube @handle and Twitch login.
public sealed record CreatorChannel(string Code, string? Youtube, string? Twitch)
{
    private sealed record ChannelsFile(List<CreatorChannel> Creators);

    public static List<CreatorChannel> Load(string path, ILogger log)
    {
        try
        {
            var file = JsonSerializer.Deserialize<ChannelsFile>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            return file?.Creators ?? [];
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            log.LogWarning("Could not read {Path}; no creator will show as live: {Error}", path, ex.Message);
            return [];
        }
    }
}
