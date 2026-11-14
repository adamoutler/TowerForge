# ============================================================
#  TowerForge Companion — share-link preview card, the drawn parts
#  A share link (towerforge.net/s/CODE) shows a 1200×630 card in Discord,
#  Reddit and X with the shared tier and best wave. The server draws it
#  (TowerForge.Server/ShareCards) from two pictures made here, so it
#  needs no drawing library:
#    card-base.png   the background: the site's colors (Synthwave), the
#                    wordmark, and the tower in its range ring with
#                    enemies walking in (like the home page)
#    glyphs.png/json the letters it writes with, white on black, one
#                    cell each (Bahnschrift and Segoe UI, Windows fonts),
#                    with each one's advance and the styles' ascents
#  Run from towerforge.client/ after changing the look, then rebuild the
#  server:
#    powershell -ExecutionPolicy Bypass -File scripts\share-card.ps1
# ============================================================

Add-Type -AssemblyName System.Drawing
$outDir = Join-Path $PSScriptRoot '..\..\TowerForge.Server\ShareCards'
New-Item -ItemType Directory -Force $outDir | Out-Null

$W = 1200; $H = 630
$pink = [System.Drawing.ColorTranslator]::FromHtml('#ff4fa3')
$violet = [System.Drawing.ColorTranslator]::FromHtml('#7b6dff')
$bright = [System.Drawing.ColorTranslator]::FromHtml('#f8f3fe')
$gold = [System.Drawing.ColorTranslator]::FromHtml('#ffc14d')
$red = [System.Drawing.ColorTranslator]::FromHtml('#ff5c7a')
$plus = [System.Drawing.ColorTranslator]::FromHtml('#b98cff')

function Alpha($c, $a) { [System.Drawing.Color]::FromArgb($a, $c.R, $c.G, $c.B) }

# ── The background ────────────────────────────────────────────
$bmp = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.InterpolationMode = 'HighQualityBicubic'
$g.TextRenderingHint = 'AntiAliasGridFit'

function Glow($cx, $cy, $rx, $ry, $c, $a) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddEllipse([single]($cx - $rx), [single]($cy - $ry), [single](2 * $rx), [single](2 * $ry))
    $b = New-Object System.Drawing.Drawing2D.PathGradientBrush $p
    $b.CenterColor = Alpha $c $a
    $b.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $c.R, $c.G, $c.B))
    $g.FillPath($b, $p)
}

function Shape($figures, $s, $ox, $oy) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    foreach ($f in $figures) {
        $pts = for ($i = 0; $i -lt $f.pts.Count; $i += 2) { New-Object System.Drawing.PointF ([single]($ox + $f.pts[$i] * $s)), ([single]($oy + $f.pts[$i + 1] * $s)) }
        $p.StartFigure()
        $p.AddLines([System.Drawing.PointF[]]$pts)
        if ($f.closed) { $p.CloseFigure() }
    }
    $p
}

function Neon($path, $c, $width) {
    foreach ($pass in @(@(4.5, 28), @(2.6, 60), @(1.6, 110))) {
        $pen = New-Object System.Drawing.Pen (Alpha $c $pass[1]), ([single]($width * $pass[0]))
        $pen.LineJoin = 'Round'; $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
        $g.DrawPath($pen, $path)
    }
    $pen = New-Object System.Drawing.Pen $c, ([single]$width)
    $pen.LineJoin = 'Round'; $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
    $g.DrawPath($pen, $path)
}

$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point 0, $H), ([System.Drawing.ColorTranslator]::FromHtml('#0b0812')), ([System.Drawing.ColorTranslator]::FromHtml('#140f20'))
$g.FillRectangle($bg, 0, 0, $W, $H)
Glow 160 -60 560 300 $pink 60
Glow 940 330 330 300 $violet 70
Glow 600 720 700 220 $violet 30

