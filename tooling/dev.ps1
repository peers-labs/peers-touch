[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $DevctlArguments
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$entrypoint = Join-Path $PSScriptRoot 'devctl\index.mjs'

& node $entrypoint --root $repoRoot @DevctlArguments
exit $LASTEXITCODE
