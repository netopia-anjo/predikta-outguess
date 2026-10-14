# Outguess the Crowd

The AdSpark × Predikta booth game, rebuilt in Next.js with PostgreSQL. Players predict which of two ads an audience prefers across three timed rounds. The TV runs the same game with a live leaderboard, and the staff desk records manual reward fulfillment and exports leads.

The phone, TV, and staff screens use the supplied Predikta × AdSpark dark theme: navy/blue gradient backgrounds, translucent cards, cyan highlights, magenta/violet/blue buttons, and self-hosted Outfit typography. `src/app/predikta-dark-theme.css` loads after `globals.css` in the root layout; keep that order when editing styles. Ad artwork retains its own colors and QR codes stay dark on white.

| Route | Purpose |
| --- | --- |
| `/play` | Phone game, joined through the TV QR |
| `/tv` | PIN-protected landscape touchscreen game and live board |
| `/staff` | PIN-protected claims, leads and CSV exports |
| `/api/health` | Database and seeded-event readiness |

The phone starting screen shows a static A-versus-B preview, a compact three-round/time summary, current mixed-prize availability, and an expandable top-three leaderboard. Its **Take the challenge** button stays visible while the landing content scrolls; it opens the existing registration form. The preview uses the first audience's first public ad pair and does not record a pick or expose an answer. The points badge appears after leaving the landing screen. The TV promotes AdSpark merchandise, shows remaining stock and cash value, and uses the five-field registration shared with phone play.

## Local setup

Requires Node.js 24+ and Docker. The app uses port 3100 and a dedicated PostgreSQL container on port 5434.

```sh
npm ci
cp .env.example .env.local
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3100/play`, `/tv`, or `/staff`. The example staff PIN is `4321`; it is for local testing. `DEMO_MODE=1` loads placeholder ads/results and consent. Each day starts with the supplied 155-prize allocation: open `/staff` to verify quantities and the active day before booth play. Use separate databases for demo and production.

`PUBLIC_URL` must match the browser origin; the join QR and mutation-origin checks use it. For phones on the same Wi-Fi, use your computer's LAN URL in `PUBLIC_URL` and restart the server. Camera scanning requires HTTPS or localhost; manual claim-code entry remains available.

## Game and reward behavior

- Three rounds, 30 seconds each. Correct Hunch/Pretty sure/All in picks earn 100/150/200 points; wrong picks earn 20/20/0. Correct picks also earn one point per whole second remaining, up to 30. Maximum score: 690.
- Servers calculate scores. Client timing may reduce server elapsed time by at most three seconds; submissions received more than 15 seconds after the timer ends become timeouts. With no pick, a timeout earns zero points.
- Registration is retry-safe with an `Idempotency-Key`; mobile numbers are unique per event. Start, lock, finish, award retries and fulfillment are safe to repeat. Phone sessions last 30 days; staff and TV sessions last 12 hours.
- Accuracy and average confidence determine the four personas. Timeouts are excluded from average confidence. Leaderboard ties use total round time, then completion time.
- Every completed game saves its score immediately. New players answer three campaign questions after tapping **Get a chance to win a prize**, then receive a six-character claim code independently of score. Previously issued codes remain usable without another questionnaire. Codes do not reserve stock. The staff prize wheel uses separate Day 1 and Day 2 inventories, selected manually by staff. There are no timed releases or automatic resets. One play and one draw per number still apply across the event.
- Staff scan or enter a code, confirm the business number, and click **Fulfill**. The server has a fixed 15% “Thank you for playing” outcome. Otherwise it selects a prize weighted by remaining daily units and deducts one item. The result is recorded in one transaction; the wheel reveals that saved result. No-prize draws deduct nothing, are terminal, and are reported separately from wins. Repeated requests return the original outcome without another spin or deduction. GCash payout and merchandise handover are manual; the app does not send money. Player screens poll fulfillment status.
- The board polls every three seconds; staff data and claim status every five. Public leaderboard names are shortened. Staff data and authenticated API responses are never cached by the service worker.
- Marketing opt-in is separate from game consent. Consent text, version and time are recorded with each registration. CSV exports include opt-in and consent information and guard against spreadsheet formulas.

## Registration validation

Client and server enforce the same registration rules. Both phone and TV registration require full name, mobile/business number (PH mobile), work email, company, role and game consent. Phone marketing opt-in stays optional; TV marketing opt-in remains false. Industry, biggest campaign challenge and campaign planning are required after gameplay, between results and the draw QR. The final button is **Get my draw QR**. The **One last step** screen submits through authenticated `POST /api/game/profile` (or `/api/tv/game/profile` with TV access), validates the existing answer choices, and saves them against the current player. Repeated saves return the same claim code. Missing campaign answers block new code issuance, including claim retries; existing codes are honored. Valid answers supplied by older registration clients are retained and need not be entered again. Until answered, campaign fields remain NULL. The revised flow reuses existing columns and needs no new migration or environment variables. Names, company and role are limited to 120 characters and email to 254. The mobile field accepts digits and an optional leading `+`, limiting entry to 11 characters for `09…`, 12 for `639…`, 13 for `+639…`, or 10 for `9…`. Formatted pastes have separators removed before applying that limit. The API accepts up to 24 raw phone characters for formatting but rejects invalid or excessive digits rather than shortening them. Oversized or non-text registration values are rejected. PH numbers normalize to the same 11-digit number for duplicate checks. Email syntax is validated; phone ownership and email delivery are not verified.

