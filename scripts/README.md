# Deployment

Run this from the repository root in PowerShell:

```powershell
.\scripts\deploy.ps1
```

The script stages and commits all non-ignored local changes, pushes `main`, then deploys `/home/ubuntu/adimari-project` on EC2. The remote checkout is deliberately reset to `origin/main` and cleaned of untracked, non-ignored files before dependencies are installed and the frontend is built.

It preserves ignored files such as `Backend/.env`; do not add `-x` to the remote `git clean` command.

The backend is managed as PM2 process `adimari-backend`. On its first run, the script removes only legacy `node server.js` processes running from this app's `Backend` directory, then starts one replacement and verifies `GET /api/test` on the configured port.

It also verifies that the public `/file-sync-api/api/storage-nodes` route reaches
the protected File Sync API. An unauthenticated request must return HTTP 401;
an HTTP 200 normally means Nginx is serving the React fallback instead of
proxying File Sync. The default public host is `adimari-db.com`; override it
when necessary:

```powershell
.\scripts\deploy.ps1 -PublicHost 'your-adimari-host.example'
```

Provide a commit message when useful:

```powershell
.\scripts\deploy.ps1 -CommitMessage 'Describe the release'
```

The defaults use the existing EC2 host, `/home/ubuntu/adimari-project`, and the key at `D:\Libraries\Work\Dev\Web Development\adimari-key-pair.pem`. Override them with the corresponding parameters if those locations change.

## Updating the NAS Connector

After copying a published connector release to the NAS-connected Windows PC at
`C:\staging\connector-release` (with `service`, `control-center`, and
`Install-AdimariNasConnector.ps1` inside it), run the wrapper from an elevated
PowerShell session on that PC:

```powershell
.\Update-NasConnector.ps1
```

It previews the guarded installer by default. Apply the update only after
reviewing the preview:

```powershell
.\Update-NasConnector.ps1 -Apply
```

The update preserves connector state and its existing service account. It
retains two rollback packages by default; use `-KeepPreviousPackages 1` only
when disk space requires it.
