Add-Type -AssemblyName System.Drawing
$folder = "d:\mb bloods\frontend\assets\our work"
Get-ChildItem -Path $folder -Filter "*.jpg" | ForEach-Object {
    if ($_.Length -gt 400KB) {
        try {
            $img = [System.Drawing.Image]::FromFile($_.FullName)
            $scale = [math]::Sqrt(400KB / $_.Length)
            if ($scale -ge 1.0) { $scale = 0.5 }
            $w = [math]::Max(100, [int]($img.Width * $scale))
            $h = [math]::Max(100, [int]($img.Height * $scale))
            $bmp = New-Object System.Drawing.Bitmap($img, $w, $h)
            $img.Dispose()
            $outPath = $_.FullName + ".tmp.jpg"
            $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
            $bmp.Dispose()
            Remove-Item $_.FullName -Force
            Move-Item $outPath $_.FullName -Force
            Write-Host "Compressed $($_.Name)"
        } catch {
            Write-Host "Error processing $($_.Name): $_"
        }
    }
}
