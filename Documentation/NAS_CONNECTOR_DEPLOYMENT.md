# NAS Connector deployment runbook

This is an operator runbook for deploying the NAS connector. It does not deploy
anything by itself. The Windows service uses shared-key setup, outbound HTTPS
heartbeats, and authenticated HTTPS long polling for durable job delivery. It
can scan NAS metadata, prepare cache delivery, generate thumbnails, track NAS
changes, and support browser-to-NAS uploads. The initial Phase 4 slice adds `cache_for_download`:
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
`http://` Control Center origin without a reverse proxy. Do not use this
setting for an internet-facing deployment.

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
3. Review and copy the [server template](Backend/deployment/nginx/adimari-backend.conf.template)
   rather than overwriting an existing site. It belongs in a site/server
   configuration.

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

The templates deliberately overwrite `X-Forwarded-For` with Nginx's own
`$remote_addr`; do not change this to `$proxy_add_x_forwarded_for`. The backend
uses the value only after recognizing the local Nginx hop, so appending a
client-supplied value would let a caller supply a misleading forwarding chain.

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
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
# Enter this same value once in each trusted Connector Control Center.
NAS_CONNECTOR_SHARED_SECRET=<43-character base64url shared connector key>
NAS_CONNECTOR_HEARTBEAT_INTERVAL_SECONDS=30
NAS_CONNECTOR_HEARTBEAT_STALE_AFTER_SECONDS=90
NAS_CONNECTOR_JOB_LEASE_SECONDS=90
# Conservative backend retention and operator recovery settings.
NAS_CONNECTOR_TERMINAL_JOB_RETENTION_DAYS=30
NAS_CONNECTOR_DELETED_ENTRY_RETENTION_DAYS=30
NAS_CONNECTOR_AUDIT_RETENTION_DAYS=365
NAS_CONNECTOR_STALE_THUMBNAIL_RETENTION_DAYS=14
NAS_CONNECTOR_RETENTION_SWEEP_INTERVAL_HOURS=6
NAS_CONNECTOR_RECOVERY_STUCK_AFTER_MINUTES=30
```

The NAS region and bucket must exactly equal `FILE_SERVER_AWS_REGION` and
`FILE_SERVER_BUCKET_NAME`; the four prefixes `files/`, `nas-cache/`,
`nas-upload-staging/`, and `nas-thumbnails/` must not overlap. The cache
retention setting is also intentionally fixed to the S3 lifecycle rule below.

Use a secret manager or a locally generated secret; do not put a generated
value in source control, the Vite frontend, a publish package, or an operator
ticket. If `NAS_CONNECTOR_SHARED_SECRET` is rotated, update the server first, then enter
the new value in each trusted Control Center and click **Connect connector**.

Deploy the Connector service and Control Center together for this cleanup
release because their local pipe contract is version 3. An existing
DPAPI-protected shared key is read from the prior local state shape, so a key
does not need to be re-entered unless it is intentionally rotated or rejected.

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
| `nas-thumbnails/` | Do not use a broad expiry rule; only abort incomplete multipart uploads after 7 days. The backend removes replaced, stale, and retired-entry thumbnails from their catalogue ownership records. |

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

## 4. Retired enrollment data cleanup

This release removes the enrollment-token API and model. After the backend and
all trusted Windows Connectors have been updated and reconnected with the
shared access key, the historical `nas_enrollment_tokens` MongoDB collection is
unused.

Do not delete it during application deployment. In a planned maintenance
window, take the normal database backup, confirm that no old Connector is still
calling the removed routes, then remove the collection if the historical data
is no longer required:

```javascript
use your_database_name
db.nas_enrollment_tokens.drop()
```

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

With the flag enabled, the following request verifies that Nginx forwards HTTPS
correctly without connecting a real connector. Replace the hostname only; the
key below is intentionally invalid:

```powershell
curl.exe -i -X POST https://files.example.com/api/nas-connectors/connect `
  -H 'Authorization: ConnectorKey AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
