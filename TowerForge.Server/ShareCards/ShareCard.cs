using System.Globalization;
using System.Text.Json.Nodes;

namespace TowerForge.Server.ShareCards;

// ============================================================
//  The share-link preview card (1200 × 630): what Discord, Reddit and
//  X show for towerforge.net/s/CODE. The background and the letters
//  are drawn on Windows by towerforge.client/scripts/share-card.ps1
//  (card-base.png, glyphs.png/json, built into the server); this adds
//  the share's own words over them: the league, the tier and best wave
//  in the game's wave-counter badges (like the home page), the build,
//  what the share holds, and its address. Only words made here are
//  written (ShareSummary checks every value), from the sheet's letters.
// ============================================================
public sealed class ShareCardRenderer
{
    public const int Width = 1200, Height = 630;

    private sealed record Glyph(int X, int Y, int W, int H, double Advance);
    private sealed record Style(double Ascent, int Pad, Dictionary<char, Glyph> Glyphs);

    private readonly Png.Image _base;
    private readonly Png.Image _sheet;
    private readonly Dictionary<string, Style> _styles = [];

    // The site's brand colors (the default Synthwave theme), as on og-image.png.
    private static readonly (byte R, byte G, byte B) Bright = (0xf8, 0xf3, 0xfe), Dim = (0xc3, 0xb8, 0xd8),
        Pink = (0xff, 0x4f, 0xa3), Rim = (0xec, 0xe6, 0xff), BadgeTop = (0x8a, 0x7d, 0xff), BadgeLow = (0x4a, 0x3f, 0xa8),
        BadgeGlow = (0x7b, 0x6d, 0xff);

    private const int Left = 66;
    private const int TextRight = 680;   // the range ring starts past here

    public ShareCardRenderer(byte[] basePng, byte[] sheetPng, string sheetJson)
    {
        _base = Png.Decode(basePng);
        _sheet = Png.Decode(sheetPng);
        if (_base.Width != Width || _base.Height != Height) throw new InvalidDataException("card-base.png isn't 1200 × 630.");
        var styles = JsonNode.Parse(sheetJson)!["styles"]!.AsObject();
        foreach (var (name, node) in styles)
        {
            var glyphs = new Dictionary<char, Glyph>();
            foreach (var g in node!["glyphs"]!.AsArray())
            {
                var a = g!.AsArray();
                glyphs[(char)a[0]!.GetValue<int>()] = new Glyph(a[1]!.GetValue<int>(), a[2]!.GetValue<int>(), a[3]!.GetValue<int>(), a[4]!.GetValue<int>(), a[5]!.GetValue<double>());
            }
            _styles[name] = new Style(node["ascent"]!.GetValue<double>(), node["pad"]!.GetValue<int>(), glyphs);
        }
    }

    // The pictures built into the server (TowerForge.Server.csproj).
    public static ShareCardRenderer FromAssembly()
    {
        var asm = typeof(ShareCardRenderer).Assembly;
        byte[] Read(string name)
        {
            using var s = asm.GetManifestResourceStream($"ShareCards.{name}") ?? throw new FileNotFoundException(name);
            using var m = new MemoryStream();
            s.CopyTo(m);
            return m.ToArray();
        }
        return new ShareCardRenderer(Read("card-base.png"), Read("glyphs.png"), System.Text.Encoding.UTF8.GetString(Read("glyphs.json")));
    }

    public byte[] Render(ShareSummary s, string code)
    {
        var px = (byte[])_base.Rgb.Clone();
        string N(int v) => v.ToString("N0", CultureInfo.InvariantCulture);

        if (s.HasNumbers)
        {
            Text(px, s.League is null ? "Shared build" : $"{s.League} league", "title", Left, 172, Bright);
            int x = Left;
            if (s.Tier > 0) x = Badge(px, x, 204, "tier", s.Tier.ToString(CultureInfo.InvariantCulture)) + 22;
            if (s.Wave > 0) Badge(px, x, 204, $"best wave on T{s.WaveTier}", N(s.Wave));
            int y = 430;
            if (s.Build is not null) { Text(px, $"{s.Build} build", "body", Left, y, Bright); y += 42; }
            var shared = Fit(s, "Shared: ", "body", TextRight - Left);
            if (shared is not null) Text(px, shared, "body", Left, y, Dim);
        }
        else
        {
            Text(px, "Shared build", "title", Left, 200, Bright);
            var shared = Fit(s, "Shared: ", "body", TextRight - Left);
            if (shared is not null) Text(px, shared, "body", Left, 256, Dim);
        }
        Text(px, $"towerforge.net/s/{code}", "url", Left, 572, Pink);
        return Png.Encode(new Png.Image(Width, Height, px));
    }

