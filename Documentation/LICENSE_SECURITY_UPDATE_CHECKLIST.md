# License credential security update checklist

## Objective

Replace plaintext license passwords with application-level, reversible encryption so that
only authorized **moderators** and **admins** can use them. Authorization must be enforced
by the backend; hiding records or controls in the React client is not a security boundary.

This checklist is intentionally split into small phases. Complete, review, and commit each
phase before starting the next one.

## Current-state findings

- License records are stored in MongoDB's `licenses` collection through
  `Backend/models/LicenseEntry.js`; the `password` field is plaintext today.
- `Backend/server.js` requires Firebase authentication for `/api/licenses`, but the route
  handlers themselves allow every signed-in role to read and change every license.
- The UI restricts the Licenses page to moderators and admins, and hides records with
  `clearances: "admin"` for moderators. These checks are client-side and therefore bypassable.
- Backups intentionally include license credentials, so encrypted backups and encryption-key
  storage must be treated as separate sensitive assets.
- The existing `.gitignore` excludes `.env` files. Do not commit an encryption key, decrypted
  export, migration result containing credentials, or production backup.

## Phase 0 — agree on the security contract

- [ ] Confirm that a license password must be recoverable by the application. Do **not** use
  bcrypt, scrypt, or Argon2 for this field: those are one-way password hashes and cannot meet
  the moderator/admin access requirement.
- [ ] Confirm the access matrix and write it into the API tests:

  | Action | Regular | Moderator | Admin |
  | --- | --- | --- | --- |
  | List/read a moderator-visible license | Deny | Allow | Allow |
  | List/read an admin-only license | Deny | Deny | Allow |
  | Create/update/delete a moderator-visible license | Deny | Allow | Allow |
  | Create/update/delete an admin-only license | Deny | Deny | Allow |
  | Set or change `clearances` to `admin` | Deny | Deny | Allow |
  | Read a decrypted password | Deny | Allow when record is visible | Allow |

- [ ] Decide whether moderators may delete moderator-visible licenses. If not, adjust the
  matrix and enforce that decision in the backend before implementing it.
- [ ] Confirm the existing meanings: `clearances: "moderator"` means visible to moderators and
  admins; `clearances: "admin"` means visible only to admins. Treat missing/invalid clearance
  values as the least-privileged option until normalized.
- [ ] Identify the production deployment owner, the secret manager/environment configuration,
  a maintenance window, and a rollback decision-maker.

## Phase 1 — establish key management and encryption format

- [ ] Generate one cryptographically random 32-byte data-encryption key for the initial key
  version; encode it as base64.
- [ ] Store it only in the production secret manager or protected server environment as, for
  example, `LICENSE_ENCRYPTION_KEY_V1`. Keep it out of MongoDB, source control, frontend
  environment variables, logs, backups, and client responses.
- [ ] Record a non-secret key identifier such as `v1`. Keep the key identifier with each
  ciphertext so a future rotation can decrypt old records with the correct key.
- [ ] Implement a small backend-only crypto module using Node's built-in `crypto` package and
  authenticated encryption: AES-256-GCM, a fresh 12-byte random IV per encryption, and a
  16-byte authentication tag. Never reuse an IV with the same key.
- [ ] Define and document one versioned storage shape, for example:

  ```json
  {
    "version": 1,
    "algorithm": "aes-256-gcm",
    "keyId": "v1",
    "iv": "base64",
    "ciphertext": "base64",
    "authTag": "base64"
  }
  ```

- [ ] Validate key length and encoding at backend startup. Fail closed if the configured key is
  missing or malformed; do not generate a replacement key at runtime.
- [ ] Use authenticated decryption and return a generic server error for an invalid or tampered
  ciphertext. Do not return cryptographic internals, plaintext, keys, or serialized records in
  errors or logs.
- [ ] Add focused tests for encrypt/decrypt, different ciphertexts for the same plaintext,
  malformed key configuration, tamper detection, and unsupported key/version handling.

## Phase 2 — harden license authorization and response handling

- [ ] Protect the entire `/api/licenses` router with `authorizeRole(['moderator', 'admin'])`,
  in addition to the existing Firebase authentication middleware.
- [ ] Move clearance filtering to the backend:
  - Moderators may query only `clearances: "moderator"` records.
  - Admins may query both moderator-visible and admin-only records.
  - A lookup, update, or delete by ID must apply the same clearance filter; never fetch by ID
    and rely on the UI to conceal the result.
- [ ] Whitelist accepted create/update fields rather than passing `req.body` directly to Mongoose.
  The server, not the client, must set `createdBy` from the verified Firebase identity.
- [ ] For moderator requests, force `clearances` to `moderator` and reject attempts to create or
  modify admin-only records. Only admins may select `admin` clearance.
- [ ] Decide and implement whether password decryption is returned as part of authorized license
  responses or through a separate authorized `GET /api/licenses/:id/password` endpoint. In
  either design, decrypt only after authentication and record-level authorization succeed.
- [ ] Ensure list, create, update, and delete responses never contain the encrypted payload
  unless it is deliberately required for a privileged server-side operation. Do not expose
  encryption metadata to the browser.
- [ ] Remove client-side-only authorization assumptions from `Licenses.jsx` and
  `LicenseEntryForm.jsx`; retain their checks as UX only. Handle API `401`, `403`, and `404`
  responses without leaking record existence.
- [ ] Change the password form field to `type="password"` and avoid `console.log` statements
  that print form data or fetched license objects. Avoid displaying a password in a response
  error or toast.

## Phase 3 — introduce the encrypted schema and normal write path

