# Team Page Architecture

This document explains how the Team feature works in the frontend, which components are active, how data flows from page load to detail views, and which design constraints future maintainers should keep in mind.

## Overview

The current Team feature is served at `/team` and renders the `TeamStatus` page.

Primary purpose:

- show the current team roster
- show each member's current ClickUp task
- show recent ClickUp time entries per member
- open a movement-log modal for a selected member

The feature combines two backend data sources:

1. ClickUp proxy endpoints exposed by the main backend
2. activity-log endpoints exposed by `/api/activity`

## Route Entry

The Team page is mounted in `src/App.jsx`.

Current route:

- `/team` -> `ProtectedRoute` -> `TeamStatus`

This means the Team page is not directly public. A user must pass the app's normal route protection first.

Important detail:

- `ProtectedRoute` currently blocks users below moderator level, so only `admin` and `moderator` roles can reach `/team`
- `TeamStatus` itself repeats this authorization check and renders `Not authorized` if the user or role is missing

## Active Component Tree

The active Team feature uses this tree:

1. `App.jsx`
2. `ProtectedRoute.jsx`
3. `pages/TeamStatus.jsx`
4. `components/Team/Member.jsx`
5. `components/TeamLog.jsx`
6. `components/Team/MemberLog.jsx`
7. `components/Team/LogBar.jsx`

CSS involved:

- `src/CSS/TeamStatus.css`
- `src/CSS/Team-Log.css`
- `src/CSS/Other/MemberLog.css`
- `src/CSS/Other/LogBar.css`

## High-Level Flow

The Team page works in two parallel layers:

1. roster and current-task layer driven by `TeamStatus` and `Member`
2. movement-history modal driven by `TeamLog` and `MemberLog`

At runtime the flow is:

1. user navigates to `/team`
2. `ProtectedRoute` checks auth state and minimum role
3. `TeamStatus` loads team members from `/clickup/members`
4. the page renders one `Member` card per team member
5. each `Member` fetches:
   - current ClickUp task from `/clickup/current-task/:user_id`
   - time entries from `/clickup/time-entries/:user_id`
6. clicking a member card expands inline time-entry details
7. clicking `View Log` opens `TeamLog`
8. `TeamLog` renders `MemberLog`
9. `MemberLog` loads movement entries from `/api/activity/time-entries/:memberId`
10. `MemberLog` aggregates those entries into time buckets and renders the bar timeline

## TeamStatus Page

Source: `src/pages/TeamStatus.jsx`

Responsibilities:

- gate access based on `useAuth()`
- load the top-level list of ClickUp members
- hold the `shownLog` state for the modal
- render `Member` cards and conditionally render `TeamLog`

State owned here:

- `teamMembers`
- `shownLog`

Data source:

- `GET ${VITE_SERVER_URL}/clickup/members`

Auth behavior:

- reads `user` and `role` from `AuthContext`
- gets a Firebase ID token with `user.getIdToken()`
- sends the token as a bearer header

Important detail:

- `teamMembers` is initialized as an array, but the response shape used later is an object with a `members` array
- the component uses `teamMembers.length === 0` as a loading condition, then later renders `teamMembers.members.map(...)`
- this works only because the initial load path replaces the array with the ClickUp response object before render continues

That shape mismatch is a maintenance hazard.

## Member Card Flow

Source: `src/components/Team/Member.jsx`

Each rendered member card owns its own live detail fetching.

Responsibilities:

- fetch the member's current ClickUp task
- fetch the member's recent ClickUp time entries
- refresh those two datasets every 60 seconds
- show a summary card with current task data
- expand into a detailed timeline of ClickUp entries
- trigger the modal log view through `handleShowLog(member)`

State owned per card:

- `showDetails`
- `currentTask`
- `timeEntries`
- `number`

Data sources:

- `GET /clickup/current-task/:member.id`
- `GET /clickup/time-entries/:member.id`

Important UI behavior:

- clicking the card toggles `showDetails`
- clicking `View Log` stops propagation and opens the separate modal log instead of toggling the card
- time entries are grouped visually by local day
- the component inserts synthetic `No Task` gaps when the gap between two entries is larger than 15 minutes on the same day

Computed values inside the component:

- formatted local timestamps
- formatted durations
- day totals derived from raw time entries

Important implementation detail:

- polling is implemented by storing a `number` state and recreating an interval whenever `number` changes
- this works, but it causes an interval lifecycle on every tick rather than using one stable interval

## TeamLog Modal Flow

Source: `src/components/TeamLog.jsx`

Responsibilities:

- display a modal-like wrapper for the selected member
- show a close button
- render `MemberLog` for the selected member id

This component is intentionally thin. It does not fetch data itself.

It simply passes:

- `member.id` as `memberId`
- `600000` as `incrementMs`

That means the movement bars are grouped into 10-minute buckets in the Team modal.

## MemberLog Timeline Flow

Source: `src/components/Team/MemberLog.jsx`

