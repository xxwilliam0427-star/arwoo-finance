<#
  Arwoo 财务助手 —— 截图文字识别（调用 Windows 自带的 OCR 引擎，完全离线）

  用法:
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/ocr.ps1 `
        -ImagePath "C:\path\to\shot.png" -OutPath "C:\path\to\result.json"

  输出 JSON:
    成功 { ok:true, engine, language, width, height, words:[{t,x,y,w,h}] }
    失败 { ok:false, error }

  这里刻意只用 ASCII 字符，避免 PowerShell 5.1 读脚本时的编码问题。
#>

param(
  [Parameter(Mandatory = $true)][string]$ImagePath,
  [Parameter(Mandatory = $true)][string]$OutPath,
  [string]$LanguageTag = 'zh-Hans-CN'
)

$ErrorActionPreference = 'Stop'

function Write-Result($obj) {
  $json = $obj | ConvertTo-Json -Depth 6 -Compress
  [System.IO.File]::WriteAllText($OutPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

try {
  if (-not (Test-Path -LiteralPath $ImagePath)) { throw 'image file not found' }

  Add-Type -AssemblyName System.Runtime.WindowsRuntime

  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

  function Await($op, $type) {
    $m = $asTaskGeneric.MakeGenericMethod($type)
    $t = $m.Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    $t.Result
  }

  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

  $lang = $null
  try { $lang = New-Object Windows.Globalization.Language $LanguageTag } catch { $lang = $null }

  $engine = $null
  if ($lang) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang) }
  if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if (-not $engine) { throw 'no OCR language pack available on this system' }

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

  $result = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])

  $words = New-Object System.Collections.ArrayList
  foreach ($line in $result.Lines) {
    foreach ($w in $line.Words) {
      $r = $w.BoundingRect
      [void]$words.Add([pscustomobject]@{
        t = $w.Text
        x = [math]::Round($r.X, 1)
        y = [math]::Round($r.Y, 1)
        w = [math]::Round($r.Width, 1)
        h = [math]::Round($r.Height, 1)
      })
    }
  }

  $stream.Dispose()
  $bmp.Dispose()

  Write-Result ([pscustomobject]@{
    ok       = $true
    engine   = 'windows-ocr'
    language = $engine.RecognizerLanguage.LanguageTag
    width    = $decoder.PixelWidth
    height   = $decoder.PixelHeight
    words    = @($words)
  })
  exit 0
}
catch {
  Write-Result ([pscustomobject]@{ ok = $false; error = $_.Exception.Message })
  exit 1
}