- [ ] Add an encrypted password field (for example, `passwordEncrypted`) that stores the
  versioned encryption object. Do not mark the legacy plaintext field required in the final
  schema.
- [ ] Update create and password-changing update paths to encrypt in the backend immediately
  before persistence. The browser continues to submit plaintext over HTTPS, but plaintext must
  not be stored, logged, or returned unnecessarily.
- [ ] Define update semantics explicitly: absence of `password` preserves the existing secret;
  a supplied password encrypts and replaces it; an empty password is rejected unless clearing a
  credential is an approved business case.
- [ ] Add an internal, server-side projection/serializer that decrypts only for an authorized
  response and otherwise omits both plaintext and encrypted secret fields.
- [ ] Add schema-level validation for permitted clearance values and the encrypted payload's
  required properties. Consider a Mongoose transform that prevents accidental serialization of
  `password`, `passwordEncrypted`, IVs, or tags.
- [ ] Update route and UI tests for all roles, all clearance cases, create/update/delete rules,
  authorized password retrieval, and the absence of secret fields from unauthorized responses.
- [ ] Deploy this code only after the encryption key is present in every backend environment.
  During the short migration window, reads may support legacy plaintext **only on the server and
  only for already-authorized users**; all new/changed passwords must be encrypted.

## Phase 4 — prepare and run the one-time migration

- [ ] Take a verified, access-restricted database backup immediately before migration. Store its
  location and checksum in the change record; recognize that this backup still contains plaintext
  credentials and set an approved retention/deletion date.
- [ ] Count and sample records without printing passwords: total licenses, records with plaintext
  only, encrypted only, both fields, neither field, invalid clearance values, and missing
  required non-secret fields.
- [ ] Prefer a one-time backend script or tightly controlled administrative operation over a
  generally available HTTP endpoint. It reduces the exposure of a high-impact migration action.
- [ ] If a temporary route is required, implement all of the following before deployment:
  - [ ] Mount it below an admin-only maintenance router and require Firebase authentication plus
    `authorizeRole('admin')`.
  - [ ] Require an environment feature flag such as `LICENSE_PASSWORD_MIGRATION_ENABLED=true`;
    keep it false in normal operation.
  - [ ] Require an explicit one-time confirmation value and record a non-secret audit entry with
    actor, timestamp, count, and result.
  - [ ] Make it idempotent: migrate only records where `passwordEncrypted` is absent and legacy
    `password` is a string.
  - [ ] Process in bounded batches and use conditional updates so concurrent edits cannot
    overwrite a newly encrypted password.
  - [ ] For each successful record, write the encrypted payload and `$unset` the plaintext
    `password` in the same atomic update.
  - [ ] Return counts and opaque record IDs only; never return a password, ciphertext, IV, tag,
    key, stack trace, or raw database error.
  - [ ] Disable the feature flag immediately after a successful run, then remove the route and
    its tests/configuration in Phase 6.
- [ ] Run the migration first against a restored, non-production backup and verify the result
  before the production window.
- [ ] Run production migration once, monitor errors and counts, and stop on unexpected results.
  Do not retry failed records by copying their plaintext into tickets, logs, or chat.

## Phase 5 — verify, cut over, and clean sensitive history

- [ ] Verify database invariants without exporting secrets:
  - [ ] Zero records retain the legacy `password` field.
  - [ ] Every active license has a valid `passwordEncrypted` payload using the expected key ID.
  - [ ] A controlled authorized test can decrypt a representative set, including an admin-only
    record.
  - [ ] Regular users receive `403` for every license endpoint.
  - [ ] Moderators cannot list, fetch, modify, delete, or decrypt an admin-only record.
  - [ ] Admins can perform the approved operations for both visibility levels.
- [ ] Exercise the application UI with moderator and admin Firebase accounts. Refresh Firebase
  tokens after any role changes so tests use current claims.
- [ ] Search backend logs, browser console output, error tracking, CI artifacts, and migration
  responses for accidental secret logging; rotate any credential found outside intended storage.
- [ ] Update `BACKUP_AND_RESTORE.md` and operational runbooks: backups contain encrypted license
  secrets but remain sensitive; restoring without the corresponding key makes them unrecoverable.
- [ ] Retire the pre-migration plaintext backup according to the agreed retention policy. If it
  was copied to unmanaged locations, treat that as an incident and rotate affected license
  credentials where practical.

## Phase 6 — finalize and maintain

- [ ] Remove legacy plaintext fallback reads and remove the `password` schema field completely.
- [ ] Remove the temporary migration route/script access path, feature flag, temporary
  environment configuration, and any migration-only dependencies. Confirm it cannot be mounted
  in production after cleanup.
- [ ] Add a regression test that rejects database documents with plaintext password fields and a
  repository/CI secret-scanning rule appropriate to the deployment environment.
- [ ] Document key rotation: introduce a new key ID, deploy both keys, re-encrypt records in
  batches to the new key, verify counts/decryption, then retire the old key only after all old
  ciphertext and retained backups that require it have passed their retention date.
- [ ] Schedule a periodic access-control review of Firebase custom claims, administrators,
  moderators, database permissions, backup permissions, and server secret-manager access.

## Completion criteria

- [ ] No plaintext license password exists in the live database, application logs, source
  repository, frontend bundle, migration output, or normal API responses.
- [ ] Only the backend can access the encryption key, and only server-authorized moderators and
  admins can obtain a password for a record visible to their role.
- [ ] Every license route enforces role and clearance authorization on the server.
- [ ] The migration mechanism has been removed, legacy fallback is gone, tests pass, and the
  rollback/backup record has an owner and expiry date.
