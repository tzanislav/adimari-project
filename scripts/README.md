# Deployment

Run this from the repository root in PowerShell:

```powershell
.\scripts\deploy.ps1
```

The script stages and commits all non-ignored local changes, pushes `main`, then deploys `/home/ubuntu/adimari-project` on EC2. The remote checkout is deliberately reset to `origin/main` and cleaned of untracked, non-ignored files before dependencies are installed and the frontend is built.

It preserves ignored files such as `Backend/.env`; do not add `-x` to the remote `git clean` command.

The backend is managed as PM2 process `adimari-backend`. On its first run, the script removes only legacy `node server.js` processes running from this app's `Backend` directory, then starts one replacement and verifies `GET /api/test` on the configured port.

Provide a commit message when useful:

```powershell
.\scripts\deploy.ps1 -CommitMessage 'Describe the release'
```

The defaults use the existing EC2 host, `/home/ubuntu/adimari-project`, and the key at `D:\Libraries\Work\Dev\Web Development\adimari-key-pair.pem`. Override them with the corresponding parameters if those locations change.
