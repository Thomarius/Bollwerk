# Draws splash.bmp, the picture the portable Windows app shows while it unpacks itself — some
# ten seconds at every start (measured 2026-10-26), in which nothing else is seen. A still
# picture, in the server window's colours (ui/window.css): the unpacker can show no more.
# Run it again after changing it: powershell -NoProfile -File packages/desktop/splash.ps1
Add-Type -AssemblyName System.Drawing

$width = 480
$height = 220
$image = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($image)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$panel = [System.Drawing.ColorTranslator]::FromHtml('#12131c')
$edge = [System.Drawing.ColorTranslator]::FromHtml('#2c2d3a')
$accent = [System.Drawing.ColorTranslator]::FromHtml('#e0b84a')
$ink = [System.Drawing.ColorTranslator]::FromHtml('#e8e6dc')
$muted = [System.Drawing.ColorTranslator]::FromHtml('#8a8a9a')

$g.Clear($panel)
$g.DrawRectangle((New-Object System.Drawing.Pen $edge, 2), 1, 1, $width - 3, $height - 3)

$centre = New-Object System.Drawing.StringFormat
$centre.Alignment = [System.Drawing.StringAlignment]::Center

function Write-Line($text, $size, $style, $colour, $y) {
  $font = New-Object System.Drawing.Font 'Consolas', $size, $style, ([System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush $colour
  $g.DrawString($text, $font, $brush, (New-Object System.Drawing.RectangleF 0, $y, $width, 60), $centre)
}

# Spaced as the window's title is (letter-spacing 0.3em).
Write-Line 'B O L L W E R K' 34 ([System.Drawing.FontStyle]::Bold) $accent 46
# The ellipsis and the dot by code: Windows PowerShell reads a script without a BOM as ANSI.
$dots = [char]0x2026
Write-Line "Starting$dots $([char]0x00B7) Startet$dots" 18 ([System.Drawing.FontStyle]::Regular) $ink 104
Write-Line 'Unpacking the game takes a few seconds.' 13 ([System.Drawing.FontStyle]::Regular) $muted 150
Write-Line 'Das Entpacken dauert ein paar Sekunden.' 13 ([System.Drawing.FontStyle]::Regular) $muted 170

# 24 bits, as NSIS's BgImage reads it.
$out = New-Object System.Drawing.Bitmap $width, $height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$copy = [System.Drawing.Graphics]::FromImage($out)
$copy.DrawImage($image, 0, 0, $width, $height)
$out.Save((Join-Path $PSScriptRoot 'splash.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$copy.Dispose(); $out.Dispose(); $g.Dispose(); $image.Dispose()
