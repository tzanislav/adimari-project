# Backend Architecture

This document describes how the backend is assembled, how requests move through it, which modules own which responsibilities, and which design constraints future maintainers should keep in mind.

## Overview

The backend is a single Express application started from `Backend/server.js`.

Primary responsibilities:

- expose REST endpoints for core domain data: brands, items, models, projects, selections, licenses, users
- verify Firebase ID tokens and apply role-based access control on protected routes
- connect to MongoDB through Mongoose models
- proxy a few external services: AWS S3/Rekognition, ClickUp, and OpenAI via Puppeteer-driven Bing scraping
- serve the built React frontend from `front-end/dist` in production-style deployments

The codebase is organized by concern rather than by feature module. The main layout is:

- `server.js`: app bootstrap, middleware, route mounting, MongoDB connection, static frontend serving
- `auth/`: Firebase Admin bootstrap and authentication middleware
- `models/`: Mongoose schemas and collection bindings
- `routes/`: resource and integration endpoints
- `.env` and `.env.example`: runtime configuration

## Startup Flow

Application boot happens in this order inside `Backend/server.js`:

1. Load environment variables with `dotenv`.
2. Create the Express app.
3. Configure global middleware:
   - `helmet`
   - restricted `cors`
   - JSON body parsing with a 1 MB limit
   - route-specific rate limiting
4. Read `MONGODB_URI` from the environment and connect Mongoose.
5. Mount route modules.
6. Serve static files from `front-end/dist`.
7. Fallback all unmatched GET requests to `front-end/dist/index.html`.
8. Start listening on `PORT` or `5001`.

If `MONGODB_URI` is missing, the server exits early rather than starting in a broken state.

## Request Flow

Most requests follow this path:

1. HTTP request hits Express.
2. Global middleware runs first.
3. If the route is mounted with authentication, `authenticate` verifies the Firebase bearer token.
4. If the route requires a role, `authorizeRole` checks `req.user.role`.
5. The route handler reads params, query, and body.
6. The handler either:
   - queries or mutates MongoDB through a Mongoose model, or
   - calls an external service such as S3, Rekognition, ClickUp, or OpenAI
7. The handler returns JSON.

There is no centralized service layer yet. Most route files talk directly to Mongoose models or external APIs.

## Authentication And Authorization

Authentication is based on Firebase Auth.

- The frontend signs users in with Firebase.
- The frontend sends Firebase ID tokens as `Authorization: Bearer <token>`.
- `auth/authMiddleware.js` verifies the token with Firebase Admin.
- Custom claims are used for roles.

Current role levels used by the application:

- `regular`
- `moderator`
- `admin`

Important behavior:

- write access for brands, items, models, projects, and selections is currently restricted to `admin` and `moderator`
- user-management routes are currently restricted to `admin`
- license routes are authenticated at the mount level
- ClickUp routes are authenticated and restricted to `admin` and `moderator`
- upload and OpenAI routes are authenticated and rate-limited

`auth/firebase-admin.js` supports three credential-loading modes:

1. `FIREBASE_SERVICE_ACCOUNT_JSON`
2. `FIREBASE_SERVICE_ACCOUNT_PATH`
3. local `auth/account.json` fallback in non-production only

## Route Map

Routes are mounted in `server.js`.

### Core CRUD Routes

- `/api/brands` -> `routes/brandRoutes.js`
- `/api/items` -> `routes/itemRoutes.js`
- `/api/models3d` -> `routes/modelRoutes.js`
- `/api/projects` -> `routes/projectRoutes.js`
- `/api/selections` -> `routes/selectionRoute.js`
- `/api/licenses` -> `routes/licenseEntryRoutes.js`
- `/api/users` -> `routes/userRoutes.js`

Read routes are mostly public today except where the mount itself is protected. Write routes are more restricted after the recent security pass.

### Auth Routes

- `/auth/signup`
- `/auth/google-signin`
- `/auth/get-role`
- `/auth/update-role`
- `/auth/protected`
- `/auth/admin`
- `/auth/moderator`
- `/auth/user`

