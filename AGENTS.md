<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project context and working agreement

Outguess the Crowd is an AdSpark × Predikta event booth activation. Attendees predict which of two ads an audience prefers, play three timed rounds, receive a score/persona, and collect one of five prizes through a staff-operated wheel while inventory lasts. This is an event app; prioritize a working, clear experience and practical venue reliability.

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
| `/staff` | PIN-protected inventory editing, claim lookup/camera scanning, number confirmation, weighted prize wheel and fulfillment, lead lists, and CSV exports. |
| `/api/health` | Checks database connectivity and seeded event readiness. |

The implemented `/play` starting screen is a phone-only invitation with a static A-versus-B ad preview, compact “3 rounds · ~3 minutes” summary, current reward status, and an expandable top-three leaderboard. A bottom **Take the challenge** action bar stays visible while the content scrolls and opens the existing registration screen. The landing header hides the points badge and shows the event label; other game screens retain their points display. `src/components/game/PhoneLanding.tsx` renders this content using public content and the existing board supplied through the optional `landingBoard` game prop. The preview has no selectable controls, records no pick, and exposes no answers. Keep these styles scoped to `.phone-landing`; the TV starting screen was explicitly excluded from this change.

Important files and responsibilities:

- `src/components/game/Game.tsx`: shared phone/TV game flow. Phone sessions can resume from saved browser state; TV player state resets between attendees and after idle periods.
- `src/components/TvApp.tsx`, `PlayerApp.tsx`, and `StaffApp.tsx`: route-specific UI and access handling.
- `src/app/globals.css`: shared theme and responsive layouts.
- `src/app/api/[...path]/route.ts`: API routing, request checks, session cookies, and TV endpoint authorization.
- `src/server/service.ts`: authoritative game flow, registration, scoring, inventory awards, PIN throttling, sessions, fulfillment, and reporting.
- `src/server/auth.ts`, `db.ts`, `content.ts`, `seed.ts`, and `csv.ts`: signed tokens, database access, content/consent validation and import, and spreadsheet-safe exports.
- `src/shared/rules.ts`, `validation.ts`, and `types.ts`: shared rules, form validation, and contracts. Keep browser and server validation consistent.
- `scripts/migrate.ts`, `scripts/seed.ts`, and `migrations/`: database initialization and versioned migrations.
- `content/`: audience/ad definitions, simulated reactions, and approval input. The old GCash schedule is retained as historical input and no longer read during seeding.

## Game, rewards, and access rules

- Three rounds of 30 seconds. Confidence choices are Hunch, Pretty sure, and All in. Correct answers earn 100/150/200 points, wrong answers 20/20/0, and correct answers earn up to 30 speed-bonus points. Maximum score is 690; timeouts score zero. The server determines scores and round timing.
- One registration per normalized mobile number per event. Signup idempotency and retry-safe game/fulfillment operations prevent duplicate records and awards.
- PostgreSQL stores game state, immutable content versions, sessions, PIN throttling, claims, and reward inventory. Existing players retain the content version they started with.
- Completed games save their score immediately. New claim codes are issued after valid campaign answers, independently of score; previously issued codes remain usable without another questionnaire. Stock is not reserved at completion. The five prizes are PHP 150 GCash, Cellphone Holder, Tote Bag, Pencil Holder and Ballpen. Staff-set whole-event quantities replace the old 300 cap and timed releases; no daily reset occurs. New inventory starts at zero, and reseeding never restores quantities.
- Staff confirm the player's number and click Fulfill. A shared event lock serializes stock edits/draws; the server securely draws weighted by remaining units, deducts one unit and records the prize/time/staff session atomically. Repeated fulfillment returns the saved prize without redrawing. The wheel reveals the result with proportional colored segments; reduced motion skips animation. Prize handover and GCash payout remain manual; the app does not send money.
- Phone sessions last 30 days. TV and staff sessions last 12 hours and use the same `STAFF_PIN`, but separate cookies and signed token kinds. A TV token cannot access staff claims or exports.
- All `/api/tv/` data/game endpoints require a TV session, except login, logout, and session checking. Public registration cannot be used to register a TV player without TV access. Lock TV revokes the server session; expiry/revocation returns the screen to the PIN gate.
- Failed TV/staff PIN attempts share persistent throttling: five failures trigger a 15-minute lockout. PINs must be 4–12 digits.
- Both phone and TV registration require full name, PH mobile/business number, work email, company, role and game consent. Phone marketing opt-in stays optional and separate; TV marketing opt-in remains false. After results, **Claim my prize** opens **One last step** with required Industry, Biggest campaign challenge and Planning a campaign in the next 6 months questions, then **Continue to my prize** saves answers and opens the prize QR. Validate source before choosing marketing behavior; public phone registration cannot impersonate TV. Text limits, email syntax, PH mobile normalization, duplicate-mobile checks, accessible inline errors, and first-error focus are implemented. Phone/email ownership is not verified.
- Authenticated POST `/api/game/profile` and `/api/tv/game/profile` save campaign answers only after gameplay, validate shared fixed choices, and issue one retry-safe code in a player-locked transaction. `Me.profile` supplies saved answers and completion state. New claim retries require a complete profile; existing claim codes and fulfillment history are preserved, including old TV registrations with missing answers. Older clients can still supply valid answers at signup. Finished phone sessions without answers/code resume at results; saved answers/code skip the extra step. Existing nullable columns are reused, so this update needs no new migration or environment variables. Answers feed existing staff leads and CSV exports; stock changes only at staff fulfillment.
- The shared phone/TV mobile field in `src/components/game/MobileInput.tsx` prevents entry beyond the required length: 11 characters for `09…`, 12 for `639…`, 13 including the plus for `+639…`, and 10 for `9…`. Typing filters non-digits except a leading plus; formatted pastes remove separators before limiting length. These UI helpers are separate from server validation, which must reject excessive digits rather than truncate request data.
- Staff claim codes are six characters using the generated reward-code alphabet. Editing a code clears the previous lookup and confirmations. Overlapping staff actions are blocked.
- Public leaderboard names are shortened. Authenticated API responses and personal data must not enter service-worker caches. The TV worker caches static resources and its page shell; online access is still required for authentication and gameplay.

