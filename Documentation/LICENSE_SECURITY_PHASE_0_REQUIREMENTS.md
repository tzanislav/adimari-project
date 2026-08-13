# License security access requirements

## Security objective

- License passwords are reversibly encrypted only on the backend so authorized users can retrieve
  them when needed.
- The backend is the security boundary. Client-side route guards and hidden controls are usability
  features only and must not decide access.
- Users without the `moderator` or `admin` Firebase role must not list, read, create, edit,
  delete, or decrypt license entries.

## Authoritative roles

Roles come from verified Firebase ID-token custom claims.

- `regular`: no license access.
- `moderator`: may work with moderator-visible entries.
- `admin`: may work with every license entry, including admin-only entries.

The backend must authenticate every license request and enforce role and clearance checks. It must
not trust role or clearance values supplied by the browser.

## Clearance values

The `clearances` field has exactly these valid values:

| Clearance | Visible and editable by |
| --- | --- |
| `moderator` | Every moderator and every admin |
| `admin` | Every admin only |

Missing, malformed, or unknown clearance values must be treated as inaccessible until normalized.
The production schema validates the two supported values.

## Required authorization matrix

| Action | Regular | Moderator | Admin |
| --- | --- | --- | --- |
| List/read a moderator-visible entry | Deny | Allow | Allow |
| List/read an admin-only entry | Deny | Deny | Allow |
| Create/edit/delete a moderator-visible entry | Deny | Allow | Allow |
| Create/edit/delete an admin-only entry | Deny | Deny | Allow |
| Set or change clearance to `admin` | Deny | Deny | Allow |
| Read a decrypted password | Deny | Allow when the entry is visible | Allow |

## Implementation requirements

- Protect the entire `/api/licenses` router with Firebase authentication and explicit
  `moderator`/`admin` authorization.
- Apply clearance filters in every list, read-by-ID, update, delete, and password-decryption
  query. A direct ID request must not bypass this filter.
- Whitelist writable request fields and reject unsupported clearance values on the server.
- Return `401`, `403`, and `404` responses without exposing whether an inaccessible license record
  exists.
- Maintain API tests for every row of the authorization matrix.
