<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project context and working agreement

Outguess the Crowd is an AdSpark × Predikta event booth activation. Attendees predict which of two ads an audience prefers, play three timed rounds, receive a score/persona, and collect a reward through booth staff while inventory lasts. This is an event app; prioritize a working, clear experience and practical venue reliability.

Reference materials supplied by the user:

- PRD: `/Users/leandrozulaybar/Downloads/[Ext]AdSpark x Predikta Booth Activation.docx`.
- Prototype: `/Users/leandrozulaybar/Downloads/outguess the crowd`.
- `README.md` describes setup, rules, content import, and deployment. This file records current implementation context and user decisions.

Keep this file updated after meaningful changes to app behavior, scope, deployment choices, or remaining setup work. Distinguish implemented features from proposals and pending event inputs. Preserve the generated Next.js instructions above.

## Current implementation

The app uses Next.js 16 App Router, React 19, TypeScript, and PostgreSQL through `pg`. Node.js 24+ is required. The Dockerfile packages Next.js standalone output. The user is manually deploying to Cloud Run with Cloud SQL PostgreSQL and reported a deployed page returning 503 during database initialization; the agent has not inspected GCP.

| Route | Current behavior |
| --- | --- |
| `/play` | Public phone game: registration, instructions, audience choice, rounds, reveals, results, and reward screen. |
| `/tv` | PIN-protected touchscreen version of the same game, join QR, live top-10 leaderboard, crowd statistics, reward inventory, and Lock TV control. |
| `/staff` | PIN-protected dashboard, reward lookup/camera scanning, number and payout confirmations, manual fulfillment recording, lead lists, and CSV exports. |
| `/api/health` | Checks database connectivity and seeded event readiness. |

The implemented `/play` starting screen is a phone-only invitation with a static A-versus-B ad preview, compact “3 rounds · ~3 minutes” summary, current reward status, and an expandable top-three leaderboard. A bottom **Take the challenge** action bar stays visible while the content scrolls and opens the existing registration screen. The landing header hides the points badge and shows the event label; other game screens retain their points display. `src/components/game/PhoneLanding.tsx` renders this content using public content and the existing board supplied through the optional `landingBoard` game prop. The preview has no selectable controls, records no pick, and exposes no answers. Keep these styles scoped to `.phone-landing`; the TV starting screen was explicitly excluded from this change.

Important files and responsibilities:

- `src/components/game/Game.tsx`: shared phone/TV game flow. Phone sessions can resume from saved browser state; TV player state resets between attendees and after idle periods.
- `src/components/TvApp.tsx`, `PlayerApp.tsx`, and `StaffApp.tsx`: route-specific UI and access handling.
- `src/app/globals.css`: shared theme and responsive layouts.
- `src/app/api/[...path]/route.ts`: API routing, request checks, session cookies, and TV endpoint authorization.
- `src/server/service.ts`: authoritative game flow, registration, scoring, inventory awards, PIN throttling, sessions, fulfillment, and reporting.
- `src/server/auth.ts`, `db.ts`, `content.ts`, `seed.ts`, and `csv.ts`: signed tokens, database access, content/schedule validation and import, and spreadsheet-safe exports.
- `src/shared/rules.ts`, `validation.ts`, and `types.ts`: shared rules, form validation, and contracts. Keep browser and server validation consistent.
- `scripts/migrate.ts`, `scripts/seed.ts`, and `migrations/`: database initialization and versioned migrations.
- `content/`: audience/ad definitions, simulated reactions, reward schedule, and approval input.

## Game, rewards, and access rules

