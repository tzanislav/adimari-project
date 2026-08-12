# NAS Connector deployment runbook

This is an operator runbook for deploying the Phase 2 control plane. It does
not deploy anything by itself. Phase 2A consists of administrator enrollment,
the Windows service's outbound HTTPS heartbeats, and the management UI. Phase
2B adds a persistent, outbound WSS **presence** channel. Phase 2C adds a
single durable `index_root` delivery request, and Phase 3A executes it as a
metadata-only NAS scan. The initial Phase 4 slice adds `cache_for_download`:
the connector copies one indexed file directly to the private `nas-cache/`
prefix using a short-lived backend-issued PUT URL. Current releases also
generate persistent thumbnails, show image lightboxes, track NAS changes, and
support a browser-to-NAS upload path through the isolated staging prefix. The
browser uploads multipart parts directly to temporary storage; the connector
then makes the final atomic write into the configured NAS folder.

Use this runbook only after reviewing the implementation and taking an
application/database backup appropriate to the production environment.

## Required topology and trust boundary

```text
Windows connector service
  | outbound TCP 443, TLS certificate validation
  v
https://files.example.com (public DNS and trusted certificate)
  | Nginx: overwrite X-Forwarded-* headers
  v
127.0.0.1:5001 Node/PM2 process (Backend/server.js)
  |
  +-- MongoDB and private File Server S3 bucket
```

The public URL entered in the Control Center must be an HTTPS origin only, for
example `https://files.example.com`. It cannot include a path, query, fragment,
username, or password.

For local/private testing only, `NAS_CONNECTOR_ALLOW_HTTP=true` permits an
`http://` Control Center origin and `ws://` control channel without a reverse
proxy. Do not use this setting for an internet-facing deployment.

The Node port must not be reachable from the internet. `Backend/server.js`
binds only to loopback by default (`127.0.0.1`) and refuses a LAN or wildcard
`BACKEND_BIND_HOST` value at startup. It sets `trust proxy` when
`NODE_ENV=production`, so it trusts the nearest proxy hop for
`X-Forwarded-Proto`. Use one local Nginx hop immediately in front of Node and
expose only TCP 443 (and TCP 80 only for redirect/certificate renewal) through
the EC2 security group. Do not expose 5001, SMB, MongoDB, or the S3 bucket
directly to users.

Do not add an extra unreviewed CDN/load balancer hop between Nginx and Node. If
one is required later, review the `trust proxy` setting and ensure each proxy
overwrites forwarding headers rather than passing client values through.

## 1. Public DNS, certificate, and reverse proxy

There is no Nginx configuration in the current repository deployment. The
existing app is a PM2-managed Node process, so adding the reverse proxy is an
explicit operator task.

1. Point the public DNS name at the EC2 endpoint.
2. Obtain a certificate from a CA trusted by the connector Windows machine.
   Production self-signed certificates are not supported: the Control Center
   and service intentionally use normal .NET certificate validation.
3. Review and copy these templates rather than overwriting an existing site:

   - [upgrade map and limits](Backend/deployment/nginx/adimari-connection-upgrade.map.conf.template)
     belongs in Nginx's `http {}` context.
   - [server template](Backend/deployment/nginx/adimari-backend.conf.template)
     belongs in a site/server configuration.

4. Replace every `__...__` placeholder in the server template. For the current
   deployment, `__ADIMARI_BACKEND_PORT__` is normally the `PORT` value in
   `Backend/.env` (default `5001`). Keep `BACKEND_BIND_HOST=127.0.0.1` and
   `proxy_pass` on `127.0.0.1`, not a public IP.
5. Validate and reload the Nginx configuration using the host's normal change
   process, for example `nginx -t` followed by a reload. Do not overwrite a
   live configuration before its backup and review are complete.
6. Restrict inbound security-group/firewall rules to 443 and, if needed for
   HTTP-01 certificate issuance, 80. Do not expose 5001.

The template always overwrites `X-Forwarded-Proto` with Nginx's `$scheme`. On
the HTTPS virtual host this makes `req.secure` true in Express; without it,
every NAS connector route returns `400 NAS_CONNECTOR_HTTPS_REQUIRED`.

It includes an exact, rate- and connection-limited WSS location for
`/api/nas-connectors/control/socket`, plus the required `Upgrade`,
`Connection`, HTTP/1.1, and long proxy-timeout headers. Phase 2C uses that
endpoint for authenticated presence and durable receipt of the one harmless
`index_root` request; it still does not execute NAS work.