    // "Shared: UWs, cards and 5 more", as many sections as fit.
    private string? Fit(ShareSummary s, string prefix, string style, int width)
    {
        for (int max = s.Sections.Count; max >= 1; max--)
        {
            var text = prefix + s.SectionsText(max);
            if (Measure(text, style) <= width) return text;
        }
        return null;
    }

    public double Measure(string text, string style)
    {
        var st = _styles[style];
        return text.Sum(ch => (st.Glyphs.GetValueOrDefault(ch) ?? st.Glyphs['?']).Advance);
    }

    // Writes `text` with its baseline at `baseline`; returns where it ended.
    private double Text(byte[] px, string text, string style, double x, double baseline, (byte R, byte G, byte B) color)
    {
        var st = _styles[style];
        foreach (var ch in text)
        {
            var g = st.Glyphs.GetValueOrDefault(ch) ?? st.Glyphs['?'];
            int ox = (int)Math.Round(x) - st.Pad, oy = (int)Math.Round(baseline - st.Ascent) - st.Pad;
            for (int j = 0; j < g.H; j++)
            {
                int py = oy + j;
                if (py < 0 || py >= Height) continue;
                for (int i = 0; i < g.W; i++)
                {
                    int pxX = ox + i;
                    if (pxX < 0 || pxX >= Width) continue;
                    // The sheet is white on black: red is how much of the pixel the letter covers.
                    int cover = _sheet.Rgb[((g.Y + j) * _sheet.Width + g.X + i) * 3];
                    if (cover > 0) Blend(px, pxX, py, color, cover / 255.0);
                }
            }
            x += g.Advance;
        }
        return x;
    }

    // The game's wave counter: a glossy violet badge with a light rim, a
    // small word over a big number. Returns its right edge.
    private int Badge(byte[] px, int x, int top, string label, string value)
    {
        const int h = 150, r = 22, padX = 30;
        int w = (int)Math.Ceiling(Math.Max(Math.Max(Measure(label, "label"), Measure(value, "value")) + 2 * padX, 150));
        RoundRect(px, x, top, w, h, r);
        Text(px, label, "label", x + (w - Measure(label, "label")) / 2, top + 38, Bright);
        Text(px, value, "value", x + (w - Measure(value, "value")) / 2, top + 126, Bright);
        return x + w;
    }

    // A rounded rectangle from its distance field: a soft glow outside,
    // a top-to-bottom gradient inside, a 3px rim — all anti-aliased.
    private static void RoundRect(byte[] px, int x, int y, int w, int h, int r)
    {
        const double rim = 3, glow = 16;
        double cx = x + w / 2.0, cy = y + h / 2.0, hx = w / 2.0 - r, hy = h / 2.0 - r;
        int m = (int)(glow * 3);
        for (int py = Math.Max(0, y - m); py < Math.Min(Height, y + h + m); py++)
        {
            for (int pxX = Math.Max(0, x - m); pxX < Math.Min(Width, x + w + m); pxX++)
            {
                double qx = Math.Abs(pxX + 0.5 - cx) - hx, qy = Math.Abs(py + 0.5 - cy) - hy;
                double d = Math.Sqrt(Math.Pow(Math.Max(qx, 0), 2) + Math.Pow(Math.Max(qy, 0), 2)) + Math.Min(Math.Max(qx, qy), 0) - r;
                if (d > 0) Blend(px, pxX, py, BadgeGlow, 0.5 * Math.Exp(-d / glow) * Math.Clamp(d, 0, 1));
                double inside = Math.Clamp(0.5 - d, 0, 1);
                if (inside <= 0) continue;
                double t = Math.Clamp((py - y) / (double)h, 0, 1);
                var fill = ((byte)(BadgeTop.R + (BadgeLow.R - BadgeTop.R) * t), (byte)(BadgeTop.G + (BadgeLow.G - BadgeTop.G) * t), (byte)(BadgeTop.B + (BadgeLow.B - BadgeTop.B) * t));
                Blend(px, pxX, py, fill, inside);
                double onRim = Math.Clamp(0.5 - (Math.Abs(d + rim / 2) - rim / 2), 0, 1);
                if (onRim > 0) Blend(px, pxX, py, Rim, onRim);
            }
        }
    }

    private static void Blend(byte[] px, int x, int y, (byte R, byte G, byte B) c, double a)
    {
        int i = (y * Width + x) * 3;
        px[i] = (byte)(px[i] + (c.R - px[i]) * a + 0.5);
        px[i + 1] = (byte)(px[i + 1] + (c.G - px[i + 1]) * a + 0.5);
        px[i + 2] = (byte)(px[i + 2] + (c.B - px[i + 2]) * a + 0.5);
    }
}
