[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot "Logo/Logo.png"
$assetsPath = Join-Path $projectRoot "assets"

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "No se encuentra el logo fuente: $sourcePath"
}
New-Item -ItemType Directory -Force -Path $assetsPath | Out-Null
Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath([System.Drawing.RectangleF]$Rectangle, [single]$Radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($Rectangle.X, $Rectangle.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rectangle.X, $Rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$logo = [System.Drawing.Bitmap]::new($sourcePath)
try {
  foreach ($size in @(180, 192, 512)) {
    $bitmap = [System.Drawing.Bitmap]::new(
      $size,
      $size,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.Clear([System.Drawing.Color]::FromArgb(17, 18, 26))

      $outer = [System.Drawing.RectangleF]::new($size * 0.055, $size * 0.055, $size * 0.89, $size * 0.89)
      $outerPath = New-RoundedRectanglePath $outer ($size * 0.13)
      $goldBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(231, 174, 77))
      try { $graphics.FillPath($goldBrush, $outerPath) } finally { $goldBrush.Dispose(); $outerPath.Dispose() }

      $inner = [System.Drawing.RectangleF]::new($size * 0.105, $size * 0.105, $size * 0.79, $size * 0.79)
      $innerPath = New-RoundedRectanglePath $inner ($size * 0.09)
      $paperBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
      try { $graphics.FillPath($paperBrush, $innerPath) } finally { $paperBrush.Dispose(); $innerPath.Dispose() }

      $maxWidth = $size * 0.70
      $maxHeight = $size * 0.55
      $scale = [Math]::Min($maxWidth / $logo.Width, $maxHeight / $logo.Height)
      $drawWidth = [single]($logo.Width * $scale)
      $drawHeight = [single]($logo.Height * $scale)
      $destination = [System.Drawing.RectangleF]::new(
        ($size - $drawWidth) / 2,
        ($size - $drawHeight) / 2,
        $drawWidth,
        $drawHeight
      )
      $graphics.DrawImage($logo, $destination)

      $outputPath = Join-Path $assetsPath "pwa-icon-$size.png"
      $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output "Generado: $outputPath ($size x $size)"
    }
    finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
}
finally {
  $logo.Dispose()
}