```

Expected result: `401 NAS_CONNECTOR_SHARED_KEY_INVALID`. That proves the HTTPS
guard passed and the fake key was safely rejected. `400
NAS_CONNECTOR_HTTPS_REQUIRED` means `NODE_ENV`, proxy placement, or
`X-Forwarded-Proto` is wrong.

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
2. In the Control Center, confirm **Service**, **Web server**, **Connector access**,
   **Last heartbeat**, and **Job polling** are healthy. In **NAS
   Connectors**, confirm the installation is active and recently seen.
3. Browse and search a folder; test one uncached Open/Download, an image
   thumbnail/lightbox, one NAS file create/change/delete, and one browser
   upload with a new filename.
4. Restart the connector once in a planned window. It should return to a
   healthy heartbeat and control channel without entering the shared key again.

If something fails, start with the visible activity/error message in the
Control Center and the backend log. For a connector that is offline, verify
the Windows service and the configured server/root tests, then restart the
service. For a failed file job, cancel or retry it through the application;
do not modify queue documents or stored credentials in MongoDB. For a bad
application deployment, use the rollback procedure below. If connector access
is rejected, first confirm that the server and Control Center use the same
shared key, then click **Connect connector** again.

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
4. Keep the same service account identity after connection. Connector state is
   protected with DPAPI for that Windows identity. A change of account/SID
   means the protected shared key must be entered again through the Control
   Center.

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
directories as `NasConnector.previous-*` (the newest two by default), and preserves
`C:\ProgramData\Adimari\NasConnector`. It refuses to overwrite a different
service or to change an existing service account. For a normal update, omit
`-ServiceCredential`:

```powershell
.\Install-AdimariNasConnector.ps1 `
  -ServicePublishDirectory C:\staging\connector-release\service `
  -ControlCenterPublishDirectory C:\staging\connector-release\control-center `
  -Start
```

Use `-KeepPreviousPackages 1` when disk space requires a single rollback
package; the installer intentionally permits only one or two. It removes only
the exact randomly named staging directory created by a failed run, keeps a
failed installed package for inspection, and prunes older successful previous
packages only after the updated service has remained Running for 10 seconds
and answered a bounded, read-only local status-pipe request. If `-Start` is
omitted, it keeps every existing rollback package. Backend heartbeat remains an
operator post-install check and is not required for local package recovery.

Preview its planned change first with `-WhatIf`. The helper intentionally does
not grant **Log on as a service**, alter remote NAS ACLs, change an existing
service's identity, or delete the configured rollback packages. A failed
package is retained under `C:\Program Files\Adimari` for inspection. Confirm
the connector's authenticated heartbeat after every update before relying on
the rollback backup.

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

## 9. First connector connection and acceptance checks

1. Generate one 32-byte base64url key and set it as
   `NAS_CONNECTOR_SHARED_SECRET` in the backend environment. Keep it out of
   source control, tickets, screenshots, and browser code. Restart the backend
   after changing its environment.
2. In the Control Center, set the exact public HTTPS origin, select the UNC
   root, set a display name, and enable browser uploads only when that root
   needs them. Run the web-server and root tests, then save.
3. Paste the same shared key into **Shared access key** and click **Connect
   connector**. The Control Center checks that the pipe endpoint belongs to the
   SCM service before it sends the key. The service stores the key in its own
   Windows-protected credential store; it is not stored in the WPF settings.
4. Confirm the Control Center shows **Connected** and an authenticated last
   heartbeat. Refresh the web admin page and confirm the matching connector is
   `active` with a recent `lastSeenAt`. The backend creates the connector/root
   record on this first connection and reuses it for later connections from the
   same installation.
5. Wait longer than `NAS_CONNECTOR_HEARTBEAT_STALE_AFTER_SECONDS` with the
   service stopped only in a planned test; the admin list should show it as
   `offline`. Start it again and confirm a valid heartbeat restores `active`.
6. Confirm the Control Center shows a recent successful poll. A polling retry
   by itself must not change connector access status; REST heartbeat remains
   authoritative. Stop/start the service during a planned test and confirm
   polling resumes after the heartbeat path is healthy.
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

If the key is changed, update `NAS_CONNECTOR_SHARED_SECRET` on the backend,
restart it, then enter the new key and click **Connect connector** in every
Control Center. If the local protected credential becomes unreadable, use
**Reset unreadable credential**, then enter the current shared key again.
Do not put the shared key in the web application or a browser request.

The NAS Connectors admin page includes a **Stale jobs** panel. It lists only
active jobs whose backend progress has exceeded
`NAS_CONNECTOR_RECOVERY_STUCK_AFTER_MINUTES`. **Stop stale job** marks the job
failed and records an audit event; it does not retry or replay a NAS operation.
Inspect the connector and job history first, then request a fresh scan,
delivery, thumbnail, or upload only when that is appropriate.

## Rollback boundaries

- Turn `NAS_CONNECTOR_ENABLED=false` and deploy/restart the backend to remove
  the connector routes. Existing connector records remain in MongoDB but
  cannot reach a mounted API until the flag is enabled again.
- Disable a connector from the admin page before decommissioning a host. This
  blocks its shared-key connections and disables known roots. Use **Enable**
  there if it was disabled accidentally; its next valid heartbeat restores it.
- For a failed program update, stop the service, inspect the retained
  `NasConnector.previous-*` directory, and use the normal approved change
  process to restore it. Do not delete `C:\ProgramData\Adimari\NasConnector`
  unless intentionally retiring the connector and accepting that its DPAPI
  credential and stable installation identity are lost.
- Deleting the Windows service does not disable the backend connector. Disable
  it in the web admin page first, then uninstall it during a planned retirement.
