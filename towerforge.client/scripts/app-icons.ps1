# ============================================================
#  TowerForge — app icons (installing the site as an app)
#  Draws the home page's neon tower (components/common/TowerArt,
#  TowerShape: 120 x 190 units) in its range ring on the site's dark
#  background, in the default theme's two accents, into public/icons/:
#    icon-192.png, icon-512.png    rounded square ("any": desktops, Chrome)
#    icon-maskable-512.png         full bleed, tower in the middle 60%
#                                  (Android crops it to its own shape)
#    apple-touch-icon.png (180)    full bleed square (iOS rounds it)
#  Listed in public/manifest.webmanifest and index.html. Rerun after
#  changing the art:
#    powershell -ExecutionPolicy Bypass -File scripts\app-icons.ps1
# ============================================================

Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\public\icons'
New-Item -ItemType Directory -Force $out | Out-Null

$accent  = [System.Drawing.Color]::FromArgb(255, 255, 79, 163)    # --accent (synthwave)
$accent2 = [System.Drawing.Color]::FromArgb(255, 123, 109, 255)   # --accent-2
$bgTop   = [System.Drawing.Color]::FromArgb(255, 30, 18, 52)
$bgBot   = [System.Drawing.Color]::FromArgb(255, 11, 8, 18)       # --bg

# TowerShape's outlines, in its 120 x 190 box: [color, closed, x1,y1, x2,y2 …]
$shapes = @(
    @('a', $true,  38,22, 82,22, 88,34, 88,62, 32,62, 32,34),
    @('a', $true,  12,34, 32,34, 32,48, 12,48),
    @('a', $true,  44,62, 76,62, 78,76, 42,76),
    @('a', $true,  42,76, 78,76, 96,150, 24,150),
    @('b', $true,  48,32, 72,32, 72,52, 48,52),
    @('b', $true,  54,88, 66,88, 72,140, 48,140),
    @('b', $false, 24,150, 32,178, 48,178, 52,150),
    @('b', $false, 68,150, 72,178, 88,178, 96,150)
)

function New-RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, $r * 2, $r * 2, 180, 90)
    $p.AddArc($x + $w - $r * 2, $y, $r * 2, $r * 2, 270, 90)
    $p.AddArc($x + $w - $r * 2, $y + $h - $r * 2, $r * 2, $r * 2, 0, 90)
    $p.AddArc($x, $y + $h - $r * 2, $r * 2, $r * 2, 90, 90)
    $p.CloseFigure()
    return $p
}

function Draw-Icon([int]$size, [bool]$rounded, [double]$towerShare, [string]$file) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $bgTop, $bgBot, 90
    if ($rounded) { $g.FillPath($bg, (New-RoundRect 0 0 $size $size ($size * 0.22))) } else { $g.FillRectangle($bg, $rect) }

    # The range ring, faint, and a soft glow behind the tower.
    $c = $size / 2
    $ringR = $size * $towerShare * 0.62
    $glow = New-Object System.Drawing.Drawing2D.GraphicsPath
    $glow.AddEllipse($c - $ringR, $c - $ringR, $ringR * 2, $ringR * 2)
    $pg = New-Object System.Drawing.Drawing2D.PathGradientBrush $glow
    $pg.CenterColor = [System.Drawing.Color]::FromArgb(70, 255, 79, 163)
    $pg.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 79, 163))
    $g.FillPath($pg, $glow)
    $ringPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(110, 255, 79, 163)), ([single]($size * 0.012))
    $g.DrawEllipse($ringPen, $c - $ringR, $c - $ringR, $ringR * 2, $ringR * 2)

    # The tower, centred: 190 units tall = towerShare of the icon.
    $k = $size * $towerShare / 190
    $ox = $c - 60 * $k
    $oy = $c - 100 * $k
    foreach ($pass in 'glow', 'line') {
        foreach ($s in $shapes) {
            $col = if ($s[0] -eq 'a') { $accent } else { $accent2 }
            $pts = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
            for ($i = 2; $i -lt $s.Count; $i += 2) { $pts.Add((New-Object System.Drawing.PointF ([single]($ox + $s[$i] * $k)), ([single]($oy + $s[$i + 1] * $k)))) }
            if ($pass -eq 'glow') {
                $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, $col.R, $col.G, $col.B)), ([single](9 * $k))
            } else {
                $pen = New-Object System.Drawing.Pen $col, ([single](3.4 * $k))
            }
            $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
            $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            if ($s[1]) { $g.DrawPolygon($pen, $pts.ToArray()) } else { $g.DrawLines($pen, $pts.ToArray()) }
            $pen.Dispose()
        }
    }

    $g.Dispose()
    $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    "wrote $file"
}

Draw-Icon 192 $true 0.62 'icon-192.png'
Draw-Icon 512 $true 0.62 'icon-512.png'
Draw-Icon 512 $false 0.50 'icon-maskable-512.png'
Draw-Icon 180 $false 0.60 'apple-touch-icon.png'