The templates deliberately overwrite `X-Forwarded-For` with Nginx's own
`$remote_addr`; do not change this to `$proxy_add_x_forwarded_for`. The backend
uses the value only after recognizing the local Nginx hop, so appending a
client-supplied value would let a caller evade the defense-in-depth upgrade
limit. The current in-process session registry requires exactly one Node/PM2
instance: do not use PM2 cluster mode or multiple backend hosts until session
revocation is distributed.

After the proxy is active, verify both layers:

```powershell
# From a network that reaches the public hostname. The response must be HTTPS
# and JSON from Backend/server.js.
curl.exe --fail --proto "=https" https://files.example.com/api/test

# From the EC2 host, Node remains reachable only through loopback for PM2's
# existing health check.
curl --fail http://127.0.0.1:5001/api/test
```

Do not use `-k`/`--insecure` for the public test. Fix the certificate chain,
DNS name, or server clock instead.

## 2. Backend environment and feature flag

The current production deployment is `scripts/deploy.ps1`. It commits all
non-ignored local changes, pushes `main`, SSHes to the EC2 host, resets the
remote checkout to `origin/main`, runs `git clean -fd`, installs dependencies,
builds the frontend, and restarts the PM2 process named `adimari-backend`. It
preserves ignored files such as `Backend/.env`.

Do not run that script from an unreviewed or dirty checkout. It is intentionally
not modified by this Phase 2A work. Before a planned release:

1. Review `git status` and the staged diff. The script uses `git add --all`, so
   unrelated non-ignored changes would be committed too.
2. Back up the EC2 `Backend/.env` using the host's approved secret-management
   process. Edit the remote secret environment before enabling the feature;
   pulling code alone does not create those values.
3. Keep `NAS_CONNECTOR_ENABLED=false` until DNS/TLS, S3, database checks, and
   the variables below are all complete. When this flag is `true`, startup
   validates every NAS setting and intentionally fails closed on a missing or
   malformed value.
4. Set `NODE_ENV=production`. Do not set `DEV_MODE=development` in production.
   Set `CORS_ALLOWED_ORIGINS` to the actual HTTPS frontend origin(s), and set
   `FILE_SERVER_PUBLIC_BASE_URL` to the public HTTPS origin used by existing
   File Server shares.

Use the following as a checklist, not as a file containing real secrets:

```ini
NODE_ENV=production
DEV_MODE=production
PORT=5001
# Backend/server.js rejects anything except 127.0.0.1, ::1, or localhost.
BACKEND_BIND_HOST=127.0.0.1
CORS_ALLOWED_ORIGINS=https://files.example.com

# Existing File Server values must already be real production values.
FILE_SERVER_AWS_REGION=eu-west-1
FILE_SERVER_BUCKET_NAME=your-private-file-server-bucket
FILE_SERVER_S3_PREFIX=files/
FILE_SERVER_PUBLIC_BASE_URL=https://files.example.com

# Enable only after all values and infrastructure below have been verified.
NAS_CONNECTOR_ENABLED=true
NAS_CONNECTOR_AWS_REGION=eu-west-1
NAS_CONNECTOR_BUCKET_NAME=your-private-file-server-bucket
NAS_CONNECTOR_CACHE_S3_PREFIX=nas-cache/
NAS_CONNECTOR_UPLOAD_STAGING_S3_PREFIX=nas-upload-staging/
NAS_CONNECTOR_THUMBNAIL_S3_PREFIX=nas-thumbnails/
NAS_CONNECTOR_CACHE_RETENTION_DAYS=10
NAS_CONNECTOR_THUMBNAIL_MAX_DIMENSION=320
NAS_CONNECTOR_MAX_UPLOAD_BYTES=50000000000000
NAS_CONNECTOR_BROWSER_UPLOAD_URL_TTL_SECONDS=900
NAS_CONNECTOR_TRANSFER_URL_TTL_SECONDS=3600
NAS_CONNECTOR_AUTH_HMAC_SECRET=<backend-only random secret, at least 32 bytes>
NAS_CONNECTOR_ENROLLMENT_TOKEN_TTL_SECONDS=900
NAS_CONNECTOR_ENROLLMENT_RECOVERY_TTL_SECONDS=3600
NAS_CONNECTOR_HEARTBEAT_INTERVAL_SECONDS=30
NAS_CONNECTOR_HEARTBEAT_STALE_AFTER_SECONDS=90
NAS_CONNECTOR_CONTROL_PING_INTERVAL_SECONDS=30
NAS_CONNECTOR_CONTROL_UPGRADE_RATE_LIMIT_PER_MINUTE=30
NAS_CONNECTOR_JOB_LEASE_SECONDS=90
```