Inline errors identify the affected fields and focus the first invalid field. Staff PINs require 4–12 digits; claim codes use the reward code alphabet. Editing a claim code clears the old lookup and confirmations, and overlapping staff actions are blocked. Production configuration rejects the local example session secret and staff PIN.

The TV requires the same `STAFF_PIN` before showing the booth screen. Unlock it once on the TV browser; its HTTP-only session survives refreshes for 12 hours. The TV session is separate from staff access and cannot authorize claims or exports. TV data and game endpoints require this session, and failed PIN attempts share the staff lockout. Use **Lock TV** when leaving the booth unattended; locking revokes the session on the server. Phone play at `/play` remains public.

## Content and event setup

`content/audiences.json` holds three audiences with three rounds each. Each ad can specify `image: "/content/ads/filename.webp"`; place the asset in `public/content/ads/`. Keep assets optimized and use a new filename when changing an image. `content/respondents.json` labels the simulated reactions.

The supplied creatives, preference splits and reactions are placeholders. To activate production:

1. Supply the final AdSpark images and approved Predikta results.
2. Fill `content/approval.json` from its example with approved consent text/version and set `approved` and `contentApproved` only after approval. The old `scheduleConfirmed` flag and `content/gc-schedule.json` are no longer used for prize seeding.
3. Set `DEMO_MODE=0`, a matching HTTPS `PUBLIC_URL`, a random `SESSION_SECRET` of at least 32 characters, and a private staff PIN.
4. Run migrations and seed against the production database before starting the production service.
5. Configure actual prize quantities in `/staff` and the AdSpark links described below.

Seeding imports immutable content versions and updates the active version. Existing games retain their original content. Re-seeding preserves players, claims, prize quantities and fulfillment counters. Migrations `002_prize_inventory.sql` and `003_daily_prizes.sql` retain historical GCash/whole-event inventory and claims; old fulfilled claims remain fulfilled without consuming new daily stock, and pending claims use the active day’s wheel. Migration 003 initializes the supplied daily quantities once for existing events; new-event seeding inserts missing daily rows only. Do not revise an applied migration; add a new migration instead.

## Staff prize setup

Open `/staff`, sign in, then choose **Daily prize inventory**. Day buttons change which stock you view; **Activate Day 1/2** explicitly changes the day used by new draws. The active-day badge stays visible. Editing an inactive day does not activate it. Unused Day 1 stock stays on Day 1 when staff activates Day 2; the calendar never switches or restores stock automatically.

| Prize | Day 1 | Day 2 |
| --- | ---: | ---: |
| Tote Bag — Rope | 30 | 30 |
| Pen & Notebook | 24 | 24 |
| Tote Bag — New | 15 | 15 |
| MagSafe Wallet | 25 | 25 |
| Pouch | 25 | 25 |
| Digicon × Predikta Package, worth PHP 75,000 | 5 | 5 |
| PHP 100 GCash | 15 | 15 |
| PHP 500 GCash | 10 | 10 |
| PHP 1,000 GCash | 3 | 3 |
| PHP 2,000 GCash | 3 | 3 |
| **Total prizes** | **155** | **155** |

Totals include prizes already issued; increase a total to restock. Negative/fractional quantities, totals below issued counts and stale revisions are rejected. Inventory edits, day activation and draws share the event lock. A draw submitted for a day that just changed is rejected before recording an outcome; review the active day and try again. Already resolved codes return their original outcome even after switching days. Earlier codes that have not been drawn use the day active when staff clicks Fulfill.

The yellow TV cash banner shows the active day’s remaining GCash value (PHP 15,500 initially per day). Package value is separate from cash payouts: ten packages across both days are worth PHP 750,000. The package banner uses configured totals, so it does not decrease after wins; staff adjustments to package quantities update the advertised pool. Merchandise and package counts show active-day stock. A permanent 15% no-prize wheel segment remains as other prizes deplete; the remaining segments share 85% weighted by remaining units. With no prizes left, new spins are blocked until staff restocks or activates another day; games and draw codes still work.

Player and staff screens distinguish pending, prize, no-prize and historical results. For compatibility, `claimed_at` is the terminal staff-draw timestamp for new outcomes; no-prize rows have `draw_outcome=no_prize` and no `prize_id`. Reports exclude them from prize fulfillment counts. CSV exports include outcome, draw timestamp, prize day, cash payout amount and separate package value. The old catalog/inventory remains archived and is not silently mapped into the supplied daily allocations.

`ADSPARK_CONTACT_URL` defaults to `https://www.adspark.ph/get-in-touch`. `ADSPARK_PRIVACY_POLICY_URL` defaults to the supplied `https://www.adspark.ph/privacy-policy`; an optional HTTPS override remains available. The policy link appears even when the variable is unset or blank. Contact links appear on the prize claim screen, and policy links appear beside game consent. New optional links can be configured in the console as ordinary environment variables.

