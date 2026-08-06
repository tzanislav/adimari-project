# Database backup and restore

An admin can use **Download database backup** at the top of the Items page. The browser downloads a timestamped JSON file locally; the server does not retain another copy.

The file uses strict MongoDB Extended JSON and contains every collection currently in the connected database, all documents, and collection indexes, except `activity_log`. This preserves values such as MongoDB ObjectIds and Dates instead of flattening them into ordinary strings.

To restore it into a replacement MongoDB database, set `MONGODB_URI` to the destination and run from `Backend`:

```powershell
$env:MONGODB_URI = 'mongodb connection string for the new database'
node scripts/restoreBackup.js 'C:\path\to\adimari-mongodb-backup-....json'
```

The restore stops if a destination collection already exists. Use `--replace` only when you intentionally want to delete and restore every collection contained in the backup:

```powershell
node scripts/restoreBackup.js 'C:\path\to\backup.json' --replace
```

Backups contain license credentials and other application data. Store them as sensitive files and verify a restore into a separate test database before retiring the current MongoDB service.