The NAS region and bucket must exactly equal `FILE_SERVER_AWS_REGION` and
`FILE_SERVER_BUCKET_NAME`; the four prefixes `files/`, `nas-cache/`,
`nas-upload-staging/`, and `nas-thumbnails/` must not overlap. The cache
retention setting is also intentionally fixed to the S3 lifecycle rule below.

Use a secret manager or a locally generated secret; do not put a generated
value in source control, the Vite frontend, a publish package, or an operator
ticket. Preserve `NAS_CONNECTOR_AUTH_HMAC_SECRET` across ordinary releases. A
rotation invalidates every enrollment token and connector device credential and
requires a coordinated re-enrollment plan.

The code accepts either a dedicated NAS backend IAM role or a pair of
`NAS_CONNECTOR_AWS_ACCESS_KEY_ID` and `NAS_CONNECTOR_AWS_SECRET_ACCESS_KEY`.
When using an IAM role, remove both credential variables from the real
environment; do not leave literal `<set>` placeholders from `.env.example`.
Use a dedicated identity/policy for NAS prefixes and do not give the Windows
connector static S3 credentials.

## 3. S3 bucket, lifecycle, and IAM checks

The existing private File Server bucket is reused, but NAS objects must be
isolated by prefix. No NAS object should be public. Keep S3 Block Public Access
enabled and use bucket-owner-enforced object ownership. Require TLS for S3 in
the bucket policy (`aws:SecureTransport=false` must be denied). If the bucket
uses SSE-KMS, grant the backend identity only the needed KMS key permissions in
addition to the S3 policy.

The file [lifecycle-rule additions](Backend/deployment/aws/nas-connector-lifecycle-rules-to-merge.json)
contains three rules to merge into the bucket's *existing* lifecycle
configuration:

| Prefix | Required behavior |
| --- | --- |
| `nas-cache/` | Expire full delivery/cache objects after 10 days and abort incomplete multipart uploads after 7 days. |
| `nas-upload-staging/` | Expire abandoned browser-upload staging objects after 1 day and abort incomplete multipart uploads after 1 day. |
| `nas-thumbnails/` | Keep thumbnails; only abort incomplete multipart uploads after 7 days. |

If bucket versioning is enabled, keep the `NoncurrentVersionExpiration` entries
for cache and staging. Otherwise the current object can expire while old object
versions continue to consume storage. S3 lifecycle processing is asynchronous,
so expiry is at or shortly after the configured age rather than an exact clock
instant.

`put-bucket-lifecycle-configuration` replaces the entire bucket lifecycle
document. First export and review the existing rules, then merge these three
unique IDs with the existing File Server rules. Do not upload the supplied JSON
as a blind replacement.

The [backend policy template](Backend/deployment/aws/nas-connector-backend-policy.template.json)
is a least-privilege starting point for the initial cache-transfer work. Replace
the bucket placeholder and review it with the existing File Server policy
before attachment. It deliberately grants no access to `files/` and no
`s3:PutObjectAcl` permission. The backend creates a scoped pre-signed PUT URL
for each cache object; the Windows connector needs no AWS IAM user or key.

## 4. MongoDB rollout check

Fresh Phase 2A databases receive a TTL index on
`nas_enrollment_tokens.recoveryExpiresAt`. If any early connector deployment
created the older TTL index on `expiresAt`, inspect the production database
before relying on lost-response enrollment recovery:

```javascript
use your_database_name
db.nas_enrollment_tokens.getIndexes()
```

Only if inspection shows a TTL index exactly like
`{ name: "expiresAt_1", key: { expiresAt: 1 }, expireAfterSeconds: 0 }`, make a
planned migration:

```javascript
db.nas_enrollment_tokens.dropIndex("expiresAt_1")
db.nas_enrollment_tokens.createIndex(
  { recoveryExpiresAt: 1 },
  { name: "recoveryExpiresAt_1", expireAfterSeconds: 0 }
)
```

Do not drop any differently named or non-TTL index merely because it contains
`expiresAt`. The TTL monitor is periodic, so it may remove expired documents a
short time after their expiry timestamp.

## 5. Deploy and validate the backend

After the earlier steps and a code review are complete, use the existing
workflow from the web repository root:

```powershell
.\scripts\deploy.ps1 -CommitMessage 'Deploy NAS connector Phase 2A'
```

