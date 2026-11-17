param(
    [ValidateRange(1, 65535)][int]$FrontendPort = 3000,
    [ValidateRange(1, 65535)][int]$BackendPort = 8000,
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $repoPath 'backend'
$frontendPath = Join-Path $repoPath 'frontend'
$pythonPath = Join-Path $backendPath '.venv\Scripts\python.exe'
$nextPath = Join-Path $frontendPath 'node_modules\next\dist\bin\next'
$logPath = Join-Path $repoPath '.local-checks'
$startedProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$previousEnvironment = @{}
$launchRecord = $null
$recordPath = $null

function Assert-PortAvailable([int]$Port) {
    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    if ($listeners | Where-Object { $_.Port -eq $Port }) {
        throw "Port $Port is already occupied. Choose another port; existing applications will not be stopped."
    }
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try { $probe.Start() }
    catch { throw "Port $Port cannot be bound on localhost. Choose another port. $($_.Exception.Message)" }
    finally { $probe.Stop() }
}

function Set-ChildEnvironment([string]$Name, [AllowNull()][object]$Value) {
    if (-not $previousEnvironment.ContainsKey($Name)) {
        $previousEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
    }
    # PowerShell's string/method binding can coerce $null to an empty string.
    # NullString removes the key instead of leaving a defined empty credential.
    if ($null -eq $Value) {
        [Environment]::SetEnvironmentVariable($Name, [NullString]::Value, 'Process')
    } else {
        [Environment]::SetEnvironmentVariable($Name, [string]$Value, 'Process')
    }
}

function Wait-Healthy([System.Diagnostics.Process]$Child, [string]$Url, [int]$TimeoutSeconds = 180) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $Child.Refresh()
        if ($Child.HasExited) {
            throw "Process $($Child.Id) exited with code $($Child.ExitCode) before $Url became healthy."
        }
        try {
            $response = Invoke-RestMethod -Uri $Url -TimeoutSec 3
            if ($response.status -eq 'ok') { return }
        } catch {
            # The process can take time to migrate, seed and load its model.
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Startup timed out waiting for $Url after $TimeoutSeconds seconds."
}

try {
    if ($FrontendPort -eq $BackendPort) { throw 'FrontendPort and BackendPort must be different.' }
    Assert-PortAvailable $FrontendPort
    Assert-PortAvailable $BackendPort
    $nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1

    $demoEnvironment = @{
        'BCC_ENVIRONMENT' = 'demo'
        'BCC_API_MODE' = 'live'
        'BCC_API_URL' = "http://127.0.0.1:$BackendPort"
        'BCC_API_PREFIX' = '/api/v1'
        'BCC_ALLOW_DEMO_OVERRIDES' = 'true'
        'BCC_DEMO_ACTIONS_ENABLED' = 'true'
        'BCC_COOLING_OFF_MINUTES' = '15'
        'BCC_TIMEZONE' = 'Asia/Almaty'
        'BCC_CORS_ORIGINS' = "[`"http://127.0.0.1:$FrontendPort`",`"http://localhost:$FrontendPort`"]"
        'BCC_NORMAL_SENDER_ID' = '00000000-0000-4000-8000-000000000001'
        'BCC_NORMAL_RECIPIENT_PHONE' = '+77010000002'
        'BCC_SCAM_SENDER_ID' = '00000000-0000-4000-8000-000000000001'
        'BCC_SCAM_RECIPIENT_PHONE' = '+77010000003'
        'BCC_HUB_SENDER_ID' = '00000000-0000-4000-8000-000000000001'
        'BCC_HUB_RECIPIENT_PHONE' = '+77010000004'
        'BCC_CARD_ACCOUNT_MAP' = '{"4400000000000002":"00000000-0000-4000-8000-000000000002","4400000000000003":"00000000-0000-4000-8000-000000000003","4400000000000004":"00000000-0000-4000-8000-000000000004"}'
        'BCC_TRAFFIC_ACCOUNTS' = ''
        'OPENBLAS_NUM_THREADS' = '1'
        'OMP_NUM_THREADS' = '1'
        'MKL_NUM_THREADS' = '1'
        'PYTHONUNBUFFERED' = '1'
    }
    foreach ($entry in $demoEnvironment.GetEnumerator()) {
        Set-ChildEnvironment $entry.Key $entry.Value
    }
    foreach ($name in @('BCC_API_KEY', 'BCC_SOC_API_KEY', 'BCC_PILOT_USER', 'BCC_PILOT_PASSWORD', 'BCC_DB_PASSWORD', 'BCC_PUBLIC_ORIGIN')) {
        Set-ChildEnvironment $name $null
    }

    if (-not $NoBuild) {
        $uvCommand = Get-Command uv -CommandType Application -ErrorAction Stop | Select-Object -First 1
        $npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1
        Push-Location $backendPath
        try {
            & $uvCommand.Source sync --frozen --python 3.12
            if ($LASTEXITCODE -ne 0) { throw "Backend dependency installation failed (exit $LASTEXITCODE)." }
        } finally { Pop-Location }
        Push-Location $frontendPath
        try {
            & $npmCommand.Source ci --prefer-offline --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw "Frontend dependency installation failed (exit $LASTEXITCODE)." }
            & $npmCommand.Source run build
            if ($LASTEXITCODE -ne 0) { throw "Frontend build failed (exit $LASTEXITCODE)." }
        } finally { Pop-Location }
    }

    foreach ($requiredPath in @($pythonPath, $nextPath, (Join-Path $frontendPath '.next\BUILD_ID'), (Join-Path $backendPath 'scripts\run_local_demo.py'))) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "Required local dependency/build is missing: $requiredPath. Run this script without -NoBuild."
        }
    }
    # Verify the backend's development dependencies as well as the interpreter itself.
    & $pythonPath -c 'import fastapi, sqlalchemy, aiosqlite, fakeredis, sklearn, uvicorn'
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependencies are incomplete. Run this script without -NoBuild.' }
    Assert-PortAvailable $FrontendPort
    Assert-PortAvailable $BackendPort

    New-Item -ItemType Directory -Path $logPath -Force | Out-Null
    $runId = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $backendOut = Join-Path $logPath "local-demo-$runId-backend.out.log"
    $backendErr = Join-Path $logPath "local-demo-$runId-backend.err.log"
    $frontendOut = Join-Path $logPath "local-demo-$runId-frontend.out.log"
    $frontendErr = Join-Path $logPath "local-demo-$runId-frontend.err.log"
    $recordPath = Join-Path $logPath "local-demo-$runId.json"
    $launchRecord = [ordered]@{ started_at = [DateTime]::UtcNow.ToString('o'); state = 'starting'; repository = $repoPath; backend = $null; frontend = $null }

    Write-Host 'Starting local demo backend (SQLite, in-process Redis, real rules/graph/ML)...'
    $backendProcess = Start-Process -FilePath $pythonPath -ArgumentList @('-m', 'scripts.run_local_demo', '--port', "$BackendPort") -WorkingDirectory $backendPath -WindowStyle Hidden -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr -PassThru
    $startedProcesses.Add($backendProcess)
    $launchRecord.backend = @{ pid = $backendProcess.Id; url = "http://127.0.0.1:$BackendPort"; stdout = $backendOut; stderr = $backendErr }
    $launchRecord | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $recordPath -Encoding UTF8
    Wait-Healthy $backendProcess "http://127.0.0.1:$BackendPort/health"

    Write-Host 'Starting the bilingual frontend...'
    $frontendProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList @(('"' + $nextPath + '"'), 'start', '--hostname', '127.0.0.1', '--port', "$FrontendPort") -WorkingDirectory $frontendPath -WindowStyle Hidden -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr -PassThru
    $startedProcesses.Add($frontendProcess)
    $launchRecord.frontend = @{ pid = $frontendProcess.Id; url = "http://127.0.0.1:$FrontendPort"; stdout = $frontendOut; stderr = $frontendErr }
    $launchRecord | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $recordPath -Encoding UTF8
    Wait-Healthy $frontendProcess "http://127.0.0.1:$FrontendPort/health"

    $launchRecord.state = 'ready'
    $launchRecord | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $recordPath -Encoding UTF8
    Write-Host "BCC Shield ready: http://127.0.0.1:$FrontendPort"
    Write-Host "Backend PID: $($backendProcess.Id); frontend PID: $($frontendProcess.Id)"
    Write-Host "Logs and process record: $recordPath"
    Write-Host 'Dedicated synthetic database: .local-checks/local-demo.db. Existing data are preserved.'
} catch {
    foreach ($child in $startedProcesses) {
        try {
            $child.Refresh()
            if (-not $child.HasExited) {
                $child.Kill()
                $child.WaitForExit(5000) | Out-Null
            }
        } catch { Write-Warning "Could not clean up the process started by this invocation: $($child.Id)." }
    }
    if ($null -ne $launchRecord -and $recordPath) {
        $launchRecord.state = 'failed'
        $launchRecord | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $recordPath -Encoding UTF8
        Write-Warning "Startup failed. Logs and process record: $recordPath"
    }
    throw
} finally {
    foreach ($name in $previousEnvironment.Keys) {
        if ($null -eq $previousEnvironment[$name]) {
            [Environment]::SetEnvironmentVariable($name, [NullString]::Value, 'Process')
        } else {
            [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
        }
    }
}
