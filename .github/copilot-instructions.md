## Purpose

Quick, actionable guidance for AI coding agents working on this repository. Focuses on the real patterns and files an agent should read or modify first.

## Key entrypoints
- `src/index.ts` — single, canonical server file. Hosts all HTTP routes used by the project (signup, login, add-subscriber, send-email, waitlist, leaderboard, etc.). The file is written for Vercel-friendly serverless deployment but also runs locally when `NODE_ENV !== 'production'`.
- `prisma/schema.prisma` — database models (Admin, Email, Waitlist, Wallpaper). Prisma client is generated into `src/generated/prisma` and imported in `src/index.ts` as `../src/generated/prisma`.
- `package.json` — scripts you must respect: `dev` uses `ts-node src/index.ts`, `build` runs `tsc`, `postinstall` runs `prisma generate` (so `npm install` will generate the client).
- `vercel.json` — Vercel build/routes configuration. Production runtime expects the file-based function at `src/index.ts`.
- `src/zeptomail.d.ts` — ambient types for the zeptomail client used elsewhere; keep this when touching email-related code.

## Environment variables (discoverable from code)
- `DATABASE_URL` — Prisma production DB connection
- `DIRECT_URL` — Prisma direct URL used by the datasource
- `RESEND_API_KEY` — required by the Resend client used to send emails
- `NODE_ENV` — controls Prisma singleton behavior and server listen logic
- `PORT` — optional for local runs

If you add or change env names, update both `src/index.ts` and any deployment config (e.g., Vercel environment settings).

## How the server is run locally and in prod
- Local development: `npm run dev` (runs `ts-node src/index.ts`). The server will print `Server is running on http://localhost:<PORT>` when `NODE_ENV !== 'production'`.
- Build (for production bundling): `npm run build` (runs `tsc`). The built artifact expected at `dist/index.js` (used by `npm start`).
- Installing dependencies: `npm install` triggers `postinstall` which runs `prisma generate` to create the client in `src/generated/prisma`.

## Database & Prisma notes
- Prisma generator output is set to `../src/generated/prisma` in `schema.prisma`. Do not change imports without also updating the generator output or import paths.
- Migrations are present under `prisma/migrations/*`. Use the repository's existing migration files when syncing schema.
- The code uses a development singleton pattern for Prisma to avoid multiple connections in hot-reload: a global `prisma` is created when `NODE_ENV !== 'production'`. Preserve this pattern when refactoring server startup.

## Email sending (concrete example)
- The project uses Resend in `src/index.ts`: calls `resend.emails.send({ from, to, subject, html })` inside the local helper `sendEmail(subject, content, email)`.
- There are also zeptomail types declared in `src/zeptomail.d.ts`, but the runtime code currently uses Resend. Prefer Resend when modifying sending logic unless you intentionally swap providers.
- Important behavior: when sending the main newsletter, the code does:
  - `const emailList = await prisma.email.findMany({ select: { email: true } })`
  - `emailList.forEach(async (subscriber) => { await sendEmail(...) })`
  This runs many concurrent async calls without waiting for them. Be cautious when changing to `Promise.all` or adding rate-limiting — it's an intentional pattern currently present in the code.

## Data flows and routes (concrete examples agents should inspect)
- POST `/add-subscriber` — inserts or updates `Email` records; honors `fillLater` and `interestedInJobs` flags. See `src/index.ts` for the exact conditional branches.
- POST `/send-email` — validates admin, increments `admin.emailSent`, then retrieves `email` rows and calls `sendEmail` for each subscriber.
- POST `/add-to-waitlist` and GET `/leaderboard` — use the `Waitlist` model and ordering by `totalVotes`.

## Coding conventions & gotchas
- Single-file server: most logic is in `src/index.ts`. When adding routes, append to this file or extract routes carefully and keep the server start behavior (server listens only when not production).
- Keep Prisma client import path and the global-singleton pattern for development to avoid connection exhaustion.
- Content-Security-Policy header is applied in middleware and duplicated in `vercel.json` routes; if you modify headers, update both places.
- TypeScript ambient types: `zeptomail.d.ts` exists so TypeScript won't error for zeptomail imports. Keep it present if you touch email-related code.

## Small examples (copyable JSON payloads agents may use while testing locally)
- Add subscriber (minimal):

  { "email": "user@example.com", "fillLater": true }

- Send test email (admin must exist):

  { "userId": "<admin-id>", "subject": "hi", "content": "<html>...</html>" }

## What to preserve when editing
- Prisma singleton pattern and the `NODE_ENV` conditional server start.
- The `src/generated/prisma` client output path or keep imports in sync.
- The CSP header in middleware and `vercel.json`.

## Where to look next (priority)
1. `src/index.ts` — full behavior and routes
2. `prisma/schema.prisma` and `prisma/migrations` — DB shape and historical migrations
3. `package.json` — dev/build scripts, `postinstall` hooks
4. `vercel.json` — production routing and headers

If anything you need here is missing or unclear (for example: environment variable values, secrets management, or desired concurrency behavior when sending emails), tell me which area to expand and I will iterate on this file.
