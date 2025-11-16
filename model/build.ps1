# Load environment variables from env.bat
if (Test-Path "./env.bat") {
    Get-Content "./env.bat" | ForEach-Object {
        if ($_ -match 'set\s+([^=]+)=(.+)') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"')
            [System.Environment]::SetEnvironmentVariable($key, $value)
            Write-Output "Loaded env var: $key"
        }
    }
}

$ProjectRoot = (Get-Item -Path "..").FullName
$ProtoRoot = "$ProjectRoot\model"
$DartOut = "$ProjectRoot\client\common\peers_touch_base\lib\model"

Write-Output "Project Root: $ProjectRoot"
Write-Output "Proto Root: $ProtoRoot"
Write-Output "Dart Output Directory: $DartOut"

if (-not (Test-Path $DartOut)) {
    Write-Output "Creating Dart output directory: $DartOut"
    New-Item -ItemType Directory -Force -Path $DartOut | Out-Null
}

$protoFiles = Get-ChildItem -Path $ProtoRoot -Filter *.proto -Recurse | ForEach-Object { $_.FullName }

if ($protoFiles.Count -eq 0) {
    Write-Output "No .proto files found. Exiting."
    exit
}

$pluginPath = [System.Environment]::GetEnvironmentVariable("PROTOC_GEN_DART_PLUGIN")
if (-not [string]::IsNullOrEmpty($pluginPath)) {
    $plugin = "--plugin=protoc-gen-dart=`"$pluginPath`""
    Write-Output "Running protoc for Dart with plugin..."
    protoc $plugin --dart_out="$DartOut" -I"$ProtoRoot" $protoFiles
} else {
    Write-Output "Running protoc for Dart..."
    protoc --dart_out="$DartOut" -I"$Protoort" $protoFiles
}

Write-Output "Protobuf code generation complete."