- Three rounds of 30 seconds. Confidence choices are Hunch, Pretty sure, and All in. Correct answers earn 100/150/200 points, wrong answers 20/20/0, and correct answers earn up to 30 speed-bonus points. Maximum score is 690; timeouts score zero. The server determines scores and round timing.
- One registration per normalized mobile number per event. Signup idempotency and retry-safe game/fulfillment operations prevent duplicate records and awards.
- PostgreSQL stores game state, immutable content versions, sessions, PIN throttling, claims, and reward inventory. Existing players retain the content version they started with.
- Reward allocation is independent of score, uses scheduled releases, and is capped at 300 for the event. Reservation happens at completion while released inventory is available; waiting players can check again after a release.
- GCash fulfillment is manual. Staff confirm the player's number and that the payout was arranged before recording fulfillment. The app does not send money.
- Phone sessions last 30 days. TV and staff sessions last 12 hours and use the same `STAFF_PIN`, but separate cookies and signed token kinds. A TV token cannot access staff claims or exports.
- All `/api/tv/` data/game endpoints require a TV session, except login, logout, and session checking. Public registration cannot be used to register a TV player without TV access. Lock TV revokes the server session; expiry/revocation returns the screen to the PIN gate.
- Failed TV/staff PIN attempts share persistent throttling: five failures trigger a 15-minute lockout. PINs must be 4–12 digits.
- Registration requires name, PH mobile, email, company, role, industry, challenge, planning answer, and game consent. Marketing opt-in is optional and separate. Text limits, email syntax, PH mobile normalization, duplicate-mobile checks, accessible inline errors, and first-error focus are implemented. Phone/email ownership is not verified.
- The shared phone/TV mobile field in `src/components/game/MobileInput.tsx` prevents entry beyond the required length: 11 characters for `09…`, 12 for `639…`, 13 including the plus for `+639…`, and 10 for `9…`. Typing filters non-digits except a leading plus; formatted pastes remove separators before limiting length. These UI helpers are separate from server validation, which must reject excessive digits rather than truncate request data.
- Staff claim codes are six characters using the generated reward-code alphabet. Editing a code clears the previous lookup and confirmations. Overlapping staff actions are blocked.
- Public leaderboard names are shortened. Authenticated API responses and personal data must not enter service-worker caches. The TV worker caches static resources and its page shell; online access is still required for authentication and gameplay.

## Branding and UI decisions

- The user replaced the original light prototype palette with the supplied Predikta × AdSpark dark theme and nine screen references in `/Users/leandrozulaybar/Downloads/ops-restyle/`. Use deep navy/electric-blue gradient backgrounds, dotted texture, translucent blue cards, cyan highlights, violet confidence/persona cards, and magenta-to-violet-to-blue primary buttons. Outfit is self-hosted for headings/body; JetBrains Mono remains for scores/codes.
- `src/app/predikta-dark-theme.css` adapts the supplied stylesheet and is imported after `globals.css` in the root layout. Keep the base responsive layouts in `globals.css` and the theme loaded last. `--ink` now means white text: use dark surfaces/gradients rather than `--ink` as a background. The browser viewport theme color is `#071447` with dark native controls. Ad creatives retain their individual colors, and QR codes retain dark-on-white contrast.
- The shared phone/TV registration industry field uses `src/components/game/IndustrySelect.tsx` so its open menu follows the navy/cyan theme instead of the browser's native popup colors. It provides a labeled select-only combobox, arrow/Home/End navigation, Enter/Space/Tab selection, Escape cancellation, type-ahead, outside-click dismissal, a scrollable menu that can open upward, and a hidden industry input for the existing FormData/API contract. Keep the visible trigger named `industry` before the hidden input so first-error focus finds the interactive control; selection clears the industry's inline error.
- Use the official AdSpark and Predikta image assets in `public/brand/` through the shared Brand component. Preserve logo colors, proportions, and legibility; do not replace them with generic icons or invented wordmarks. Source links are in `README.md`.
- Do not display any mention of a demo in the app. Visible banners, labels, and sample autofill were removed. The existing `DEMO_MODE` environment flag remains an internal configuration setting.
- Preserve phone, tablet, desktop, and landscape-TV responsiveness. Phones show the TV game before the rail; staff leads become cards on narrow screens. Large landscape TVs use the dedicated proportional layout. Keep inputs, validation errors, touch targets, scrolling, and modals usable at small widths/heights.
- Recent usability work improved button/text contrast, validation focus below sticky headers, modal scrolling, and screen transitions that return to the top.

## Reliability and verification

Recent fixes cover strict client/server signup validation, inline error feedback, disabled duplicate actions, corrupted saved-state recovery, stale-request guards, serialized polling, staff claim reset behavior, and TV PIN access.

Focused checks after the audit and TV gate covered invalid registration in the browser/API, staff authorization, claim-code validation, saved-state recovery, TV PIN failures/unlock/refresh/lock/revocation, TV/staff token isolation, public phone access, and mobile layout. Lint and the production build passed at that point; this is historical verification, not a guarantee for later edits.

After applying the dark theme, lint and the production build passed. Local HTTP checks confirmed `/play`, `/tv`, and `/staff` load the theme after the base CSS, expose the navy browser theme color, and serve Outfit and both logos successfully. Compiled CSS retains the white QR background. A browser surface was unavailable in this session, so visual comparison against the references remains unverified.