Responsibilities:

- fetch movement entries from `/api/activity/time-entries/:memberId`
- transform timestamped movement data into fixed-width timeline buckets
- group those buckets by day
- render a vertical bar for each bucket using `LogBar`

Data source resolution:

- first tries `VITE_SERVER_URL`
- tries `REACT_APP_API_URL`
- then `VITE_API_URL`
- then falls back to the current origin

This component was adjusted to prefer the same backend base URL as the rest of the app so local auth and CSP behavior remain consistent.

### Fetch Stage

`MemberLog` fetches once on mount or when `memberId` changes.

Response entries are normalized into:

- original fields
- `epoch`, derived from `timestamp`
- `movement`, defaulting to `0`

The fetch is abort-safe via `AbortController`.

### Aggregation Stage

Heavy aggregation is delegated to `buildBars(...)` and memoized with `useMemo`.

Inputs:

- raw movement entries
- `incrementMs`
- `frames`

Default behavior:

- bucket size defaults to 1 hour
- frame count defaults to `2500`
- TeamLog overrides the bucket size to 10 minutes

Aggregation algorithm:

1. sort entries newest to oldest
2. walk backward from `Date.now()` in fixed time slices
3. sum all movement values that fall inside each slice
4. record the max total for scaling
5. group the slices by local date
6. reverse bars within each date group so they render earliest to latest

Render output:

- one day group per date
- one `VerticalBar` per time bucket
- a label only when the hour changes from the previous bar
- hover details showing the bucket time

## LogBar Component

Source: `src/components/Team/LogBar.jsx`

Responsibilities:

- render one visual bar
- scale fill from `0` to `1`
- show tooltip-like details on hover

This is purely presentational and does not know anything about the Team domain.

## Data Dependencies

The current Team page depends on several frontend-wide systems.

### AuthContext

`TeamStatus` and `Member` depend on `useAuth()`.

They assume:

- there is a logged-in Firebase user
- that user can produce an ID token
- the backend role embedded in Firebase custom claims is already available

### Environment Variables

The Team feature now expects one backend base URL first and keeps a compatibility fallback chain:

- `VITE_SERVER_URL` is the primary backend URL for `TeamStatus`, `Member`, and now `MemberLog`
- `VITE_API_URL` remains as a secondary compatibility fallback for `MemberLog`

For local testing, both values can point at `http://localhost:5001`.

### Backend Contracts

The frontend assumes these response shapes:

- `/clickup/members` returns an object with `members`
- `/clickup/current-task/:id` returns an object with `data`, and if present `data.task`, `data.task_url`, `data.at`, `data.start`
- `/clickup/time-entries/:id` returns an object with `data` containing entry objects
- `/api/activity/time-entries/:id` returns an array of activity log entries with `timestamp` and `movement`

## UI Interaction Flow

The user-visible interactions are:

1. open Team page
2. wait for member cards to load
3. inspect current task on each card
4. click a card to expand ClickUp time-entry details
5. click `View Log` to open the movement-log modal
6. inspect the 10-minute movement timeline
7. close the modal and return to the roster

The expanded card view and modal view are deliberately separate:

- expanded card shows ClickUp time tracking
- modal shows internal movement activity logs

## Architectural Strengths

The current Team implementation does a few things well:

1. it separates roster display from heavy movement-log rendering
2. `MemberLog` isolates the expensive aggregation logic behind `useMemo`
3. the modal wrapper keeps the log viewer reusable
4. the ClickUp endpoints are now accessed through authenticated backend proxies rather than direct frontend API keys

## Known Limitations

These are the main issues a future maintainer should know before changing the Team feature.

1. `TeamStatus` stores `teamMembers` with an inconsistent initial type.
2. `Member` performs per-card polling, which means the page issues multiple parallel requests every minute as the team grows.
3. interval management in `Member` is functional but not especially clean.
4. there is no shared Team-specific data layer or hook; each component fetches directly.
5. error states are mostly logged to the console rather than rendered in a structured way.

## Recommended Mental Model For Changes

When changing the Team page, treat it as three separate but connected systems:

1. access control and roster loading in `TeamStatus`
2. live ClickUp detail polling in `Member`
3. activity-log visualization in `MemberLog`

If a bug appears in one part, start there rather than assuming the whole page is broken.

Examples:

- if cards load but the modal is empty, check `MemberLog` and `/api/activity`
- if the page says `Not authorized`, check `ProtectedRoute`, `AuthContext`, and Firebase role claims
- if current tasks are missing but members load, check `/clickup/current-task/:id`

## Suggested Refactors

If this feature keeps evolving, the highest-value refactors are:

1. create a dedicated Team data hook so page and card fetch logic are easier to reason about
2. replace per-card polling with a page-level polling strategy or batched backend endpoint
3. normalize the `teamMembers` state shape in `TeamStatus`
4. surface explicit loading and error states for member-level fetch failures