The script's existing remote health probe is HTTP on loopback. After it
succeeds, separately test the public HTTPS origin with `curl.exe` as shown in
section 1. Then set `NAS_CONNECTOR_ENABLED=true` only when all NAS configuration
values are present and deploy/restart again through the approved workflow.

With the flag enabled, the following synthetic request verifies that Nginx
forwards HTTPS correctly without consuming an actual enrollment code. Replace
the hostname only; all credential-looking values here are intentionally fake:

```powershell
$payload = @{
  enrollmentToken = 'nce1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  installationId = 'a9d24d65-1a96-4f65-aa06-40c74c5934ac'
  deviceSecret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  agentVersion = '0.1.0'
  root = @{ connectorRootId = 'proxy-check'; displayName = 'Proxy check'; uploadsEnabled = $false }
} | ConvertTo-Json -Compress

curl.exe -i -X POST https://files.example.com/api/nas-connectors/enroll `
  -H 'Content-Type: application/json' --data $payload
```

Expected result: `401 NAS_CONNECTOR_ENROLLMENT_INVALID`. That proves the HTTPS
guard passed and the fake token was safely rejected. `400
NAS_CONNECTOR_HTTPS_REQUIRED` means `NODE_ENV`, proxy placement, or
`X-Forwarded-Proto` is wrong. Do not repeat this test rapidly; the enrollment
endpoint is intentionally rate-limited.

## 5A. Lean release checklist and basic recovery

For this small, trusted deployment, use the existing application screens as
monitoring rather than adding a separate alerting stack. Before a release, run
these checks from clean working copies:

```powershell
# Backend repository
Set-Location C:\WebDev\adimari-project\Backend
npm test

# Frontend production bundle
Set-Location C:\WebDev\adimari-project\front-end
npm run build

# Connector repository
Set-Location C:\WebDev\adimari-nas-connector
dotnet build .\Adimari.NasConnector.sln --no-restore -c Release
dotnet test .\Adimari.NasConnector.sln --no-build -c Release
```

After deployment, use one small, non-critical folder for a practical check:

1. Confirm the public HTTPS origin works and that the host does **not** expose
   TCP 5001, SMB, MongoDB, or the S3 bucket.
2. In the Control Center, confirm **Service**, **Web server**, **Enrollment**,
   **Last heartbeat**, and **Live control channel** are healthy. In **NAS
   Connectors**, confirm the installation is active and recently seen.
3. Browse and search a folder; test one uncached Open/Download, an image
   thumbnail/lightbox, one NAS file create/change/delete, and one browser
   upload with a new filename.
4. Restart the connector once in a planned window. It should return to a
   healthy heartbeat and control channel without re-enrollment.

If something fails, start with the visible activity/error message in the
Control Center and the backend log. For a connector that is offline, verify
the Windows service and the configured server/root tests, then restart the
service. For a failed file job, cancel or retry it through the application;
do not modify queue documents or stored credentials in MongoDB. For a bad
application deployment, use the rollback procedure below. Re-enroll only
after a credential was deliberately revoked/lost or the UI explicitly reports
that recovery is required.

## 6. Publish the Windows connector package

The connector solution is separate at `C:\WebDev\adimari-nas-connector` and
targets .NET SDK 10.0.400. The publish profiles make both applications explicit
`win-x64`, self-contained, single-file Release packages. Trimming remains
disabled to avoid unsafe WPF/reflection trimming.

In Visual Studio Community 2026:

1. Open `Adimari.NasConnector.sln` and select **Release** and **x64**.
2. Right-click `Adimari.NasConnector.Service`, choose **Publish**, and select
   `WindowsService-win-x64`. Its output is `publish\service` at the solution
   root.
3. Publish `Adimari.NasConnector.ControlCenter` using
   `ControlCenter-win-x64`. Its output is `publish\control-center`.
4. Copy those two publish folders to a staging directory on the connector host.
   Do not publish directly into `C:\Program Files` or
   `C:\ProgramData\Adimari\NasConnector`.

Equivalent command-line publishing from the connector solution root is:

```powershell
dotnet publish .\src\Adimari.NasConnector.Service\Adimari.NasConnector.Service.csproj `
  -c Release -p:PublishProfile=WindowsService-win-x64

dotnet publish .\src\Adimari.NasConnector.ControlCenter\Adimari.NasConnector.ControlCenter.csproj `
  -c Release -p:PublishProfile=ControlCenter-win-x64