# Wordmark, top left.
$titleFont = New-Object System.Drawing.FontFamily 'Bahnschrift SemiBold'
$fmt = [System.Drawing.StringFormat]::GenericTypographic
$tower = New-Object System.Drawing.Drawing2D.GraphicsPath ([System.Drawing.Drawing2D.FillMode]::Winding)
$tower.AddString('TOWER', $titleFont, 0, 40, (New-Object System.Drawing.PointF 66, 50), $fmt)
$tb = $tower.GetBounds()
$forge = New-Object System.Drawing.Drawing2D.GraphicsPath ([System.Drawing.Drawing2D.FillMode]::Winding)
$forge.AddString('FORGE', $titleFont, 0, 40, (New-Object System.Drawing.PointF ([single]($tb.Right + 3)), 50), $fmt)
$fb = $forge.GetBounds()
foreach ($pass in @(@(10, 22), @(5, 45))) {
    $tp = New-Object System.Drawing.Pen (Alpha $pink $pass[1]), $pass[0]; $tp.LineJoin = 'Round'
    $fp = New-Object System.Drawing.Pen (Alpha $violet $pass[1]), $pass[0]; $fp.LineJoin = 'Round'
    $g.DrawPath($tp, $tower)
    $g.DrawPath($fp, $forge)
}
$g.FillPath((New-Object System.Drawing.SolidBrush $bright), $tower)
$fg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF $fb.Left, 0), (New-Object System.Drawing.PointF $fb.Right, 0), $pink, $violet
$g.FillPath($fg, $forge)

# The range ring, right: the home page's scene, bigger.
$cx = 940; $cy = 330; $R = 205
$ring = New-Object System.Drawing.Drawing2D.GraphicsPath
$ring.AddEllipse([single]($cx - $R), [single]($cy - $R), [single](2 * $R), [single](2 * $R))
Neon $ring (Alpha $violet 200) 2.5
$inner = New-Object System.Drawing.Pen (Alpha $violet 70), 2
$inner.DashPattern = @(3, 4)
$g.DrawEllipse($inner, [single]($cx - 138), [single]($cy - 138), [single]276, [single]276)
foreach ($oy in @(-138, 138)) {
    $orb = New-Object System.Drawing.Drawing2D.GraphicsPath
    $orb.AddEllipse([single]($cx - 9), [single]($cy + $oy - 9), [single]18, [single]18)
    $g.FillPath((New-Object System.Drawing.SolidBrush (Alpha $plus 230)), $orb)
    Neon $orb $plus 1.5
}

# Tower (TowerArt viewBox 120 × 190), centered in the ring.
$s = 1.45; $ox = $cx - 60 * $s; $oy = $cy - 100 * $s
$towerPink = Shape @(
    @{ pts = @(38, 22, 82, 22, 88, 34, 88, 62, 32, 62, 32, 34); closed = $true },
    @{ pts = @(12, 34, 32, 34, 32, 48, 12, 48); closed = $true },
    @{ pts = @(44, 62, 76, 62, 78, 76, 42, 76); closed = $true },
    @{ pts = @(42, 76, 78, 76, 96, 150, 24, 150); closed = $true }
) $s $ox $oy
$towerViolet = Shape @(
    @{ pts = @(48, 32, 72, 32, 72, 52, 48, 52); closed = $true },
    @{ pts = @(54, 88, 66, 88, 72, 140, 48, 140); closed = $true },
    @{ pts = @(24, 150, 32, 178, 48, 178, 52, 150); closed = $false },
    @{ pts = @(68, 150, 72, 178, 88, 178, 96, 150); closed = $false }
) $s $ox $oy
Neon $towerPink $pink 4
Neon $towerViolet $violet 4

# Enemies on and just outside the ring, in the game's shapes.
$enemies = @(
    @{ deg = 205; d = 0; kind = 'square'; c = $red },
    @{ deg = 330; d = 28; kind = 'triangle'; c = $gold },
    @{ deg = 62; d = 12; kind = 'square'; c = $red },
    @{ deg = 128; d = 34; kind = 'triangle'; c = $gold },
    @{ deg = 268; d = 20; kind = 'square'; c = $red },
    @{ deg = 18; d = 4; kind = 'square'; c = $plus }
)
foreach ($e in $enemies) {
    $a = $e.deg * [Math]::PI / 180
    $ex = $cx + ($R + $e.d) * [Math]::Cos($a); $ey = $cy + ($R + $e.d) * [Math]::Sin($a)
    if ($e.kind -eq 'square') {
        $p = Shape @(@{ pts = @(-11, -11, 11, -11, 11, 11, -11, 11); closed = $true }) 1 $ex $ey
    } else {
        $p = Shape @(@{ pts = @(0, -13, 12, 10, -12, 10); closed = $true }) 1 $ex $ey
    }
    $g.FillPath((New-Object System.Drawing.SolidBrush (Alpha $e.c 60)), $p)
    Neon $p $e.c 2.5
}