Note that `/auth/signin` is intentionally disabled. The application is expected to use Firebase client-side authentication rather than custom email-password token minting on the backend.

### Integration Routes

- `/api/upload` -> S3 upload and Rekognition analysis
- `/api/openai` -> Bing scrape plus OpenAI price extraction
- `/clickup` -> ClickUp proxy endpoints for team activity data
- `/api/activity` -> internal activity logging and cached team-member lookup

## Data Model Relationships

The backend uses MongoDB collections through Mongoose schemas, but the domain relationships are lightweight and only partially normalized.

### Project

Defined in `models/project.js`.

Fields:

- `name`
- `description`

Projects do not store child selections directly. Instead, selections point back to the project through `parentProject`.

### Selection

Defined in `models/selection.js`.

Fields:

- `name`
- `description`
- `parentProject`
- `items`
- `createdAt`

Important detail:

- `items` is an embedded array of `{ _id, count }`
- `_id` here is an item identifier stored as a string, not a Mongoose object reference

The route layer expands these stored item IDs into full item documents when returning a selection detail response.

### Item

Defined in `models/item.js`.

Fields include:

- `name`
- `brand`
- `distributor`
- `description`
- `website`
- `files`
- `category`
- `class`
- `price`
- `priceMethod`
- `tags`
- `modelPath`
- `has3dmodels`
- `hasDWGmodels`
- `createdAt`
- `createdBy`

Important caveat:

- the file is named `item.js`, but the internal schema variable is still named `brandSchema`; that is only a naming inconsistency, not a separate model

### Brand

Defined in `models/brand.js`.

Brands contain vendor-style metadata such as website, contact info, discount, categories, and file links.

### Model3d

Defined in `models/model3d.js`.

This stores 3D model metadata, image URLs, tags, brand name, price, and an optional file path.

### License

Defined in `models/LicenseEntry.js`.

This stores license credentials and ownership information. It is sensitive data and should be treated accordingly.

Important caveat:

- the schema currently includes a plaintext `password` field

### User

Defined in `models/user.js`.

This is a legacy-looking collection model separate from Firebase Auth. It also contains a plaintext `password` field. Future maintainers should verify whether this collection is still actively used before expanding it further.

### ActivityLog

Defined in `models/activityLog.js`.

Stores:

- `userId`
- `movement`
- `timestamp`

## Route-Level Behavior Notes

### Brands, Items, Models, Projects, Selections

These route files generally follow a simple pattern:

- `GET` returns collection or entity data
- `POST` creates a new document from `req.body`
- `PUT` updates a document directly from `req.body`
- `DELETE` removes a document by ID

There is no shared validation layer yet. Most write handlers still accept broad bodies and pass them into Mongoose with minimal allowlisting.

### Project To Selection Flow

This is the most important domain flow in the app.

1. A project is created in `projectRoutes.js`.
2. A selection is created in `selectionRoute.js` with a `project` value in the request body.
3. The route resolves that project and stores the actual project ID as `parentProject`.
4. Selection items are stored as lightweight item references with counts.
5. Reading a selection detail loads the selection, extracts item IDs, fetches the item documents, and returns both the selection and `itemDetails`.
6. Deleting a project also deletes selections that reference it.

This means selections are the real child resource of projects even though the project schema itself does not expose that relationship.

### Upload Flow

`routes/upload.js` owns file uploads and image analysis.

Current behavior:

- uploads go directly to S3 using `multer-s3`
- the caller chooses a logical folder through `?folder=`
- folder names and filenames are sanitized before being used as S3 keys
- uploads are limited to 10 files and 4 MB per file
- images can be analyzed either by fetching a remote HTTPS image URL or by loading an object from S3 and sending bytes to Rekognition

