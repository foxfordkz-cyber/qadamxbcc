# Native Windows equivalent of verify.sh. Every required check must exit zero.
$ErrorActionPreference = 'Stop'
$repoPath = $PSScriptRoot

function Invoke-Check {
    param([string]$Label, [string]$Executable, [string[]]$Arguments)
    Write-Host "`n==> $Label" -ForegroundColor Cyan
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE)." }
}

function Assert-PytestCompletion {
    param([string]$EvidencePath)
    if (-not (Test-Path -LiteralPath $EvidencePath -PathType Leaf)) {
        throw 'pytest exited without its completion report; the backend suite is NOT verified.'
    }
    [xml]$evidence = Get-Content -LiteralPath $EvidencePath -Raw
    $suites = @($evidence.SelectNodes('/testsuites/testsuite'))
    $testCount = 0
    foreach ($suite in $suites) {
        $testCount += [int]$suite.tests
        if ([int]$suite.errors -ne 0 -or [int]$suite.failures -ne 0) {
            throw 'pytest completion report contains errors or failures.'
        }
    }
    if ($testCount -lt 1) { throw 'pytest completion report contains no test cases.' }
    Write-Host "Verified pytest completion: $testCount collected cases."
}

try {
    $uvPath = (Get-Command uv -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    Push-Location (Join-Path $repoPath 'backend')
    try {
        Invoke-Check 'backend: sync dependencies' $uvPath @('sync', '--quiet', '--python', '3.12')
        Invoke-Check 'backend: ruff check' $uvPath @('run', '--no-sync', 'ruff', 'check', '.')
        Invoke-Check 'backend: ruff format --check' $uvPath @('run', '--no-sync', 'ruff', 'format', '--check', '.')
        Invoke-Check 'backend: mypy --strict' $uvPath @('run', '--no-sync', 'mypy', '--strict')
        $evidenceDirectory = Join-Path $repoPath '.local-checks/verify'
        [void][System.IO.Directory]::CreateDirectory($evidenceDirectory)
        # A unique path cannot accidentally validate a report left by an earlier successful run.
        # On Windows the migration/demo rehearsal can terminate a warmed pytest interpreter
        # without a report. Run its three cases in a fresh interpreter, not skip them.
        # Linux verify.sh continues to exercise the combined suite in one interpreter.
        $runId = [guid]::NewGuid().ToString('N')
        $pytestEvidence = Join-Path $evidenceDirectory ("pytest-" + $runId + '-main.xml')
        Invoke-Check 'backend: pytest (main suite)' $uvPath @('run', '--no-sync', 'pytest', '--ignore=tests/test_rehearsal.py', '--junitxml', $pytestEvidence)
        Assert-PytestCompletion $pytestEvidence
        $rehearsalEvidence = Join-Path $evidenceDirectory ("pytest-" + $runId + '-rehearsal.xml')
        Invoke-Check 'backend: pytest (isolated rehearsal)' $uvPath @('run', '--no-sync', 'pytest', 'tests/test_rehearsal.py', '--junitxml', $rehearsalEvidence)
        Assert-PytestCompletion $rehearsalEvidence
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