After replacing the industry select, lint and the production build passed. Focused server-render checks verified empty/preselected industry values, the submitted hidden input, and validation/disabled attributes. Browser interaction checks remain unverified because no browser surface is available.

The user explicitly requested no rigorous unit or end-to-end testing for this event. Use focused manual/browser/API checks for affected behavior and run lint, type checking, or a production build when appropriate. Existing unit/integration/e2e files do not make the full suites a required workflow. Do not add extensive test infrastructure or run broad suites by default. Documentation-only edits do not require an app build.

## Local setup and deployment preference

Local commands are `npm ci`, `docker compose up -d db`, `npm run db:migrate`, `npm run db:seed`, and `npm run dev`, with `.env.local` copied from `.env.example` when setting up a fresh environment. The app uses port 3100; the dedicated local PostgreSQL container uses port 5434. Do not overwrite an existing environment file or reset its database during routine work.

Use runtime environment variables for deployment, including `DB_PASSWORD`, `SESSION_SECRET`, and `STAFF_PIN`. Google Secret Manager is deferred by the user's explicit choice; do not require it, provision it, or add Secret Manager dependencies or IAM permissions.

- Set actual values in the hosting platform's environment configuration or ignored local `.env` files. Committed documentation/templates use placeholders.
- `PUBLIC_URL` must match the browser's canonical origin because it controls the join QR and mutation-origin checks. Production requires HTTPS, a session secret of at least 32 characters, and a private PIN; local example credentials are rejected in production.
- Cloud SQL runtime connectivity uses `INSTANCE_CONNECTION_NAME`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`; omit the local `DATABASE_URL`. The Cloud SQL Client role remains relevant to this connection method. Migration/seed tooling can use a production `DATABASE_URL` through the Cloud SQL Auth Proxy.
- Initialize schema and approved event data before serving production traffic. The runtime container does not automatically migrate or seed. Add migrations rather than editing an applied migration, and preserve registrations/claims when re-seeding.
- `deploy/cloudrun.yaml` now uses plain environment-value placeholders for credentials. `README.md` and `.env.example` reflect this choice; no Secret Manager wiring is required. The user will deploy manually through the Google Cloud console, with Terminal commands for image building/upload and database initialization.
- For the first deployment without a known canonical URL, temporarily use `https://example.invalid` while the Cloud Run service requires authentication. Replace `PUBLIC_URL` with the assigned HTTPS origin and deploy that revision before making the service public. Production initialization should explicitly load an ignored `.env.production` file rather than the local scripts' automatic `.env.local` loading.

## Remaining event setup and scope

Production activation is pending final AdSpark ad images, approved Predikta preference splits/reactions, confirmed event dates and allocations in `content/gc-schedule.json`, and approved consent text/version in `content/approval.json`. The current schedule is a placeholder; do not treat its dates as confirmed. Approval flags must reflect actual approvals, and final ad image paths must exist before production seeding. A public HTTPS deployment and final QR URL are also pending.

During the user's manual GCP deployment, the production seed stopped because `content/approval.json` was absent. The file now exists as an unapproved copy of `approval.example.json`; consent placeholders and false approval flags still require actual event inputs. All 18 current ad entries lack image paths, so creating this file alone does not make production seeding ready. The user reported a deployed page returning `service_unavailable`; remote deployment status has not been inspected.

The user explicitly authorized dummy/placeholder content for the initial deployment. The ignored `.env.production` now uses `DEMO_MODE=1`, which loads the existing ad illustrations/results and consent without requiring final image assets or asserting content approval. Cloud Run must also use `DEMO_MODE=1` to match this seed. This mode allocates 100 rewards on the Manila date when seeded, with an event cap of 300; it does not use the pending event schedule. No remote migration or seed has been executed by the agent. When moving to approved `DEMO_MODE=0` content, initialize a separate database as required by the seed's mode check; do not erase attendee data or merely flip the runtime flag. Continue to omit visible demo labels from the app.

The agreed implementation excludes a gallery, separate analytics display, Crowd Showdown, SMS OTP, Google Sheets sync, live Predikta requests, automatic wallet/payout integration, and cross-device recovery. Do not introduce these without a new user request.

The user narrowed the engagement upgrade to the `/play` starting screen and selected a visual-only ad preview. TV invitation changes were explicitly excluded. Animated reveals, personal rank/scorecards, attendee-versus-Predikta comparisons, and a registration-to-completion dashboard remain proposals rather than implemented features or authorized follow-up work. Registration requirements and the later game flow have not been shortened.
