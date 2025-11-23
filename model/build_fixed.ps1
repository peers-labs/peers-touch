# Set paths (based on script location)
$ScriptRoot = $PSScriptRoot
$ProjectRoot = (Get-Item -Path "$ScriptRoot\..").FullName
$ProtoRoot = "$ProjectRoot\model"
$DartOut = "$ProjectRoot\client\common\peers_touch_base\lib\model"
$GoOut = "$ProjectRoot\station"

Write-Output "Project Root: $ProjectRoot"
Write-Output "Proto Root: $ProtoRoot"
Write-Output "Dart Output Directory: $DartOut"
Write-Output "Go Output Directory: $GoOut"

# Create Dart output directory if it doesn't exist
if (-not (Test-Path $DartOut)) {
    Write-Output "Creating Dart output directory: $DartOut"
    New-Item -ItemType Directory -Force -Path $DartOut | Out-Null
}

# Create Go output directory if it doesn't exist
if (-not (Test-Path $GoOut)) {
    Write-Output "Creating Go output directory: $GoOut"
    New-Item -ItemType Directory -Force -Path $GoOut | Out-Null
}

# Find all .proto files in the domain directory, excluding ai_box_message.proto
$protoFiles = Get-ChildItem -Path "$ProtoRoot\domain" -Filter *.proto -Recurse | Where-Object { $_.FullName -notlike '*\ai_box\ai_box_message.proto' } | ForEach-Object { $_.FullName }

if ($protoFiles.Count -eq 0) {
    Write-Output "No .proto files found. Exiting."
    exit
}

# Run protoc for Dart using dart pub global run
Write-Output "Running protoc for Dart..."
$env:PATH = "$env:PATH;$env:USERPROFILE\AppData\Local\Pub\Cache\bin;$HOME\.pub-cache\bin"
protoc --dart_out=grpc:"$DartOut" -I"$ProtoRoot" $protoFiles

if ($LASTEXITCODE -ne 0) {
    Write-Output "Dart protoc failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

# Run protoc for Go
Write-Output "Running protoc for Go..."
protoc --go_out="$GoOut" --go_opt=module=github.com/peers-labs/peers-touch/station -I"$ProtoRoot" $protoFiles

if ($LASTEXITCODE -ne 0) {
    Write-Output "Go protoc failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Output "Protobuf code generation complete."
