# Proto code generation — Go only.
# Dart/Flutter generation has been removed (deprecated path).
# Mobile (Kotlin/Swift) generation: use tooling/scripts/proto-gen-mobile.sh

$ErrorActionPreference = "Stop"

$ScriptRoot = $PSScriptRoot
$ProjectRoot = (Get-Item -Path "$ScriptRoot\..").FullName
$ProtoRoot = "$ProjectRoot\model"
$GoOut = "$ProjectRoot\station"

Write-Output "=== Peers Touch Proto Generation (Go) ==="
Write-Output "Project Root: $ProjectRoot"
Write-Output "Proto Root:   $ProtoRoot"
Write-Output "Go Output:    $GoOut"
Write-Output ""

if (-not (Test-Path $GoOut)) {
    Write-Output "Creating Go output directory: $GoOut"
    New-Item -ItemType Directory -Force -Path $GoOut | Out-Null
}

$goProtoFiles = @(Get-ChildItem -Path "$ProtoRoot\domain" -Filter *.proto -Recurse | Where-Object { $_.FullName -notlike '*\ai_box\ai_box_message.proto' } | ForEach-Object { $_.FullName })

if ($goProtoFiles.Count -eq 0) {
    Write-Output "No .proto files found. Exiting."
    exit
}

Write-Output "Found $($goProtoFiles.Count) proto files"
Write-Output ""

$goCmd = Get-Command go -ErrorAction SilentlyContinue
if (-not $goCmd) {
    Write-Output "Go not found. Cannot generate Go code."
    exit 1
}

$goPlugin = Get-Command protoc-gen-go -ErrorAction SilentlyContinue
if (-not $goPlugin) {
    Write-Output "protoc-gen-go not found. Attempting to install..."
    go install google.golang.org/protobuf/cmd/protoc-gen-go@latest | Write-Output
}

Write-Output "Running protoc for Go..."
$modulePrefix = "github.com/peers-labs/peers-touch/station/"

foreach ($protoFile in $goProtoFiles) {
    $content = Get-Content -Path $protoFile -Raw
    if ($content -match 'option\s+go_package\s*=\s*"([^"]+)"') {
        $goPackage = $matches[1]
        if ($goPackage -match ";") {
            $goPackage = $goPackage.Split(";")[0]
        }

        if ($goPackage.StartsWith($modulePrefix)) {
            $relGoDir = $goPackage.Substring($modulePrefix.Length) -replace "/", "\"
            $fileName = Split-Path $protoFile -Leaf
            $goFileName = $fileName -replace "\.proto$", ".pb.go"
            $fullGoPath = Join-Path (Join-Path $GoOut $relGoDir) $goFileName
            Write-Output "  Generating $protoFile -> $fullGoPath"
        } else {
            Write-Output "  Generating $protoFile (go_package: $goPackage)"
        }
    } else {
        Write-Output "  Generating $protoFile (no go_package option)"
    }

    protoc --go_out="$GoOut" --go_opt=module=github.com/peers-labs/peers-touch/station -I"$ProtoRoot" $protoFile
}

Write-Output ""
Write-Output "=== Proto generation complete ==="