```

Before transfer to the NAS-connected machine, verify the expected executables
are present and record their hashes. For a production distribution, Authenticode
sign the release executables and verify the publisher on the target machine.

```powershell
Get-FileHash .\publish\service\Adimari.NasConnector.Service.exe -Algorithm SHA256
Get-FileHash .\publish\control-center\Adimari.NasConnector.ControlCenter.exe -Algorithm SHA256
Get-AuthenticodeSignature .\publish\service\Adimari.NasConnector.Service.exe
```

## 7. Prepare the Windows service account and NAS permissions

Use a dedicated domain or local service account, for example
`DOMAIN\svc_adimari_nas`. Do not use a personal administrator account,
`LocalSystem`, a mapped drive, or a broad NAS administrator account.

Before installation, an authorized Windows/NAS administrator must:

1. Grant that account **Log on as a service** on the connector host.
2. Grant only required NAS share and filesystem rights to the configured UNC
   root, for example `\\nas\projects`. Read/list rights are sufficient for
   Phase 2A and future browse/download work. Grant Modify only when browser
   uploads are intentionally enabled; never grant Full Control solely for this
   connector.
3. Ensure the account can resolve/reach the NAS and that the host clock is
   correct. Use a UNC path in the Control Center, never `Z:\` or another mapped
   drive. Windows services do not share an interactive user's drive mappings.
4. Keep the same service account identity after enrollment. Connector state is
   protected with DPAPI for that Windows identity. A change of account/SID is a
   credential-loss event and requires administrator-issued re-enrollment.

The Control Center's root test is the final access check: it asks the service,
so it validates the configured UNC path under the actual service identity.

## 8. Install the service and Control Center

Use the guarded helper from an elevated PowerShell session on the connector
machine. It always uses SCM service name `AdimariNasConnector` and display name
`Adimari NAS Connector`; it creates no inbound network listener.

For a first install, prompt for the dedicated service account rather than
putting a password on a command line or in a script:

```powershell
Set-Location C:\staging\connector-release
$credential = Get-Credential 'DOMAIN\svc_adimari_nas'
.\Install-AdimariNasConnector.ps1 `
  -ServicePublishDirectory C:\staging\connector-release\service `
  -ControlCenterPublishDirectory C:\staging\connector-release\control-center `
  -ServiceCredential $credential `
  -CreateOperatorsGroup `
  -Start
```

The helper is idempotent for the fixed install path
`C:\Program Files\Adimari\NasConnector`: an update stages both packages,
stops a running matching service only for the swap, retains the prior program
directory as `NasConnector.previous-*`, and preserves
`C:\ProgramData\Adimari\NasConnector`. It refuses to overwrite a different
service or to change an existing service account. For a normal update, omit
`-ServiceCredential`:

```powershell
.\Install-AdimariNasConnector.ps1 `
  -ServicePublishDirectory C:\staging\connector-release\service `
  -ControlCenterPublishDirectory C:\staging\connector-release\control-center `
  -Start
```

Preview its planned change first with `-WhatIf`. The helper intentionally does
not grant **Log on as a service**, alter remote NAS ACLs, change an existing
service's identity, or delete the prior package. A failed package is retained
under `C:\Program Files\Adimari` for inspection. Do not manually delete a
backup until the updated service has run successfully through the heartbeat
interval.

The optional local group `Adimari NAS Connector Operators` controls Control
Center access in addition to local Administrators. An administrator can grant
an operator access explicitly after creation:

```powershell
Add-LocalGroupMember -Group 'Adimari NAS Connector Operators' -Member 'DOMAIN\nas-operator'
```

Check the installed identity and service state:

```powershell
Get-CimInstance Win32_Service -Filter "Name='AdimariNasConnector'" |
  Select-Object Name, DisplayName, StartName, State, PathName
