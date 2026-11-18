# Native Windows equivalent of verify.sh. Every required check must exit zero.
$ErrorActionPreference = 'Stop'
$repoPath = $PSScriptRoot

function Invoke-Check {
    param([string]$Label, [string]$Executable, [string[]]$Arguments)
    Write-Host "`n==> $Label" -ForegroundColor Cyan
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE)." }
}

try {
    $uvPath = (Get-Command uv -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    Push-Location (Join-Path $repoPath 'backend')
    try {
        Invoke-Check 'backend: sync dependencies' $uvPath @('sync', '--quiet', '--python', '3.12')
        Invoke-Check 'backend: ruff check' $uvPath @('run', '--no-sync', 'ruff', 'check', '.')
        Invoke-Check 'backend: ruff format --check' $uvPath @('run', '--no-sync', 'ruff', 'format', '--check', '.')
        Invoke-Check 'backend: mypy --strict' $uvPath @('run', '--no-sync', 'mypy', '--strict')
        Invoke-Check 'backend: pytest' $uvPath @('run', '--no-sync', 'pytest')
    } finally { Pop-Location }

    $frontendPath = Join-Path $repoPath 'frontend'
    $packagePath = Join-Path $frontendPath 'package.json'
    if (Test-Path -LiteralPath $packagePath) {
        $npmPath = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
        Push-Location $frontendPath
        try {
            $installCommand = if (Test-Path -LiteralPath 'package-lock.json') { 'ci' } else { 'install' }
            Invoke-Check 'frontend: install' $npmPath @($installCommand, '--prefer-offline', '--no-audit', '--no-fund')
            Invoke-Check 'frontend: type generation + tsc --noEmit' $npmPath @('run', 'typecheck')
            $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
            if ($package.scripts.test -match 'tsx') {
                Invoke-Check 'frontend: tests' $npmPath @('test')
            }
            Invoke-Check 'frontend: build' $npmPath @('run', 'build')
        } finally { Pop-Location }
    }

    $dockerCommand = Get-Command docker -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($dockerCommand) {
        Invoke-Check 'docker compose config' $dockerCommand.Source @('compose', '-f', (Join-Path $repoPath 'docker-compose.yml'), 'config', '--quiet')
        Invoke-Check 'docker compose integrations config' $dockerCommand.Source @('compose', '-f', (Join-Path $repoPath 'docker-compose.yml'), '-f', (Join-Path $repoPath 'docker-compose.integrations.yml'), 'config', '--quiet')
    }
    Write-Host "`n==> verify: ALL GREEN" -ForegroundColor Green
    exit 0
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
