# Frontend

This is the Vite React frontend for the Adimari project.

## Purpose

The frontend provides:

- item, brand, model, project, and selection management
- Firebase-based authentication and role-aware route protection
- Team status views backed by ClickUp and internal activity-log APIs
- upload flows that depend on the backend S3 and Rekognition routes

## Runtime Model

The frontend can be used in two ways:

1. Vite development server during frontend development
2. built static files served by the backend from `front-end/dist`

Many local-auth and CSP fixes assume the frontend talks to the backend on the same machine and, when possible, the same origin.

## Environment Variables

The frontend relies on these environment variables:

- `VITE_SERVER_URL`: primary backend base URL
- `VITE_API_URL`: optional compatibility base URL used by the Team movement log fallback path

Recommended local values:

```env
VITE_SERVER_URL=http://localhost:5001
VITE_API_URL=http://localhost:5001
```

## Local Development

Install dependencies:

```bash
npm install
```

Run the Vite dev server:

```bash
npm run dev
```

Build the production bundle:

```bash
npm run build
```

Preview the built bundle with Vite:

```bash
npm run preview
```

## Local Integration Notes

- Firebase Google sign-in depends on backend CSP headers and popup-compatible security headers.
- If you build the frontend and serve it through the backend, make sure the backend is running on `http://localhost:5001`.
- If API calls fail in the browser with CSP `connect-src` errors, check the built frontend environment values first.

## Related Documentation

- `TEAM_ARCHITECTURE.md` for the Team page flow
- `../Backend/ARCHITECTURE.md` for the server-side architecture and route behavior