## Focused checks

Run `npm run lint`, `npm run typecheck`, and `npm run build`. The event workflow does not require broad unit or end-to-end suites. The targeted prize checks can run with `npm run test:integration -- -t 'daily prizes|prize fulfillment'`; they use a separate temporary schema on local PostgreSQL and verify concurrent last-item draws, idempotent fulfillment, stock edits/restocking, reseeding, historical claims, registration, the 15% boundary, no-prize retries, daily separation, day-switch races and package value. The post-game checks can run with `npm run test:integration -- -t 'campaign questions'`; they cover deferred code issuance, invalid answers, retries, saved answers in staff reporting, and existing codes. Set `TEST_DATABASE_URL` only to a disposable/local development database whose user can create schemas.

Manually check phone and TV registration, mobile limits and consent, complete three rounds, view results, submit the three campaign questions, scan the claim code, and confirm that Fulfill records one prize and updates the board. Check small phone/tablet widths and landscape TV; verify reduced-motion behavior and QR readability.

## Cloud Run and Cloud SQL

The Docker image uses Next.js standalone output on Node.js 24. `deploy/cloudrun.yaml` is a template; replace its project, region, instance, image, service account and public URL placeholders before applying it.

Use a dedicated PostgreSQL database and application user on Cloud SQL. Grant the Cloud Run service account `roles/cloudsql.client`. Set `DB_PASSWORD`, `SESSION_SECRET`, and `STAFF_PIN` directly as runtime environment variables; Secret Manager is deferred. The service connects through `/cloudsql/INSTANCE_CONNECTION_NAME`; supply `DB_NAME`, `DB_USER` and `DB_PASSWORD` and omit the local `DATABASE_URL`. For local migration/seed access to Cloud SQL, run the Cloud SQL Auth Proxy and point `DATABASE_URL` at its local port.

```sh
docker build -t predikta-outguess:local .
```

Run `db:migrate` and `db:seed` using the repository tooling with production database access before routing traffic. The runtime image does not automatically mutate schema or seed data. Set the canonical HTTPS origin in `PUBLIC_URL` after obtaining the Cloud Run URL. Deploy the image through your normal Artifact Registry and Cloud Run workflow.

For manual deployment, create the database and configure the service through the Google Cloud console. Build/upload the image and initialize the database from Terminal. In Cloud Run, attach the Cloud SQL instance, select the runtime service account, and enter plain environment variables. The YAML template contains placeholders only; enter actual credentials in the console or an ignored working file.

On first deployment, if the final service URL is not yet known, use `https://example.invalid` temporarily as `PUBLIC_URL` while the service requires authentication. Once the service is created, replace `PUBLIC_URL` with its assigned HTTPS origin and deploy that revision before enabling public access. The join QR and mutation-origin checks will not work with the temporary URL.

For production initialization, use an ignored `.env.production` file containing the production connection and configuration, then run `npx tsx --env-file=.env.production scripts/migrate.ts` and `npx tsx --env-file=.env.production scripts/seed.ts`. This avoids the local setup scripts' automatic loading of `.env.local`. Use the same mode, PIN, and session secret as the Cloud Run runtime configuration.

When upgrading an existing deployment to daily prizes and the 15% no-prize wheel, run the additive migration and seed before deploying the new image:

```sh
npx tsx --env-file=.env.production scripts/migrate.ts
npx tsx --env-file=.env.production scripts/seed.ts
```

Keep the Cloud SQL Auth Proxy running for these commands. Do not reset the database or edit an already applied migration. Rebuild/upload with a new image tag, deploy it in Cloud Run, and refresh booth/staff browsers so they load the new reward API. Sign in at `/staff`, verify both daily allocations and activate the correct event day. Migration 003 creates the supplied quantities once; reseeding does not restore stock. Refresh old staff/TV browsers before drawing: new pending draws require an expected day. Existing claims retain their codes and past fulfillment history.

The template keeps one instance warm, permits three instances, uses concurrency 40, and limits each database pool to five connections. All sessions, throttling and inventory are stored in PostgreSQL, so replicas share state. Enable Cloud SQL backups and point-in-time recovery through your infrastructure configuration. Observe Cloud Run 5xx/latency, `/api/health`, and the staff reward totals; logs avoid request bodies and personal details.

The gallery, separate analytics display, Crowd Showdown, SMS OTP, Google Sheets sync, live Predikta calls and automatic AdSpark wallet/payout integrations are deferred.

## Brand assets

The co-branding uses unchanged image assets served by the official [AdSpark](https://www.adspark.ph/) and [Predikta](https://predikta.ai/) websites. They are stored locally for venue reliability and displayed with their original aspect ratios and colors on navy backgrounds.

- AdSpark: `https://d15fzhw4120coi.cloudfront.net/media/ADSPARK-LOGO-FA-WHITE.png`
- Predikta: `https://framerusercontent.com/images/WGh1zXmdag4JPotIeBb4RmjasU.png?scale-down-to=1024&width=32768&height=10933`
