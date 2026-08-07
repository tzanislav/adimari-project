# Backend Access and Route Overview

Static review of the Express backend and the React route guard (August 2026). This is an implementation map, not an API contract.

## Shape of the backend

`Backend/server.js` starts one Express application, connects to MongoDB through Mongoose, verifies Firebase ID tokens, and serves the built React application from `front-end/dist`. Most resource handlers live directly in `Backend/routes/`; there is no service layer.

Primary integrations are Firebase Auth, MongoDB, AWS S3/Rekognition, ClickUp, and OpenAI (for price estimation).

## User levels

Roles are Firebase custom claims, verified from `Authorization: Bearer <Firebase ID token>`. The legacy Mongo `users` collection is separate from Firebase Auth and is only used by the admin-only `/api/users` endpoints.

| Role | Server-side abilities |
| --- | --- |
| Unauthenticated visitor | Read public catalog/project/selection data and use public activity endpoints; sign up or complete Google-sign-in setup. |
| `regular` | Everything public, plus authenticated license CRUD, uploads, and price estimation. It cannot change core catalog data or use ClickUp. |
| `moderator` | `regular` abilities plus create, update, and delete brands, items, 3D models, projects, selections; access ClickUp endpoints. |
| `admin` | `moderator` abilities plus create/list/delete records in the legacy Mongo `users` collection and change Firebase role claims. |

Notes:

- New email/password sign-ups receive `regular`; Google users without a claim are assigned `regular` on first backend Google sign-in.
- The frontend `ProtectedRoute` permits only `moderator` and `admin` (level >= 2). It is presentation control, not the security boundary; API middleware is the security boundary.
- The standalone `GET /auth/moderator` accepts only `moderator`, not `admin`. This looks like a role demonstration endpoint rather than an admin hierarchy check.

## Backend routes

Legend: **Public** = no backend token check; **Signed in** = any valid Firebase token; **Editor** = `moderator` or `admin`; **Admin** = `admin` only.

| Base path | Endpoints | Access | Purpose |
| --- | --- | --- | --- |
| `/api/brands` | `GET /`, `GET /:id`, `GET /:id/models` | Public | Browse brands and related models. |
|  | `POST /`, `PUT /:id`, `DELETE /:id` | Editor | Brand management. |
| `/api/items` | `GET /`, `GET /:id`, `GET /:id/models` | Public | Browse inventory and related models. |
|  | `POST /`, `PUT /:id`, `DELETE /:id` | Editor | Item management. |
| `/api/models3d` | `GET /`, `GET /:id` | Public | Browse 3D model metadata. |
|  | `POST /`, `PUT /:id`, `DELETE /:id` | Editor | 3D-model management. |
| `/api/projects` | `GET /`, `GET /:id`, `GET /:id/selections` | Public | Browse projects and their selections. |
|  | `POST /`, `PUT /:id`, `DELETE /:id` | Editor | Project management; deletion also removes child selections. |
| `/api/selections` | `GET /`, `GET /:id` | Public | Browse selections; detail includes expanded `itemDetails`. |
|  | `POST /`, `PUT /:id`, `DELETE /:id` | Editor | Selection management. Creating one resolves `body.project` into `parentProject`. |
| `/api/users` | `POST /add`, `GET /all`, `DELETE /delete/:id` | Admin | Legacy Mongo user-record management. |
| `/api/licenses` | `GET /`, `POST /`, `GET /:id`, `PUT /:id`, `DELETE /:id` | Moderator or admin | Server-enforced license CRUD. Moderators access moderator-visible records; admins access all records. |
| `/api/upload` | `GET /`, `POST /?folder=` | Signed in | Upload up to 10 files (4 MB each) directly to S3. |
|  | `POST /analyze-image`, `GET /analyze-s3-image?key=` | Signed in | Rekognition image-label analysis. |
| `/api/openai` | `GET /?query=` | Signed in | Bing scrape + OpenAI price extraction; rate-limited. |
| `/clickup` | `GET /time-entries/all/:user_id`, `GET /time-entries/range/:user_id`, `GET /time-entries`, `GET /time-entries/:user_id`, `GET /current-task/:user_id`, `GET /members` | Editor | ClickUp time and member proxy; rate-limited. |
| `/api/activity` | `GET /time-entries`, `GET /time-entries/:id`, `POST /time-entries` | Public | Cached ClickUp-member list and Mongo activity-log access. |
| `/api/admin` | `GET /backup` | Admin | Downloads a strict Extended JSON export of every database collection and its indexes. |
| `/api/test` | `GET /api/test` | Public | Basic health/test response. |

### Authentication routes

| Endpoint | Access | Behaviour |
| --- | --- | --- |
| `POST /auth/signup` | Public | Creates Firebase email/password user and assigns `regular`. |
| `POST /auth/signin` | Public | Disabled; returns `410`. Firebase client auth is used instead. |
| `POST /auth/google-signin` | Valid Firebase token supplied manually | Ensures a default `regular` claim and returns role/token. |
| `GET /auth/get-role`, `GET /auth/protected`, `GET /auth/user` | Signed in | Retrieves claim/identity information. |
| `POST /auth/update-role`, `GET /auth/admin` | Admin | Change role claim / admin test endpoint. |
| `GET /auth/moderator` | Moderator only | Moderator test endpoint. |

## React application routes

The UI guard redirects non-editors to `/`.

| Route | UI access |
| --- | --- |
| `/`, `/signup`, `/items`, `/team/summary` | Public (`/team/summary` is explicitly left unprotected). |
| `/items/new`, `/items/edit/:id`, `/items/:id`, `/projects`, `/projects/:id`, `/projects/edit/:id`, `/projects/new`, `/selections/:id`, `/team`, `/licenses`, `/logtest` | Moderator or admin via `ProtectedRoute`. |

The navbar can show links such as Team and Licenses to guests, but the destination route guard redirects them. There are frontend components/pages for brands and 3D models, but no corresponding top-level route in `src/App.jsx` at the time of review.

## Important review findings

1. **Activity endpoints are completely public.** Anyone can read stored activity logs or submit entries for an existing cached ClickUp member. If these endpoints are intended for internal team use, add authentication and an appropriate role check.
2. **Catalog/project reads are public by design in the current code.** That includes selection details and item data. Confirm this matches the desired visibility before treating the API as internal-only.
3. **Some non-license writes use broad request bodies.** Add schema validation/allowlists before exposing those routes more widely.
4. **Role updates require refreshed Firebase tokens.** After `/auth/update-role`, the client must refresh its ID token (or sign in again) before the new custom claim is reflected by server authorization.

## Key source locations

- Application setup and mount-level middleware: `Backend/server.js`
- Firebase token/role middleware: `Backend/auth/authMiddleware.js`
- Auth and role management: `Backend/routes/authRoutes.js`
- UI role loading/route guard: `front-end/src/context/AuthContext.jsx`, `front-end/src/components/ProtectedRoute.jsx`, `front-end/src/App.jsx`
