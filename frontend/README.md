# PropelloCRM Frontend

Modern Next.js CRM interface for real estate operations teams.

## What This Frontend Delivers

- Dashboard visibility for pipeline and performance.
- Lead board and lead detail workspace.
- Contacts, tasks, visits, analytics, and settings pages.
- Real-time notification experience for activity updates.
- Smooth, premium UI optimized for practical usage.

## Tech

- Next.js 14 App Router
- React 18
- TanStack Query
- Zustand
- Tailwind CSS

## Architecture Overview

- app: Route-level pages and layouts.
- components: Shared and domain components.
- hooks: Query hooks and client behavior hooks.
- lib: API client, utility functions, shared types.
- store: Auth and local state slices.

## API Wiring

Frontend communicates exclusively with backend API origin through:

NEXT_PUBLIC_API_URL

Example:

NEXT_PUBLIC_API_URL=https://your-backend.onrender.com

## Local Development

1. Install dependencies.
2. Configure .env.local.
3. Run:

npm run dev

## Build and Release

- Build:

npm run build

- Start:

npm run start

Deploy on Vercel with frontend as root directory.

## UX and Product Highlights

- Pipeline-first navigation and role-aware visibility.
- Notification popups for data changes.
- Lead detail view designed for high-speed sales handling.
- Consistent visual system for enterprise-like usability.

## Recommended Future Frontend Additions

- Global command palette and keyboard shortcuts.
- Saved views and custom dashboard widgets.
- Notification filters and bulk action controls.
- Offline support and optimistic background sync patterns.
