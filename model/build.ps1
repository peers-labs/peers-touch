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
$domainProtoFiles = @(Get-ChildItem -Path "$ProtoRoot\domain" -Filter *.proto -Recurse | Where-Object { $_.FullName -notlike '*\ai_box\ai_box_message.proto' } | ForEach-Object { $_.FullName })

if ($domainProtoFiles.Count -eq 0) {
    Write-Output "No .proto files found in domain. Exiting."
    exit
}

# Prepare files for Dart (includes Google protos)
$dartProtoFiles = $domainProtoFiles.Clone()
$googleProtos = @("struct.proto", "any.proto", "timestamp.proto")
foreach ($gProto in $googleProtos) {
    $gPath = "$ProtoRoot\google\protobuf\$gProto"
    if (Test-Path $gPath) {
        $dartProtoFiles += $gPath
    }
}

# Prepare files for Go (domain only)
$goProtoFiles = $domainProtoFiles

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
foreach ($protoFile in $dartProtoFiles) {
    # Calculate relative path from ProtoRoot
    $relPath = $protoFile.Substring($ProtoRoot.Length + 1)
    # Dart protoc usually mirrors the directory structure, replacing .proto with .pb.dart
    $dartRelPath = $relPath -replace "\.proto$", ".pb.dart"
    $fullDartPath = Join-Path $DartOut $dartRelPath
    
    Write-Output "Generating $protoFile to $fullDartPath"
    protoc --plugin=protoc-gen-dart="$dartPluginPath" --dart_out="$DartOut" -I"$ProtoRoot" $protoFile
}

# Run protoc for Go
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
    
    $modulePrefix = "github.com/peers-labs/peers-touch/station/"
    foreach ($protoFile in $goProtoFiles) {
        # Read file to find go_package
        $content = Get-Content -Path $protoFile -Raw
        if ($content -match 'option\s+go_package\s*=\s*"([^"]+)"') {
            $goPackage = $matches[1]
            # Handle potential semicolon in go_package (e.g. "path/to/pkg;pkg_name")
            if ($goPackage -match ";") {
                $goPackage = $goPackage.Split(";")[0]
            }
            
            # Remove module prefix to get relative path
            if ($goPackage.StartsWith($modulePrefix)) {
                $relGoDir = $goPackage.Substring($modulePrefix.Length)
                # Replace / with \ for Windows path if needed, but Join-Path handles it
                $relGoDir = $relGoDir -replace "/", "\"
                
                $fileName = Split-Path $protoFile -Leaf
                $goFileName = $fileName -replace "\.proto$", ".pb.go"
                $fullGoPath = Join-Path $GoOut $relGoDir
                $fullGoPath = Join-Path $fullGoPath $goFileName
                
                Write-Output "Generating $protoFile to $fullGoPath"
            } else {
                Write-Output "Generating $protoFile (Could not determine exact output path from go_package: $goPackage)"
            }
        } else {
             Write-Output "Generating $protoFile (No go_package option found)"
        }
        
        protoc --go_out="$GoOut" --go_opt=module=github.com/peers-labs/peers-touch/station -I"$ProtoRoot" $protoFile
    }

} else {
    Write-Output "Go not found. Skipping Go code generation."
}

Write-Output "Protobuf code generation complete."
