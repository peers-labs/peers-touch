# Set paths
$ProjectRoot = (Get-Item -Path "..").FullName
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

# Run protoc for Dart
Write-Output "Running protoc for Dart..."
protoc --dart_out=grpc:"$DartOut" -I"$ProtoRoot" $protoFiles

# Run protoc for Go
Write-Output "Running protoc for Go..."
protoc --go_out="$GoOut" --go_opt=module=github.com/peers-labs/peers-touch/station -I"$ProtoRoot" $protoFiles

Write-Output "Protobuf code generation complete."