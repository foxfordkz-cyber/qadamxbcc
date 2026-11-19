param([switch]$NoBuild)
$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
Push-Location $repoPath
try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Install Docker Desktop, start it, then run this script again.'
    }
    docker info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -ne 0) {
        $dockerDesktopPath = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
        if (-not (Test-Path -LiteralPath $dockerDesktopPath)) { throw 'Start the Docker daemon first.' }
        Start-Process -FilePath $dockerDesktopPath -WindowStyle Hidden
        $deadline = (Get-Date).AddSeconds(90)
        do {
            Start-Sleep -Seconds 3
            docker info --format '{{.ServerVersion}}' *> $null
            if ($LASTEXITCODE -eq 0) { break }
        } while ((Get-Date) -lt $deadline)
        if ($LASTEXITCODE -ne 0) { throw 'Docker did not become ready. Open Docker Desktop and retry.' }
    }
    $composeArgs = @('compose', 'up', '-d', '--wait', '--wait-timeout', '240')
    if (-not $NoBuild) { $composeArgs += '--build' }
    & docker @composeArgs
    if ($LASTEXITCODE -ne 0) { throw 'Startup failed. Inspect: docker compose logs --tail 100' }
    $webPort = if ($env:BCC_WEB_PORT) { $env:BCC_WEB_PORT } else { '3000' }
    Write-Host "Saq Bol ready: http://localhost:$webPort"
    Write-Host 'Synthetic data are created only if the database is empty. Existing data are preserved.'
} finally { Pop-Location }