Get-Service -Name AdimariNasConnector
```

After a successful first start, configure the Windows Service Recovery tab (or
the equivalent approved service-management policy) to restart
`AdimariNasConnector` after unexpected failures. This is deliberately separate
from the installer so account permissions and failure policy remain an explicit
operator decision. A common reviewed policy is restart after 5 seconds, then
15 seconds, then 60 seconds, with the failure-count reset after one day.

Only the Service project is registered with SCM. Start the Control Center from
`C:\Program Files\Adimari\NasConnector\ControlCenter\Adimari.NasConnector.ControlCenter.exe`
as an authorized local user; never attempt to display WPF from the Windows
service process.

## 9. First connector enrollment and acceptance checks

1. In the web app, sign in as an administrator and open **NAS Connectors**.
   Create an enrollment code. It is returned once, expires after 15 minutes by
   default, and must not be put in email, logs, screenshots, or tickets.
2. In the Control Center, set the exact public HTTPS origin, select the UNC
   root, set a display name, and enable browser uploads only when that root
   Run the web-server and root tests, then save.
3. Paste the enrollment code into the UI and enroll. The Control Center checks
   that the pipe endpoint belongs to the SCM service before it sends the code.
4. Confirm the Control Center shows **Enrolled** and an authenticated last
   heartbeat. Refresh the web admin page and confirm the matching connector is
   `active` with a recent `lastSeenAt`.
5. Wait longer than `NAS_CONNECTOR_HEARTBEAT_STALE_AFTER_SECONDS` with the
   service stopped only in a planned test; the admin list should show it as
   `offline`. Start it again and confirm a valid heartbeat restores `active`.
6. Confirm the Control Center shows the control channel as **Connected**. A
   WSS reconnect by itself must not change enrollment status; REST heartbeat
   remains authoritative. Stop/start the service during a planned test and
   confirm the control channel reconnects after the heartbeat path is healthy.
7. If testing the Phase 2C delivery slice, have an administrator call
  `POST /api/nas-connectors/<connectorId>/roots/<connectorRootId>/index-jobs`
   with an empty JSON body. Confirm it returns `201`, the Control Center queue
   count becomes `1`, and `GET /api/nas-connectors/<connectorId>/jobs` shows
   the job progress through `accepted` to `completed`. The connector performs
   a metadata-only NAS scan.
8. For the initial Phase 4 cache path, open **NAS Files** and click **Open**,
   **Download**, or **Share** on a small indexed file. The Connector Control
   Center should show “Preparing a shared file from the NAS” followed by
   “The shared file is ready to download.” Open/Download should continue
   automatically after preparation; the public share page should change from
   **Preparing** to **Download**. Repeat an action before expiry and confirm it
   reuses the existing cache without a second connector upload. Confirm the
   private bucket contains its object only under `nas-cache/` and that its
   lifecycle rule expires it after 10 days.
9. Open a folder containing JPEG, PNG, or GIF files. It should initially show
   compact image placeholders, then persistent thumbnails as the connector
   completes its serial thumbnail jobs. Open one while its thumbnail exists:
   the lightbox enlarges that thumbnail while the full image is prepared, then
   replaces it with the full image. Confirm generated derivatives are only
   under `nas-thumbnails/`; unlike full delivery cache objects, they are not
   covered by the 10-day lifecycle rule.
10. With the connector running, create a small file in the configured NAS
    root. Within a few seconds the Control Center activity list should report
    that a file change was sent to the catalogue; the NAS Files page refreshes
    its visible folder automatically within 20 seconds (or use **Refresh**).
    Edit the file and confirm a later Open/Download prepares the changed
    version rather than using the old cache. Delete the file or a folder and
    confirm it disappears from the listing. A folder rename or a watcher
    overflow may instead show a reconciliation-scan request; that is expected.
11. With browser uploads enabled, open a known indexed NAS folder, click
    **Upload here**, and select a small new file. Confirm the progress panel
    shows browser upload, waiting for connector, and completion. Confirm the
    Control Center records the NAS upload activity, the file appears only
    after completion, and the catalogue lists it after the watcher refresh.
    Confirm a same-name file is rejected rather than overwritten. The staging
    object should be removed after successful connector completion.

If enrollment loses its successful HTTP response, the service can retry the
same request with its pending secret for the bounded recovery window. Do not
create a second initial enrollment code until that recovery has been allowed to
complete. If a credential is revoked or lost, an administrator must issue a
re-enrollment code for that specific connector.

## Rollback boundaries

- Turn `NAS_CONNECTOR_ENABLED=false` and deploy/restart the backend to remove
  the connector routes. Existing connector credentials remain in MongoDB but
  cannot reach a mounted API until the flag is enabled again.
- Revoke a connector from the admin page before decommissioning a host. This
  invalidates its credential on the next request and disables known roots.
- For a failed program update, stop the service, inspect the retained
  `NasConnector.previous-*` directory, and use the normal approved change
  process to restore it. Do not delete `C:\ProgramData\Adimari\NasConnector`
  unless intentionally retiring the connector and accepting that its DPAPI
  credential and stable installation identity are lost.
- Deleting the Windows service does not revoke the backend connector. Revoke
  it in the web admin page first, then uninstall it during a planned retirement.
