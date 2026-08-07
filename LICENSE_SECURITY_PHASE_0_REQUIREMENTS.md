# License security update — Phase 0 requirements

## Purpose

This document records the confirmed access-control requirements for the license password
security update. It supersedes the Phase 0 access decisions in
`LICENSE_SECURITY_UPDATE_CHECKLIST.md`.

## Security objective

- License passwords must be retrievable by authorized users, so they require reversible,
  authenticated encryption rather than one-way password hashing.
- The backend is the security boundary. Client-side route guards, filters, and hidden controls
  are usability features only and must not decide access.
- Non-moderator and non-admin users must not list, read, create, modify, delete, or decrypt any
  license record, including private records they may have created before losing their role.

## Authoritative roles

Roles come from verified Firebase ID-token custom claims.

- `regular`: no license access.
- `moderator`: may work with moderator-visible entries and with private entries they created.
- `admin`: may work with every license entry, regardless of clearance or creator.

The backend must authenticate every license request and then authorize the Firebase role and,
where applicable, record ownership. It must not trust role, owner, clearance, or creator values
sent by the browser.

## Clearance values

The `clearances` field has exactly these valid values:

| Clearance | Visible and editable by |
| --- | --- |
| `moderator` | Every moderator and every admin |
| `private` | The original creator and every admin |
| `admin` | Every admin only |

Missing, malformed, or unknown clearance values must be treated as inaccessible until the data is
normalized. The production schema must validate the three supported values.

## Private ownership

- Add `createdByUid` to every license record.
- Set `createdByUid` only on the backend from `req.user.uid`, after Firebase token verification.
- Make `createdByUid` immutable through normal create/update endpoints. A display-oriented
  `createdBy` field, if retained, is non-authoritative and must never be used for authorization.
- Changing clearance never changes `createdByUid`.
- A private record is therefore accessible to its original creator, provided that creator still
  has the `moderator` or `admin` role, and to every admin.
- An administrator can access and edit private records because administrator access overrides
  clearance ownership.

## Required authorization matrix

| Action | Regular | Moderator | Admin |
| --- | --- | --- | --- |
| List/read a moderator-visible entry | Deny | Allow | Allow |
| List/read own private entry | Deny | Allow | Allow |
| List/read another user’s private entry | Deny | Deny | Allow |
| List/read an admin-only entry | Deny | Deny | Allow |
| Create moderator-visible entry | Deny | Allow | Allow |
| Create private entry | Deny | Allow | Allow |
| Create admin-only entry | Deny | Deny | Allow |
| Edit/delete moderator-visible entry | Deny | Allow | Allow |
| Edit/delete own private entry | Deny | Allow | Allow |
| Edit/delete another user’s private entry | Deny | Deny | Allow |
| Edit/delete admin-only entry | Deny | Deny | Allow |
| Change a moderator-visible entry to private | Deny | Allow | Allow |
| Change an accessible private entry to moderator-visible | Deny | Allow | Allow |
| Change an entry to or from admin-only | Deny | Deny | Allow |
| Read a decrypted password | Deny | Allow only when the entry is visible | Allow |

## Visibility-change rule

Moderators may switch moderator-visible entries to `private` and switch private entries they can
access back to `moderator`. Privatizing an entry does **not** transfer ownership: it remains
private to its original `createdByUid` and to admins. A moderator cannot access another user’s
private entry in order to switch it back.

## Implementation requirements for later phases

- Protect the entire `/api/licenses` router with Firebase authentication and an explicit
  `moderator`/`admin` role authorization check.
- Apply clearance and `createdByUid` filters in every list, read-by-ID, update, delete, and
  password-decryption query. A direct ID request must not bypass this filter.
- Whitelist request fields. Derive `createdByUid` and creator information server-side, and reject
  client attempts to set or modify either ownership field.
- Return `401`, `403`, and `404` responses without exposing whether an inaccessible license
  record exists.
- Implement API tests for every row of the authorization matrix before production deployment.

## Outstanding operational decision

Before production migration, identify the deployment owner, approved server-side secret store,
maintenance window, and rollback decision-maker.
