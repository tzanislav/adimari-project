# Project directory

The Projects landing page uses `GET /api/project-directory`. This is separate
from the MongoDB `/api/projects` resource used by Selection.

The first read copies `seeds/projectDirectory.json` to `projects.json` in
`PROJECT_DIRECTORY_DATA_DIR`. The default for local development is
`Backend/data/project-directory`. In production, set the environment variable
to a writable directory outside the checkout, such as
`/var/lib/adimari/project-directory`, and include the directory in backups.
The directory contains `projects.json` and uploaded images. Run one backend
process against each data directory; this JSON store is not a multi-process
database.

Access levels are `public`, `mod`, and `admin`. The read API filters by the
verified Firebase role. Management routes and image uploads require an admin
token. The seed marks the existing in-app pages that require a moderator as
`mod` and the other cards as `public`.

The backend checks external links on startup and every hour thereafter.
Directory edits wait for the next scheduled check. An optional public HTTP(S)
health URL can override the link
or enable checks for an internal card. Private network targets are blocked.
The check only tests HTTP reachability; it cannot prove that every feature of
an application works. Internal cards without a health URL show `Not checked`.
