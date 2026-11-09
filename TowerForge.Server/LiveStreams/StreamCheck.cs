using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace TowerForge.Server.LiveStreams;

// ============================================================
//  Is a creator's live stream The Tower?
//  Creator Codes shows a creator as live only while they stream
//  The Tower (owner, 2026-11-09): several stream other games too
//  (World of Warcraft, Call of Duty, Minecraft were live or recent
//  on 2026-11-09).
//
//  Twitch: the stream's category. The Tower – Idle Tower Defense is
//  game 867147028 (IGDB 206923): the category on jplaysone's and the
//  owner's channels and on the 24/7 Tower stream, checked with the
//  Helix API on 2026-11-09. Twitch lists nine "The Tower" games; the
//  others are different games with the same name.
//
//  YouTube: the API has no game field, so it's the words. A stream
//  counts when its title says The Tower or something only Tower
//  streams say (tourney, a league, T18, UW, modules…), or its tags or
//  its description's first line name the game, and the title doesn't
//  name another game. Checked on the creators' last 190 streams
//  (2026-11-09): every World of Warcraft, Call of Duty and Minecraft
//  stream is left out; 16 Tower streams whose titles don't say the
//  game ("Late night streaming.", "Strom Live Stream") are missed.
//  Missing one is better than showing another game. docs/live-streams.md.
// ============================================================
public static class StreamCheck
{
    public const string TowerTwitchGameId = "867147028";

    private const string Game = @"the\s*tower|idle\s*tower|tower\s*defen[cs]e|thetower|idletowerdefense";

    // Words in a title that mean The Tower on these channels.
    private static readonly Regex TitleWords = new(
        @"\b(?:" + Game + @"|tower|tourn(?:e?y|ament)s?|(?:copper|silver|gold|platinum|champions?|legends?|mythic)\s+(?:league|tourn\w*)"
        + @"|milestones?|ultimate\s+weapons?|UWs?|T\d{1,2}|tier\s*\d+|disco|relics?|modules?|labs?)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    // Tags and descriptions say much more, so only the game's name counts there.
    private static readonly Regex GameName = new(@"\b(?:" + Game + @")\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    // Other games these creators stream, named in the title.
    private static readonly Regex OtherGame = new(
        @"\b(?:wow|warcraft|minecraft|call\s+of\s+duty|cod|fortnite|valorant|apex|league\s+of\s+legends|diablo|elden\s+ring"
        + @"|roblox|gta|overwatch|destiny|tcg|card\s+shop)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static bool IsTowerTwitch(string? gameId) => gameId == TowerTwitchGameId;

    public static bool IsTowerYouTube(string title, IEnumerable<string>? tags, string? description)
    {
        if (OtherGame.IsMatch(title)) return false;
        if (TitleWords.IsMatch(title)) return true;
        if (tags is not null && GameName.IsMatch(string.Join(' ', tags))) return true;
        return GameName.IsMatch(FirstLine(description));
    }

    private static string FirstLine(string? text) =>
        (text ?? "").Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0) ?? "";

    private static readonly XNamespace Atom = "http://www.w3.org/2005/Atom";
    private static readonly XNamespace Yt = "http://www.youtube.com/xml/schemas/2015";

    // A channel's newest videos from its public feed
    // (youtube.com/feeds/videos.xml?channel_id=…), newest first. A live
    // stream is in it from when it's scheduled or starts.
    public static List<string> FeedVideoIds(string xml, int newest)
    {
        var doc = XDocument.Parse(xml);
        return doc.Root?.Elements(Atom + "entry")
            .Select(e => e.Element(Yt + "videoId")?.Value)
            .OfType<string>()
            .Where(id => id.Length > 0)
            .Take(newest)
            .ToList() ?? [];
    }
}
