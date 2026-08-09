[CmdletBinding()]
param(
    [string]$CommitMessage = "Deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    [string]$Branch = 'main',
    [string]$RemoteHost = 'ec2-54-76-118-84.eu-west-1.compute.amazonaws.com',
    [string]$RemoteUser = 'ubuntu',
    [string]$RemoteDirectory = '/home/ubuntu/adimari-project',
    [string]$KeyPath = 'D:\Libraries\Work\Dev\Web Development\adimari-key-pair.pem'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory)]
        [string]$Command,

        [Parameter(ValueFromRemainingArguments)]
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
    }
}

function ConvertTo-BashSingleQuoted {
    param([Parameter(Mandatory)][string]$Value)

    if ($Value.Contains("'")) {
        throw 'Single quotes are not supported in remote deployment parameter values.'
    }

    return "'$Value'"
}

if ($Branch -notmatch '^[A-Za-z0-9._/-]+$') {
    throw 'Branch may contain only letters, numbers, periods, underscores, slashes, and hyphens.'
}

if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) {
    throw "SSH key not found: $KeyPath"
}

$sshCommand = Get-Command ssh.exe -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1

$sshCandidates = @(
    @(
        if ($sshCommand) { $sshCommand.Path }
        (Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'),
        (Join-Path $env:ProgramFiles 'Git\usr\bin\ssh.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
)

if ($sshCandidates.Count -eq 0) {
    throw 'OpenSSH client was not found. Install the Windows OpenSSH Client optional feature, then rerun this script.'
}

$sshExecutable = $sshCandidates[0]

Write-Host "Committing local changes on '$Branch'..."
Invoke-NativeCommand git add --all

& git diff --cached --quiet
if ($LASTEXITCODE -eq 1) {
    Invoke-NativeCommand git commit -m $CommitMessage
}
elseif ($LASTEXITCODE -ne 0) {
    throw 'Unable to determine whether there are staged changes.'
}
else {
    Write-Host 'No local changes to commit.'
}

Write-Host "Pushing '$Branch' to origin..."
Invoke-NativeCommand git push origin $Branch

$quotedRemoteDirectory = ConvertTo-BashSingleQuoted $RemoteDirectory
$quotedBranch = ConvertTo-BashSingleQuoted $Branch

$remoteScript = @'
set -euo pipefail

DEPLOY_DIR={0}
BRANCH={1}

cd "$DEPLOY_DIR"
git fetch --prune origin
git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -fd

npm ci --omit=dev --prefix Backend
npm ci --prefix front-end
npm run build --prefix front-end

# Remove an existing PM2-managed copy first, then only the legacy manual
# processes launched from this app's Backend directory. Other Node apps stay up.
if pm2 describe adimari-backend >/dev/null 2>&1; then
    pm2 delete adimari-backend
fi

while IFS= read -r pid; do
    process_directory="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    if [ "$process_directory" = "$DEPLOY_DIR/Backend" ]; then
        kill "$pid"
    fi
done < <(pgrep -f '^node server\.js$' || true)

pm2 start server.js --name adimari-backend --cwd "$DEPLOY_DIR/Backend" --time
pm2 save

port="$(sed -n 's/^PORT=//p' Backend/.env | tail -n 1)"
port="${{port:-5001}}"

for attempt in {{1..15}}; do
    if curl --fail --silent --show-error "http://127.0.0.1:$port/api/test" >/dev/null; then
        echo "Deployment complete: adimari-backend is responding on port $port."
        exit 0
    fi
    sleep 1
done

echo 'The backend did not become healthy. Recent PM2 logs:' >&2
pm2 logs adimari-backend --lines 50 --nostream >&2 || true
exit 1
'@ -f $quotedRemoteDirectory, $quotedBranch

Write-Host "Deploying to $RemoteUser@$RemoteHost..."
$remoteScript | & $sshExecutable -i $KeyPath -o BatchMode=yes "$RemoteUser@$RemoteHost" 'bash -s'
if ($LASTEXITCODE -ne 0) {
    throw "Remote deployment failed with exit code $LASTEXITCODE."
}

Write-Host 'Deployment finished successfully.'