## Branding and UI decisions

- The user replaced the original light prototype palette with the supplied Predikta × AdSpark dark theme and nine screen references in `/Users/leandrozulaybar/Downloads/ops-restyle/`. Use deep navy/electric-blue gradient backgrounds, dotted texture, translucent blue cards, cyan highlights, violet confidence/persona cards, and magenta-to-violet-to-blue primary buttons. Outfit is self-hosted for headings/body; JetBrains Mono remains for scores/codes.
- `src/app/predikta-dark-theme.css` adapts the supplied stylesheet and is imported after `globals.css` in the root layout. Keep the base responsive layouts in `globals.css` and the theme loaded last. `--ink` now means white text: use dark surfaces/gradients rather than `--ink` as a background. The browser viewport theme color is `#071447` with dark native controls. Ad creatives retain their individual colors, and QR codes retain dark-on-white contrast.
- The shared phone/TV post-game industry field uses `src/components/game/IndustrySelect.tsx` so its open menu follows the navy/cyan theme instead of the browser's native popup colors. It provides a labeled select-only combobox, arrow/Home/End navigation, Enter/Space/Tab selection, Escape cancellation, type-ahead, outside-click dismissal, a scrollable menu that can open upward, and a hidden industry input for the existing FormData/API contract. Keep the visible trigger named `industry` before the hidden input so first-error focus finds the interactive control; selection clears the industry's inline error.
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

Production content activation still needs final AdSpark ad images, approved Predikta preference splits/reactions, and approved consent text/version in `content/approval.json`. Production seeding checks `approved` and `contentApproved`; schedule approval is retired. Staff must set actual whole-event prize quantities, and AdSpark must supply its privacy-policy URL. Remote deployment status remains unverified by the agent.

During the user's manual GCP deployment, the production seed stopped because `content/approval.json` was absent. The file now exists as an unapproved copy of `approval.example.json`; consent placeholders and false approval flags still require actual event inputs. All 18 current ad entries lack image paths, so creating this file alone does not make approved-content production seeding ready. The user reported a deployed page returning `service_unavailable`; remote deployment status has not been inspected.

The user explicitly authorized dummy/placeholder content for the initial deployment. The ignored `.env.production` now uses `DEMO_MODE=1`, which loads the existing ad illustrations/results and consent without requiring final image assets or asserting content approval. Cloud Run must also use `DEMO_MODE=1` to match this seed. Placeholder mode now creates the same zero-stock prize inventory as approved-content mode; it no longer allocates 100 daily rewards or enforces a 300 cap. No remote migration or seed has been executed by the agent. When moving to approved `DEMO_MODE=0` content, initialize a separate database as required by the seed's mode check; do not erase attendee data or merely flip the runtime flag. Continue to omit visible demo labels from the app.

