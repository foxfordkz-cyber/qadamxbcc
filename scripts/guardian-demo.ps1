# Fake-only local rehearsal. Does not load a PowerShell profile or request secrets.
$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $repoPath 'backend/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'Prepare dependencies first: cd backend; uv sync --python 3.12'
}
& $pythonPath (Join-Path $repoPath 'backend/scripts/guardian_demo.py') @args
exit $LASTEXITCODE
