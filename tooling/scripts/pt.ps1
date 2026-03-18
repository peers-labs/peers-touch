param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Task,
    [Parameter(Mandatory = $false, Position = 1)]
    [string]$Domain = ''
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')

function Invoke-InDir {
    param([string]$Path, [string]$Command)
    Push-Location $Path
    try {
        Invoke-Expression $Command
    } finally {
        Pop-Location
    }
}

function Assert-Tool {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is not installed or not available in PATH"
    }
}

function Run-StationTask {
    param([string]$TaskName)
    $path = Join-Path $root 'station\app'
    switch ($TaskName) {
        'lint' { Invoke-InDir $path 'go vet ./...' }
        'test' { Invoke-InDir $path 'go test ./...' }
        'build' { Invoke-InDir $path 'go build ./...' }
        'gen' { Write-Host 'station has no standalone code generation task'; break }
        default { throw "station does not support task: $TaskName" }
    }
}

function Run-DesktopTask {
    param([string]$TaskName)
    $path = Join-Path $root 'desktop'
    switch ($TaskName) {
        'lint' { Invoke-InDir $path 'npm run typecheck' }
        'test' { Invoke-InDir $path 'npm run test' }
        'build' { Invoke-InDir $path 'npm run build' }
        'gen' { Write-Host 'desktop has no standalone code generation task'; break }
        default { throw "desktop does not support task: $TaskName" }
    }
}

function Run-MobileTask {
    param([string]$TaskName)
    $path = Join-Path $root 'client\mobile'
    switch ($TaskName) {
        'lint' { Invoke-InDir $path 'flutter analyze' }
        'test' { Invoke-InDir $path 'flutter test' }
        'build' { Invoke-InDir $path 'flutter build apk --debug' }
        'gen' { Write-Host 'mobile has no standalone code generation task'; break }
        default { throw "mobile does not support task: $TaskName" }
    }
}

switch ($Task) {
    'list' {
        Write-Host 'available tasks: list, doctor, lint, test, build, gen'
        Write-Host 'available domains: station, desktop, mobile'
        exit 0
    }
    'doctor' {
        Assert-Tool 'go'
        Assert-Tool 'npm'
        Assert-Tool 'cargo'
        Assert-Tool 'flutter'
        Write-Host 'toolchain check passed'
        exit 0
    }
}

if ([string]::IsNullOrWhiteSpace($Domain)) {
    throw 'missing domain: station | desktop | mobile'
}

switch ($Domain) {
    'station' { Run-StationTask $Task }
    'desktop' { Run-DesktopTask $Task }
    'mobile' { Run-MobileTask $Task }
    default { throw "unknown domain: $Domain" }
}
