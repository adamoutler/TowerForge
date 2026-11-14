using TowerForge.Server.LiveStreams;
using Xunit;

namespace TowerForge.Server.Tests;

// ============================================================
//  The Tower-only check for live streams (StreamCheck.cs), on titles
//  like the ones the creators' streams had on 2026-11-09 (made up in
//  the same style, not copied).
// ============================================================
public class StreamCheckTests
{
    [Fact]
    public void Twitch_counts_only_the_Tower_category()
    {
        Assert.True(StreamCheck.IsTowerTwitch("867147028"));
        Assert.False(StreamCheck.IsTowerTwitch("31951940"));     // another game called The Tower
        Assert.False(StreamCheck.IsTowerTwitch("1230742965"));   // a card shop game
        Assert.False(StreamCheck.IsTowerTwitch(null));
    }

    [Theory]
    [InlineData("Legend Tournament - eHP push! The Tower Idle Tower Defense")]
    [InlineData("Tourny & Tower 9.11.26")]
    [InlineData("Tourney Time 11/9")]
    [InlineData("Rise and Grind! Mythic League Tournament")]
    [InlineData("Attempting the Tier 24 Milestone")]
    [InlineData("Is T23 Farming Viable?")]
    [InlineData("T18 Defense Disco Run? - Rotating Relics Waiting Room")]
    [InlineData("Pulling the New Mod! Modules and Labs")]
    public void YouTube_title_that_says_the_Tower(string title) =>
        Assert.True(StreamCheck.IsTowerYouTube(title, null, null));

    [Theory]
    [InlineData("WoW Forever Day 5 - Prot Warrior PVP")]
    [InlineData("World of Warcraft Forever - Stuck Here Forever!")]
    [InlineData("Call of Duty CAMO GRIND! 24/7")]
    [InlineData("Hardcore Minecraft Hangout and Base Design!")]
    [InlineData("Minecraft/The Tower Base Building")]   // another game named: left out
    public void YouTube_title_naming_another_game(string title) =>
        Assert.False(StreamCheck.IsTowerYouTube(title, ["the tower", "idle tower defense"], "The Tower: Idle Tower Defense"));

    [Fact]
    public void YouTube_tags_or_the_first_description_line_can_say_it()
    {
        Assert.True(StreamCheck.IsTowerYouTube("the forever stream", null,
            "\nThe Tower: Idle Tower Defense, live around the clock.\n\nAsk the co-host anything."));
        Assert.True(StreamCheck.IsTowerYouTube("300 Subscriber Giveaway", ["the tower idle tower defense", "idle games"], ""));
        // Lower in the description doesn't count: a WoW stream's footer had #thetower.
        Assert.False(StreamCheck.IsTowerYouTube("Dungeons today with friends", null,
            "Twitch: https://twitch.tv/someone\nDonate to my tower: ABC\n#idletowerdefense #thetower"));
    }

    [Theory]
    [InlineData("Late night streaming.")]
    [InlineData("Just chilling stream")]
    public void YouTube_title_that_doesnt_say_the_game_is_left_out(string title) =>
        Assert.False(StreamCheck.IsTowerYouTube(title, null, ""));

    [Fact]
    public void Reads_the_newest_videos_from_a_channel_feed()
    {
        const string xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
              <title>A channel</title>
              <entry><id>yt:video:aaa</id><yt:videoId>aaa</yt:videoId><published>2026-11-09T17:39:32+00:00</published></entry>
              <entry><id>yt:video:bbb</id><yt:videoId>bbb</yt:videoId></entry>
              <entry><id>yt:video:ccc</id><yt:videoId>ccc</yt:videoId></entry>
            </feed>
            """;
        Assert.Equal(["aaa", "bbb"], StreamCheck.FeedVideoIds(xml, 2));
        Assert.Equal(["aaa", "bbb", "ccc"], StreamCheck.FeedVideoIds(xml, 5));
    }
}
