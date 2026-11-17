param([Parameter(Mandatory = $true)][uri]$PublicOrigin, [string]$UserName = 'pilot-officer')
$ErrorActionPreference = 'Stop'
if ($PublicOrigin.Scheme -ne 'https' -or $PublicOrigin.AbsolutePath -ne '/' -or $PublicOrigin.UserInfo -or $PublicOrigin.Query -or $PublicOrigin.Fragment) {
    throw 'PublicOrigin must be an HTTPS origin, for example https://shield.bank.example'
}
if ($UserName -notmatch '^[A-Za-z0-9_-]{3,64}$') { throw 'Use a 3-64 character ASCII user name.' }
$envPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.env.pilot'
if (Test-Path -LiteralPath $envPath) { throw '.env.pilot exists; refusing to overwrite credentials.' }
function New-PilotSecret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}
$values = @(
    "BCC_PUBLIC_ORIGIN=$($PublicOrigin.GetLeftPart([UriPartial]::Authority))",
    "BCC_PILOT_USER=$UserName",
    "BCC_PILOT_PASSWORD=$(New-PilotSecret)",
    "BCC_DB_PASSWORD=$(New-PilotSecret)",
    "BCC_API_KEY=$(New-PilotSecret)",
    "BCC_SOC_API_KEY=$(New-PilotSecret)",
    'BCC_PILOT_PORT=3100'
)
[IO.File]::WriteAllLines($envPath, $values, [Text.UTF8Encoding]::new($false))
Write-Host 'Created ignored .env.pilot. Store the credentials securely; do not commit or share the file.'
Write-Host 'Start: docker compose --env-file .env.pilot -f docker-compose.pilot.yml up -d --build --wait'
