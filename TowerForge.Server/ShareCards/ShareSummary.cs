using System.Globalization;
using System.Text.Json.Nodes;

namespace TowerForge.Server.ShareCards;

// ============================================================
//  What a share link's preview says about the shared account: the
//  highest tier, the best wave on the highest tier played (the home
//  page's "best wave on T14"), the league and the build — from the
//  share's Profile section (never the player's name; shares don't hold
//  it) — and which sections it holds. Anyone can make a share, so every
//  value is checked: a league or build that isn't the game's, or a
//  number out of range, is left out, and nothing typed by the sender
//  reaches the preview as text.
// ============================================================
public sealed record ShareSummary(int Tier, int WaveTier, int Wave, string? League, string? Build, IReadOnlyList<string> Sections)
{
    public static readonly string[] Leagues = ["Copper", "Silver", "Gold", "Platinum", "Champion", "Legend", "Mythic"];
    public static readonly string[] Builds = ["Glass Cannon", "eHP", "Hybrid", "Farming"];

    // The sections a viewer can open, in the share page's order and words
    // (the client's SHARE_SECTIONS); Profile is the numbers themselves.
    private static readonly (string Key, string Name)[] SectionNames =
    [
        ("uw", "UWs"), ("cards", "cards"), ("bots", "bots"), ("modules", "modules"), ("workshop", "workshop"),
        ("labs", "labs"), ("relics", "relics"), ("guardian", "Guardian"), ("vault", "Vault"),
    ];

    public const int MaxTier = 100;
    public const int MaxWave = 10_000_000;

    public bool HasNumbers => Tier > 0 || Wave > 0;

    public static ShareSummary From(JsonObject data)
    {
        int tier = 0, waveTier = 0, wave = 0;
        string? league = null, build = null;
        if (data["profile"] is JsonObject p)
        {
            tier = Int(p["highestTier"], 1, MaxTier);
            league = OneOf(p["league"], Leagues);
            build = OneOf(p["build"], Builds);
            if (p["tierWaves"] is JsonObject waves)
            {
                foreach (var (key, node) in waves)
                {
                    if (!int.TryParse(key, NumberStyles.None, CultureInfo.InvariantCulture, out var t) || t < 1 || t > MaxTier) continue;
                    var w = Int(node, 1, MaxWave);
                    if (w > 0 && t > waveTier) (waveTier, wave) = (t, w);
                }
            }
        }
        var sections = SectionNames.Where(s => data.ContainsKey(s.Key)).Select(s => s.Name).ToList();
        return new ShareSummary(tier, waveTier, wave, league, build, sections);
    }

    private static int Int(JsonNode? node, int min, int max)
    {
        if (node is not JsonValue v) return 0;
        double d;
        try { if (!v.TryGetValue(out d)) return 0; }
        catch (InvalidOperationException) { return 0; }
        return double.IsFinite(d) && d >= min && d <= max ? (int)d : 0;
    }

    private static string? OneOf(JsonNode? node, string[] allowed)
    {
        if (node is not JsonValue v) return null;
        try { return v.TryGetValue(out string? s) && allowed.Contains(s) ? s : null; }
        catch (InvalidOperationException) { return null; }
    }

    // "workshop, labs, cards and UWs" — the first `max` and "N more".
    public string SectionsText(int max = 6)
    {
        if (Sections.Count == 0) return "";
        var shown = Sections.Take(max).ToList();
        var rest = Sections.Count - shown.Count;
        if (rest > 0) return $"{string.Join(", ", shown)} and {rest} more";
        return shown.Count == 1 ? shown[0] : $"{string.Join(", ", shown.Take(shown.Count - 1))} and {shown[^1]}";
    }

    private static string N(int v) => v.ToString("N0", CultureInfo.InvariantCulture);

    // The link preview's title and description (og:title / og:description).
    public string Title() =>
        Wave > 0 ? $"Tier {Math.Max(Tier, WaveTier)}, best wave {N(Wave)}{(WaveTier != Tier && Tier > 0 ? $" on Tier {WaveTier}" : "")} — TowerForge"
        : Tier > 0 ? $"A Tier {Tier} tower — TowerForge"
        : "A shared The Tower build — TowerForge";

    public string Description()
    {
        var who = string.Join(", ", new[] { League is null ? null : $"{League} league", Build is null ? null : $"{Build} build" }.Where(x => x is not null));
        var what = Sections.Count > 0 ? $"See the {SectionsText(9)} on TowerForge." : "See it on TowerForge.";
        return who.Length > 0 ? $"{who}. {what}" : $"A shared The Tower build. {what}";
    }
}
