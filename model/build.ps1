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

# Ensure protoc-gen-dart is available and prefer Pub Cache version
Write-Output "Resolving protoc-gen-dart plugin..."
$dartPluginAll = Get-Command -All protoc-gen-dart -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path
if (-not $dartPluginAll) {
    Write-Output "protoc-gen-dart not found. Activating protoc_plugin via Dart..."
    dart pub global activate protoc_plugin | Write-Output
    $dartPluginAll = Get-Command -All protoc-gen-dart -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path
}

# Pick Pub Cache version to avoid repo-local broken plugin
$dartPluginPath = $null
foreach ($p in $dartPluginAll) {
    if ($p -like "*Pub*Cache*bin*protoc-gen-dart*" -or $p -like "*\.pub-cache*bin*protoc-gen-dart*") {
        $dartPluginPath = $p
        break
    }
}
if (-not $dartPluginPath) {
    # Fallback to the first one
    $dartPluginPath = $dartPluginAll | Select-Object -First 1
}
Write-Output "Using protoc-gen-dart: $dartPluginPath"

# Run protoc for Dart with explicit plugin path
Write-Output "Running protoc for Dart..."
protoc --plugin=protoc-gen-dart="$dartPluginPath" --dart_out=grpc:"$DartOut" -I"$ProtoRoot" $protoFiles

# Run protoc for Go (optional on Windows if Go is not installed)
Write-Output "Running protoc for Go..."
$goCmd = Get-Command go -ErrorAction SilentlyContinue
if ($goCmd) {
    $goPlugin = Get-Command protoc-gen-go -ErrorAction SilentlyContinue
    if (-not $goPlugin) {
        Write-Output "protoc-gen-go not found. Attempting to install..."
        try {
            go install google.golang.org/protobuf/cmd/protoc-gen-go@latest | Write-Output
        } catch {
            Write-Output "Failed to install protoc-gen-go: $_"
        }
    }
    protoc --go_out="$GoOut" --go_opt=module=github.com/peers-labs/peers-touch/station -I"$ProtoRoot" $protoFiles
} else {
    Write-Output "Go not found. Skipping Go code generation."
}

Write-Output "Protobuf code generation complete."