The agreed implementation excludes a gallery, separate analytics display, Crowd Showdown, SMS OTP, Google Sheets sync, live Predikta requests, automatic wallet/payout integration, and cross-device recovery. Do not introduce these without a new user request.

The earlier `/play` upgrade used a visual-only ad preview. The user subsequently authorized TV prize messaging, a shorter signup, mixed prizes and a staff wheel; the former exclusion of TV landing changes no longer applies. Animated reveals, personal rank/scorecards, attendee-versus-Predikta comparisons, and a registration-to-completion dashboard remain proposals rather than implemented features or authorized follow-up work. Both signup screens now use five basic fields and consent, with three campaign questions after results as described above. Three-round gameplay retains its rules.

## Prize wheel implementation and deployment

- `migrations/002_prize_inventory.sql` adds the five-item catalog, per-event inventory, inventory revision, and claim prize/wheel snapshot fields. It preserves old GCash fields/tables and records; historical fulfilled claims stay fulfilled with unknown prize details and do not consume new stock. Pending claims use the new wheel. Nullable campaign columns support truthful TV registrations.
- `src/shared/prizes.ts` defines the fixed catalog/colors and PHP 30,000 promotional value. `Me.reward` and `Board.prizes` replace GCash-specific client data. Inventory reports per-prize total/fulfilled/remaining and remaining cash value. Staff GET/POST `/api/staff/inventory` uses revision checks and accepts all five whole-event totals. Existing staff claim endpoint returns the saved prize, replay flag and wheel snapshot. Prize details appear in CSV exports.
- `InventoryPanel` edits totals (including fulfilled units); it rejects negative/fractional values, totals below fulfilled counts, and stale revisions. `PrizeWheel` uses the server snapshot so its pointer reflects the saved result even when stock changes. Claims are first-come at fulfillment; exhausted types are excluded and all-zero stock returns `out_of_stock` without changing the claim.
- TV landing shows 3 rounds, 3 minutes, Win AdSpark Merch, a fixed yellow PHP 30,000 banner, remaining cash × PHP 150, and live counts for Cellphone Holder/Tote Bag/Pencil Holder. Ballpen is in staff inventory and the wheel. Both player routes use generic Claim my prize/QR messaging and show the saved prize after fulfillment.
- Runtime environment variables `ADSPARK_CONTACT_URL` (default official get-in-touch page) and optional `ADSPARK_PRIVACY_POLICY_URL` control links. Privacy remains hidden until supplied. Do not fabricate approvals or a policy URL. New placeholder consent version refers to prizes; existing recorded consent is preserved.
- Upgrading requires the additive migration and reseed through existing tooling, then a rebuilt image and a browser refresh. Set actual quantities in /staff afterward; no stock is auto-created from old schedules. No GCP access or deployment is performed by the agent.
- Verification for this change: five focused integration checks passed in an isolated temporary local schema (concurrent last-item fulfillment, repeat requests across instances, stock edits/restocking/reseed/day carry-over, historical claims, and five-field TV signup). Local migration 002 and placeholder reseed were applied without resetting players, claims or stock. Browser checks covered the TV landing, five-field signup errors/focus, staff quantity validation, a 390px staff layout without horizontal overflow, and an existing fulfilled phone player's preserved QR/history/contact link. Real prize handover/payout was not performed.
- Final checks passed: lint, production build including TypeScript, local `/api/health` (200), and rejection of public TV-source signup (401 `tv_required`). Local stock remains zero for staff to configure; browser review did not fulfill any real claim. Review staff/TV sessions were signed out/locked afterward. The local dev server uses port 3100; no Cloud Run deployment was made.

## Post-game campaign questions verification

Both phone and TV now start with five basic fields and consent, then collect Industry, campaign challenge and campaign planning after results and before issuing a new prize QR. Focused checks passed for short signup, results-before-answers, invalid choices, concurrent/repeated saves, saved answers in leads/exports, unchanged stock before fulfillment, and previously issued codes. Browser checks completed the TV game and questionnaire, verified first-error focus and partial-answer preservation, and checked the two-column TV layout plus 390px layout without horizontal overflow. A historical phone claim still opened directly. The temporary local browser-check player was removed without changing inventory; the TV review session was locked afterward. Lint, type checking and production build passed. No GCP actions were performed.
