using System.Net;
using System.Text.RegularExpressions;

namespace TowerForge.Server.ShareCards;

// ============================================================
//  A share link's page (/s/CODE, SharePagesController): the site's
//  index.html with the share's title, description and card in the
//  link-preview tags (the same tags routePagesPlugin.ts fills for each
//  page at build), and noindex — a share is one player's snapshot.
//  Every word is HTML-encoded; ShareSummary makes them all.
// ============================================================
public static class SharePage
{
    // index.html with this share's words in its head.
    public static string Html(string index, ShareSummary s, string url)
    {
        string E(string v) => WebUtility.HtmlEncode(v);
        var title = E(s.Title());
        var description = E(s.Description());
        var image = E($"{url}/card.png");
        var alt = E(s.HasNumbers ? s.Title().Replace(" — TowerForge", "") + ", shared on TowerForge" : "A shared The Tower build on TowerForge");
        var swaps = new (string Pattern, string Put)[]
        {
            (@"<title>[^<]*</title>", $"<title>{title}</title>"),
            (@"<meta name=""description"" content=""[^""]*""\s*/?>", $@"<meta name=""description"" content=""{description}"" />"),
            (@"<link rel=""canonical"" href=""[^""]*""\s*/?>", $@"<link rel=""canonical"" href=""{E(url)}"" />"),
            (@"<meta property=""og:title"" content=""[^""]*""\s*/?>", $@"<meta property=""og:title"" content=""{title}"" />"),
            (@"<meta property=""og:description"" content=""[^""]*""\s*/?>", $@"<meta property=""og:description"" content=""{description}"" />"),
            (@"<meta property=""og:url"" content=""[^""]*""\s*/?>", $@"<meta property=""og:url"" content=""{E(url)}"" />"),
            (@"<meta property=""og:image"" content=""[^""]*""\s*/?>", $@"<meta property=""og:image"" content=""{image}"" />"),
            (@"<meta property=""og:image:alt"" content=""[^""]*""\s*/?>", $@"<meta property=""og:image:alt"" content=""{alt}"" />"),
            (@"<meta name=""twitter:title"" content=""[^""]*""\s*/?>", $@"<meta name=""twitter:title"" content=""{title}"" />"),
            (@"<meta name=""twitter:description"" content=""[^""]*""\s*/?>", $@"<meta name=""twitter:description"" content=""{description}"" />"),
            (@"<meta name=""twitter:image"" content=""[^""]*""\s*/?>", $@"<meta name=""twitter:image"" content=""{image}"" />"),
        };
        var html = index;
        foreach (var (pattern, put) in swaps) html = new Regex(pattern).Replace(html, _ => put, 1);
        return NoIndex(html);
    }

    public static string NoIndex(string html) =>
        html.Replace("</head>", "    <meta name=\"robots\" content=\"noindex\" />\n</head>");
}
