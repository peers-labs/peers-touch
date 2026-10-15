param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot,

    [Parameter(Mandatory = $true)]
    [string]$CargoTargetRoot,

    [Parameter(Mandatory = $true)]
    [string]$VsDevCmd,

    [Parameter(Mandatory = $true)]
    [string]$WindowsSdkRoot,

    [Parameter(Mandatory = $true)]
    [string]$WindowsSdkVersion,

    [Parameter(Mandatory = $true)]
    [string]$PerlPath,

    [Parameter(Mandatory = $true)]
    [string]$ProtocPath
)

$ErrorActionPreference = "Stop"

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

foreach ($path in @($SourceRoot, $VsDevCmd, $WindowsSdkRoot, $PerlPath, $ProtocPath)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required Windows build path does not exist: $path"
    }
}

$developerEnvironment = & "$env:SystemRoot\System32\cmd.exe" /d /s /c (
    "call `"$VsDevCmd`" -arch=x64 >nul && set"
)
if ($LASTEXITCODE -ne 0) {
    throw "VsDevCmd failed with exit code $LASTEXITCODE"
}

foreach ($entry in $developerEnvironment) {
    $separator = $entry.IndexOf("=")
    if ($separator -le 0) {
        continue
    }
    $name = $entry.Substring(0, $separator)
    $value = $entry.Substring($separator + 1)
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
}

$sdkInclude = @(
    "$WindowsSdkRoot/Include/$WindowsSdkVersion/ucrt"
    "$WindowsSdkRoot/Include/$WindowsSdkVersion/shared"
    "$WindowsSdkRoot/Include/$WindowsSdkVersion/um"
    "$WindowsSdkRoot/Include/$WindowsSdkVersion/winrt"
    "$WindowsSdkRoot/Include/$WindowsSdkVersion/cppwinrt"
)
$sdkLib = @(
    "$WindowsSdkRoot/Lib/$WindowsSdkVersion/ucrt/x64"
    "$WindowsSdkRoot/Lib/$WindowsSdkVersion/um/x64"
)

New-Item -ItemType Directory -Force -Path $CargoTargetRoot | Out-Null

$env:VSLANG = "1033"
$env:WindowsSdkDir = "$WindowsSdkRoot/"
$env:WindowsSDKVersion = "$WindowsSdkVersion/"
$env:INCLUDE = ($sdkInclude + $env:INCLUDE) -join ";"
$env:LIB = ($sdkLib + $env:LIB) -join ";"
$protocDirectory = Split-Path -Parent $ProtocPath
$env:PATH = (
    "$protocDirectory;$WindowsSdkRoot/bin/$WindowsSdkVersion/x64;$env:PATH"
)
$env:CARGO_TARGET_DIR = $CargoTargetRoot
$env:CARGO_HOME = Join-Path $CargoTargetRoot "cargo-home"
$env:OPENSSL_SRC_PERL = $PerlPath
$env:PROTOC = $ProtocPath

Push-Location -LiteralPath $SourceRoot
try {
    Invoke-NativeCommand "pnpm.cmd" @("install", "--frozen-lockfile")
    $protoRoot = Join-Path $SourceRoot "model"
    $desktopProtoOutput = Join-Path $SourceRoot "apps/desktop/src/gen/proto"
    $protocGenEs = Join-Path (
        $SourceRoot
    ) "apps/desktop/node_modules/.bin/protoc-gen-es.CMD"
    if (-not (Test-Path -LiteralPath $protocGenEs)) {
        throw "Desktop protoc-gen-es does not exist: $protocGenEs"
    }
    Remove-Item -Recurse -Force $desktopProtoOutput -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $desktopProtoOutput | Out-Null
    $protoFiles = Get-ChildItem (
        Join-Path $protoRoot "domain"
    ) -Recurse -Filter "*.proto" | Where-Object {
        $_.FullName -notlike "*\ai_box\ai_box_message.proto"
    }
    foreach ($protoFile in $protoFiles) {
        Invoke-NativeCommand $ProtocPath @(
            "--plugin=protoc-gen-es=$protocGenEs",
            "--es_out=$desktopProtoOutput",
            "--es_opt=target=ts",
            "-I$protoRoot",
            $protoFile.FullName
        )
    }
    $env:VITE_ACCEPTANCE_HARNESS = "1"
    Invoke-NativeCommand "pnpm.cmd" @("--dir", "apps/desktop", "run", "build")

    Set-Location -LiteralPath "apps/desktop/src-tauri"
    $env:TAURI_CONFIG = '{"app":{"withGlobalTauri":true}}'
    Invoke-NativeCommand "cargo.exe" @(
        "build",
        "--locked",
        "--features",
        "acceptance-webdriver"
    )
} finally {
    Pop-Location
}
