$ErrorActionPreference = 'Stop'
$envPath = Join-Path $PSScriptRoot '.env'
if (Test-Path $envPath) {
  Write-Host 'Bu klasörde .env dosyası zaten var.' -ForegroundColor Yellow
  $answer = Read-Host 'Üzerine yazmak istiyor musun? (E/H)'
  if ($answer -notin @('E','e','EVET','evet')) { Write-Host 'İşlem iptal edildi.'; exit 0 }
}
Write-Host ''
Write-Host 'LiveKit proje URL adresi ayarlı:' -ForegroundColor Cyan
Write-Host 'wss://motorcu-radyosu-918cyaue.livekit.cloud'
$apiKey = Read-Host 'LiveKit API Key değerini gir'
if ([string]::IsNullOrWhiteSpace($apiKey)) { throw 'API Key boş bırakılamaz.' }
$secureSecret = Read-Host 'LiveKit API Secret değerini gir (yazarken görünmez)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try { $apiSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
if ([string]::IsNullOrWhiteSpace($apiSecret)) { throw 'API Secret boş bırakılamaz.' }
$consolePin = Read-Host 'Yayin konsolu icin PIN belirle (bos birakirsan 123456 kullanilir)'
if ([string]::IsNullOrWhiteSpace($consolePin)) { $consolePin = '123456' }
$lines = @(
  'LIVEKIT_URL=wss://motorcu-radyosu-918cyaue.livekit.cloud',
  "LIVEKIT_API_KEY=$apiKey",
  "LIVEKIT_API_SECRET=$apiSecret",
  'LIVEKIT_ROOM=motorcu-radyosu',
  "CONSOLE_PIN=$consolePin"
)
[IO.File]::WriteAllLines($envPath, $lines, [Text.UTF8Encoding]::new($false))
$apiSecret = $null
$secureSecret.Dispose()
Write-Host ''
Write-Host 'LiveKit bilgileri bu klasördeki .env dosyasına kaydedildi.' -ForegroundColor Green
Write-Host 'Gizli anahtarı kimseyle paylaşma; .env dosyasını göndermeyin.' -ForegroundColor Yellow
