using System.Text.Json.Nodes;
using TowerForge.Server.ShareCards;
using Xunit;

namespace TowerForge.Server.Tests;

// ============================================================
//  Share-link previews: what a share's summary says (and refuses),
//  the page's tags, PNG in and out, and the drawn card — made-up shares.
// ============================================================
public class ShareCardTests
{
    private static readonly string Cards = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "TowerForge.Server", "ShareCards"));

    private static ShareCardRenderer Renderer() => new(
        File.ReadAllBytes(Path.Combine(Cards, "card-base.png")),
        File.ReadAllBytes(Path.Combine(Cards, "glyphs.png")),
        File.ReadAllText(Path.Combine(Cards, "glyphs.json")));

    private static JsonObject Share(string json) => JsonNode.Parse(json)!.AsObject();

    [Fact]
    public void Summary_reads_the_profile_section()
    {
        var s = ShareSummary.From(Share("""
            { "profile": { "build": "Hybrid", "league": "Champion", "highestTier": 14, "completedTier": 13,
                           "tierWaves": { "12": 6100, "13": 5231, "14": 0 } },
              "uw": {}, "cards": {}, "workshop": {}, "labs": {} }
            """));
        Assert.Equal((14, 13, 5231, "Champion", "Hybrid"), (s.Tier, s.WaveTier, s.Wave, s.League, s.Build));
        Assert.Equal("Tier 14, best wave 5,231 on Tier 13 — TowerForge", s.Title());
        Assert.Equal("Champion league, Hybrid build. See the UWs, cards, workshop and labs on TowerForge.", s.Description());
    }

    [Fact]
    public void Summary_leaves_out_anything_that_isnt_the_games()
    {
        // Anyone can make a share: words and numbers outside the game's are dropped.
        var s = ShareSummary.From(Share("""
            { "profile": { "build": "<script>alert(1)</script>", "league": "Diamond", "highestTier": "14",
                           "tierWaves": { "5": 1e12, "x": 9, "200": 50, "3": -4, "2": 4000 } } }
            """));
        Assert.Equal((0, 2, 4000, null, null), (s.Tier, s.WaveTier, s.Wave, s.League, s.Build));
        Assert.Empty(s.Sections);
        Assert.Equal("Tier 2, best wave 4,000 — TowerForge", s.Title());

        var bare = ShareSummary.From(Share("""{ "modules": {}, "bots": {}, "profile": 7 }"""));
        Assert.False(bare.HasNumbers);
        Assert.Equal("A shared The Tower build — TowerForge", bare.Title());
        Assert.Equal("A shared The Tower build. See the bots and modules on TowerForge.", bare.Description());
    }

    [Fact]
    public void Page_has_the_shares_preview_tags()
    {
        const string index = """
            <head>
            <title>TowerForge — The Tower Companion</title>
            <meta name="description" content="site" />
            <link rel="canonical" href="https://towerforge.net/" />
            <meta property="og:title" content="site" />
            <meta property="og:description" content="site" />
            <meta property="og:url" content="https://towerforge.net/" />
            <meta property="og:image" content="https://towerforge.net/og-image.png" />
            <meta property="og:image:alt" content="site" />
            <meta name="twitter:title" content="site" />
            <meta name="twitter:description" content="site" />
            <meta name="twitter:image" content="https://towerforge.net/og-image.png" />
            </head>
            """;
        var s = ShareSummary.From(Share("""{ "profile": { "league": "Gold", "highestTier": 8, "tierWaves": { "8": 1500 } }, "labs": {} }"""));
        var html = SharePage.Html(index, s, "https://towerforge.net/s/ABCD2345");
        Assert.Contains("<title>Tier 8, best wave 1,500 — TowerForge</title>", html);
        Assert.Contains("""<meta property="og:image" content="https://towerforge.net/s/ABCD2345/card.png" />""", html);
        Assert.Contains("""<meta name="twitter:image" content="https://towerforge.net/s/ABCD2345/card.png" />""", html);
        Assert.Contains("""<link rel="canonical" href="https://towerforge.net/s/ABCD2345" />""", html);
        Assert.Contains("""<meta property="og:description" content="Gold league. See the labs on TowerForge." />""", html);
        Assert.Contains("""<meta name="robots" content="noindex" />""", html);
        Assert.DoesNotContain("content=\"site\"", html);
    }

    [Fact]
    public void Png_round_trips()
    {
        var rng = new Random(7);
        var rgb = new byte[37 * 11 * 3];
        rng.NextBytes(rgb);
        var back = Png.Decode(Png.Encode(new Png.Image(37, 11, rgb)));
        Assert.Equal((37, 11), (back.Width, back.Height));
        Assert.Equal(rgb, back.Rgb);
    }

    [Fact]
    public void Card_is_drawn_with_the_shares_numbers()
    {
        var r = Renderer();
        var s = ShareSummary.From(Share("""{ "profile": { "build": "eHP", "league": "Mythic", "highestTier": 18, "tierWaves": { "18": 9010 } }, "uw": {}, "modules": {} }"""));
        var png = r.Render(s, "ABCD2345");
        var img = Png.Decode(png);
        Assert.Equal((1200, 630), (img.Width, img.Height));
        Assert.True(png.Length < 600_000, $"{png.Length} bytes");

        var plain = Png.Decode(File.ReadAllBytes(Path.Combine(Cards, "card-base.png")));
        // The badges and words change the left half; the ring on the right stays the background's.
        int Changed(int x0, int x1) => Enumerable.Range(0, 630).Sum(y => Enumerable.Range(x0, x1 - x0).Count(x => img.Rgb[(y * 1200 + x) * 3] != plain.Rgb[(y * 1200 + x) * 3]));
        Assert.True(Changed(60, 680) > 20_000);
        Assert.Equal(0, Changed(760, 1200));

        // Wider numbers make a wider badge: "1,234,567" next to "9,010".
        Assert.True(r.Measure("1,234,567", "value") > r.Measure("9,010", "value") + 150);
        // Writing to a file lets the look be checked by eye (dotnet test, then open it).
        File.WriteAllBytes(Path.Combine(Path.GetTempPath(), "towerforge-share-card-test.png"), png);
    }
}