$bmp.Save((Join-Path $outDir 'card-base.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

# ── The letters ───────────────────────────────────────────────
# Each style: the font and size it's drawn at (pixels). The server
# writes with these only, at these sizes.
$styles = @(
    @{ name = 'value'; family = 'Bahnschrift SemiBold'; size = 92 },
    @{ name = 'title'; family = 'Bahnschrift SemiBold'; size = 44 },
    @{ name = 'url'; family = 'Bahnschrift SemiBold'; size = 30 },
    @{ name = 'label'; family = 'Segoe UI Semibold'; size = 25 },
    @{ name = 'body'; family = 'Segoe UI'; size = 28 }
)
$chars = 32..126 | ForEach-Object { [char]$_ }
$measureFmt = [System.Drawing.StringFormat]::GenericTypographic.Clone()
$measureFmt.FormatFlags = $measureFmt.FormatFlags -bor [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces
$scratch = New-Object System.Drawing.Bitmap 8, 8
$mg = [System.Drawing.Graphics]::FromImage($scratch)
$mg.TextRenderingHint = 'AntiAliasGridFit'

# Lay out every cell first (rows across a 2048-wide sheet), then draw.
$sheetW = 2048
$x = 0; $y = 0; $rowH = 0
$meta = @{}
$cells = @()
foreach ($st in $styles) {
    $ff = New-Object System.Drawing.FontFamily $st.family
    $font = New-Object System.Drawing.Font $ff, ([single]$st.size), ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
    $em = $ff.GetEmHeight([System.Drawing.FontStyle]::Regular)
    $ascent = $st.size * $ff.GetCellAscent([System.Drawing.FontStyle]::Regular) / $em
    $line = $st.size * $ff.GetLineSpacing([System.Drawing.FontStyle]::Regular) / $em
    $pad = [int][Math]::Ceiling($st.size * 0.25)
    $cellH = [int][Math]::Ceiling($line) + 2 * $pad
    $glyphs = @()
    foreach ($ch in $chars) {
        $adv = $mg.MeasureString([string]$ch, $font, (New-Object System.Drawing.PointF 0, 0), $measureFmt).Width
        $cellW = [int][Math]::Ceiling($adv) + 2 * $pad
        if ($x + $cellW -gt $sheetW) { $x = 0; $y += $rowH; $rowH = 0 }
        $cells += , @{ ch = $ch; font = $font; x = $x; y = $y; pad = $pad }
        $glyphs += , @([int][char]$ch, $x, $y, $cellW, $cellH, [Math]::Round($adv, 3))
        $x += $cellW
        if ($cellH -gt $rowH) { $rowH = $cellH }
    }
    $meta[$st.name] = [ordered]@{ size = $st.size; ascent = [Math]::Round($ascent, 3); lineHeight = [Math]::Round($line, 3); pad = $pad; glyphs = $glyphs }
    # Each style starts a new row.
    $x = 0; $y += $rowH; $rowH = 0
}
$sheetH = $y
$mg.Dispose(); $scratch.Dispose()

$sheet = New-Object System.Drawing.Bitmap $sheetW, $sheetH, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$sg = [System.Drawing.Graphics]::FromImage($sheet)
$sg.Clear([System.Drawing.Color]::Black)
$sg.TextRenderingHint = 'AntiAliasGridFit'
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
foreach ($c in $cells) {
    $sg.DrawString([string]$c.ch, $c.font, $white, [single]($c.x + $c.pad), [single]($c.y + $c.pad), $measureFmt)
}
$sheet.Save((Join-Path $outDir 'glyphs.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$sg.Dispose(); $sheet.Dispose()

$json = [ordered]@{ width = $sheetW; height = $sheetH; styles = $meta } | ConvertTo-Json -Depth 6 -Compress
[System.IO.File]::WriteAllText((Join-Path $outDir 'glyphs.json'), $json, (New-Object System.Text.UTF8Encoding $false))
Write-Output (Resolve-Path $outDir).Path
