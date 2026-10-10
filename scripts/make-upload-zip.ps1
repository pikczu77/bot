# Builds the upload archive for the bot host. Entry names use forward slashes so the
# archive unpacks correctly on Linux.
param(
    [string]$Root = 'C:\Users\User\Downloads\heygen\discord bot\titanbot-src',
    [string]$ZipPath = 'C:\Users\User\Downloads\heygen\discord bot\klubik-pikcza-upload-v3.zip'
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if ([System.IO.File]::Exists($ZipPath)) { [System.IO.File]::Delete($ZipPath) }

$zip = [System.IO.Compression.ZipFile]::Open($ZipPath, 'Create')
$count = 0
try {
    foreach ($folder in 'src', 'scripts', 'lavalink') {
        foreach ($file in Get-ChildItem (Join-Path $Root $folder) -Recurse -File) {
            $relative = $file.FullName.Substring($Root.Length + 1) -replace '\\', '/'
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relative, 'Optimal')
            $count++
        }
    }
    foreach ($name in 'index.js', 'package.json', 'package-lock.json', 'LICENSE', '.env.example') {
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $Root $name), $name, 'Optimal')
        $count++
    }
}
finally {
    $zip.Dispose()
}

$check = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
$backslashes = @($check.Entries | Where-Object { $_.FullName.Contains('\') }).Count
$secrets = @($check.Entries | Where-Object { $_.FullName -match '(^|/)\.env$|node_modules|^test/' }).Count
$locales = @($check.Entries | Where-Object { $_.FullName -like 'src/i18n/locales/*' }).Count
$check.Dispose()

"entries: $count  size: $([Math]::Round((Get-Item $ZipPath).Length / 1KB)) KB  backslash names: $backslashes  secret/test entries: $secrets  locale files: $locales"