This module depends on:

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET_NAME`

### ClickUp Proxy Flow

`routes/clickupRoutes.js` is a thin pass-through layer to ClickUp APIs. It does not persist results locally.

Used endpoints:

- team time entries
- assignee time entries
- current assignee task
- space members

This route family exists to hide the ClickUp API key from the frontend and normalize access through the backend.

### Activity Logging Flow

`routes/activityRoute.js` is partly independent from the ClickUp proxy.

At process startup it fetches team members from ClickUp and caches them in memory.

Then:

- `GET /api/activity/time-entries` returns the cached member list
- `GET /api/activity/time-entries/:id` returns stored movement logs from MongoDB
- `POST /api/activity/time-entries` stores a new `ActivityLog`

Important caveat:

- the cached team-member list only refreshes on process start in the current design

### OpenAI Price Estimation Flow

`routes/openairoute.js` performs a multi-step workflow:

1. accept a short search query
2. open Bing in Puppeteer
3. search for `query + " price"`
4. scrape visible organic results text
5. send that text to OpenAI
6. ask the model to return a JSON price estimate or extracted price
7. parse and return `{ query, price, status }`

This flow is expensive compared with the CRUD routes and should be treated as a special-purpose feature, not a generic backend pattern.

## External Dependencies

The backend depends on several outside systems.

### MongoDB

- primary application data store
- connected through Mongoose
- configured through `MONGODB_URI`

### Firebase Auth

- source of truth for login identity and role claims
- verified on the server through Firebase Admin

### AWS S3

- file storage for uploads

### AWS Rekognition

- label detection for uploaded or remote images

### ClickUp

- time-entry and member data for team status features

### OpenAI

- post-processing scraped search results into a price estimate

## Static Frontend Serving

The backend doubles as a static file server for the Vite frontend build.

Behavior:

- Express serves `front-end/dist`
- any unmatched `GET` falls back to `index.html`

This allows a single deployment artifact where the Node server handles both API routes and the compiled SPA.

## Operational Configuration

Documented in `Backend/.env.example`.

Key variables:

- `PORT`
- `NODE_ENV`
- `DEV_MODE`
- `MONGODB_URI`
- `CORS_ALLOWED_ORIGINS`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET_NAME`
- `OPENAI_API_KEY`
- `CLICKUP_API_KEY`
- `FIREBASE_SERVICE_ACCOUNT_PATH`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

## Known Architectural Limitations

These are important for future AIs and maintainers because they affect safe change design.

1. There is no service layer between route handlers and persistence or integrations.
2. Validation is still route-local and incomplete.
3. Many write routes still use broad `req.body` updates rather than explicit field allowlists.
4. Error handling is mostly inline rather than centralized.
5. Sensitive schemas still contain plaintext credential fields in the current model design.
6. The activity route keeps an in-memory ClickUp member cache that can become stale.
7. The OpenAI route embeds scraping and AI orchestration in a single handler rather than a reusable workflow module.
8. Route protection is applied partly at mount time and partly inside route modules, so future changes should check both places.

## Maintenance Guidance

When changing this backend, use these rules:

1. Start from `server.js` to confirm how the route is mounted and whether auth or rate limiting is already applied there.
2. Check both the route file and the corresponding frontend caller before changing auth requirements.
3. For anything touching selections, inspect project, selection, and item flows together because the relationship is split across models and route logic.
4. For anything touching uploads or price estimation, treat the code as integration code with cost and abuse implications, not as ordinary CRUD.
5. If you add a new protected route, prefer Firebase bearer auth plus role checks rather than inventing a second auth system.
6. If you add a new resource, consider whether it should be a Mongoose reference, an embedded object, or a denormalized field; the current codebase uses all three styles in different places.

## Suggested Next Refactors

If the backend is going to keep evolving, these changes would improve maintainability the most:

1. add request validation and field allowlists for all write endpoints
2. extract service modules for ClickUp, uploads, and OpenAI orchestration
3. add centralized error-handling middleware
4. review and remove legacy plaintext credential storage from MongoDB schemas
5. standardize route authorization so it is easier to audit
6. document API contracts more formally, either in OpenAPI or per-route markdown
