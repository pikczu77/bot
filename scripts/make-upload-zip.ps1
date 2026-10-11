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
$sourceFiles = @()
try {
    foreach ($folder in 'src', 'scripts', 'lavalink') {
        foreach ($file in Get-ChildItem (Join-Path $Root $folder) -Recurse -File) {
            $relative = $file.FullName.Substring($Root.Length + 1) -replace '\\', '/'
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relative, 'Optimal')
            if ($folder -eq 'src') { $sourceFiles += $relative }
            $count++
        }
    }

    # The host unpacks over the previous upload. This list lets the bot move files that
    # are no longer shipped out of src/ at startup (src/utils/staleFiles.js). It exists
    # only inside the archive, never in the working folder.
    $listJson = @{ files = $sourceFiles } | ConvertTo-Json -Compress
    $writer = New-Object System.IO.StreamWriter($zip.CreateEntry('release-files.json', 'Optimal').Open(), (New-Object System.Text.UTF8Encoding($false)))
    $writer.Write($listJson)
    $writer.Dispose()
    $count++
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

"entries: $count  size: $([Math]::Round((Get-Item $ZipPath).Length / 1KB)) KB  backslash names: $backslashes  secret/test entries: $secrets  locale files: $locales  listed src files: $($sourceFiles.Count)"
