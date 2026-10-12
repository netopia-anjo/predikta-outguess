# Outguess the Crowd

The AdSpark × Predikta booth game, rebuilt in Next.js with PostgreSQL. Players predict which of two ads an audience prefers across three timed rounds. The TV runs the same game with a live leaderboard, and the staff desk records manual reward fulfillment and exports leads.

The phone, TV, and staff screens use the supplied Predikta × AdSpark dark theme: navy/blue gradient backgrounds, translucent cards, cyan highlights, magenta/violet/blue buttons, and self-hosted Outfit typography. `src/app/predikta-dark-theme.css` loads after `globals.css` in the root layout; keep that order when editing styles. Ad artwork retains its own colors and QR codes stay dark on white.

| Route | Purpose |
| --- | --- |
| `/play` | Phone game, joined through the TV QR |
| `/tv` | PIN-protected landscape touchscreen game and live board |
| `/staff` | PIN-protected claims, leads and CSV exports |
| `/api/health` | Database and seeded-event readiness |

The phone starting screen shows a static A-versus-B preview, a compact three-round/time summary, current mixed-prize availability, and an expandable top-three leaderboard. Its **Take the challenge** button stays visible while the landing content scrolls; it opens the existing registration form. The preview uses the first audience's first public ad pair and does not record a pick or expose an answer. The points badge appears after leaving the landing screen. The TV promotes AdSpark merchandise, shows remaining stock and cash value, and uses the shorter five-field registration.

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

Open `http://localhost:3100/play`, `/tv`, or `/staff`. The example staff PIN is `4321`; it is for local testing. `DEMO_MODE=1` loads placeholder ads/results and consent. Prize quantities start at zero: open `/staff` and set actual whole-event quantities before fulfillment. Use separate databases for demo and production.

`PUBLIC_URL` must match the browser origin; the join QR and mutation-origin checks use it. For phones on the same Wi-Fi, use your computer's LAN URL in `PUBLIC_URL` and restart the server. Camera scanning requires HTTPS or localhost; manual claim-code entry remains available.

## Game and reward behavior

- Three rounds, 30 seconds each. Correct Hunch/Pretty sure/All in picks earn 100/150/200 points; wrong picks earn 20/20/0. Correct picks also earn one point per whole second remaining, up to 30. Maximum score: 690.
- Servers calculate scores. Client timing may reduce server elapsed time by at most three seconds; submissions received more than 15 seconds after the timer ends become timeouts. With no pick, a timeout earns zero points.
- Registration is retry-safe with an `Idempotency-Key`; mobile numbers are unique per event. Start, lock, finish, award retries and fulfillment are safe to repeat. Phone sessions last 30 days; staff and TV sessions last 12 hours.
- Accuracy and average confidence determine the four personas. Timeouts are excluded from average confidence. Leaderboard ties use total round time, then completion time.
- Every completed game receives a six-character claim code, independently of score. Codes do not reserve stock. The staff prize wheel uses one whole-event inventory with no timed releases, daily reset, or 300-prize cap.
- Staff scan or enter a code, confirm the business number, and click **Fulfill**. The server selects a prize weighted by remaining units, deducts one item, and records the result in one transaction; the wheel reveals that saved result. Repeated requests return the original prize without another deduction. GCash payout and merchandise handover are manual; the app does not send money. Player screens poll fulfillment status.
- The board polls every three seconds; staff data and claim status every five. Public leaderboard names are shortened. Staff data and authenticated API responses are never cached by the service worker.
- Marketing opt-in is separate from game consent. Consent text, version and time are recorded with each registration. CSV exports include opt-in and consent information and guard against spreadsheet formulas.

## Registration validation

Client and server enforce the same registration rules. Phone registration requires all player fields, campaign qualifiers and game consent; marketing opt-in is optional. TV registration requires full name, business number (PH mobile), work email, company, role and game consent. It omits campaign questions and marketing opt-in; missing campaign fields are stored as NULL rather than invented answers. Names, company and role are limited to 120 characters and email to 254. The mobile field accepts digits and an optional leading `+`, limiting entry to 11 characters for `09…`, 12 for `639…`, 13 for `+639…`, or 10 for `9…`. Formatted pastes have separators removed before applying that limit. The API accepts up to 24 raw phone characters for formatting but rejects invalid or excessive digits rather than shortening them. Oversized or non-text registration values are rejected. PH numbers normalize to the same 11-digit number for duplicate checks. Email syntax is validated; phone ownership and email delivery are not verified.

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

Seeding imports immutable content versions and updates the active version. Existing games retain their original content. Re-seeding preserves players, claims, prize quantities and fulfillment counters. Migration `002_prize_inventory.sql` retains historical GCash tables and records; old fulfilled claims remain fulfilled without consuming new stock, and pending claims use the wheel. Do not revise an applied migration; add a new migration instead.

## Staff prize setup

Open `/staff`, sign in, then choose **Prize inventory → Set quantities**. Set whole-event totals for PHP 150 GCash, Cellphone Holder, Tote Bag, Pencil Holder and Ballpen. Totals include units already fulfilled; increase a total to restock. Negative/fractional values and totals below fulfilled counts are rejected. Concurrent edits or draws invalidate an older inventory revision; use **Reload quantities** before saving again.

The yellow TV cash banner is remaining GCash units × PHP 150 (100 cash units means PHP 15,000). It carries across event days. The PHP 30,000 banner is fixed promotional copy, not a calculated value of all remaining merchandise. The TV rail lists the three requested merchandise types; Ballpen appears in staff inventory and the wheel. Out-of-stock types cannot be drawn. When everything runs out, games and claim codes still work but fulfillment is blocked until restocked.

`ADSPARK_CONTACT_URL` defaults to `https://www.adspark.ph/get-in-touch`. Set `ADSPARK_PRIVACY_POLICY_URL` to the HTTPS URL AdSpark supplies; its link is hidden while unset. Contact links appear on the prize claim screen, and policy links appear beside game consent. New optional links can be configured in the console as ordinary environment variables.

## Focused checks

Run `npm run lint`, `npm run typecheck`, and `npm run build`. The event workflow does not require broad unit or end-to-end suites. The targeted prize checks can run with `npm run test:integration -- -t 'prize fulfillment'`; they use a separate temporary schema on local PostgreSQL and verify concurrent last-item draws, idempotent fulfillment, stock edits/restocking, reseeding, historical claims, and TV registration. Set `TEST_DATABASE_URL` only to a disposable/local development database whose user can create schemas.

Manually check phone and TV registration, mobile limits and consent, complete three rounds, scan the claim code, and confirm that Fulfill records one prize and updates the board. Check small phone/tablet widths and landscape TV; verify reduced-motion behavior and QR readability.

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

When upgrading an existing deployment to the prize wheel, run the additive migration and seed before deploying the new image:

```sh
npx tsx --env-file=.env.production scripts/migrate.ts
npx tsx --env-file=.env.production scripts/seed.ts
```

Keep the Cloud SQL Auth Proxy running for these commands. Do not reset the database or edit an already applied migration. Rebuild/upload with a new image tag, deploy it in Cloud Run, and refresh booth/staff browsers so they load the new reward API. Sign in at `/staff` and set prize quantities; seed does not automatically allocate stock. Existing claims retain their codes and past fulfillment history.

The template keeps one instance warm, permits three instances, uses concurrency 40, and limits each database pool to five connections. All sessions, throttling and inventory are stored in PostgreSQL, so replicas share state. Enable Cloud SQL backups and point-in-time recovery through your infrastructure configuration. Observe Cloud Run 5xx/latency, `/api/health`, and the staff reward totals; logs avoid request bodies and personal details.

The gallery, separate analytics display, Crowd Showdown, SMS OTP, Google Sheets sync, live Predikta calls and automatic AdSpark wallet/payout integrations are deferred.

## Brand assets

The co-branding uses unchanged image assets served by the official [AdSpark](https://www.adspark.ph/) and [Predikta](https://predikta.ai/) websites. They are stored locally for venue reliability and displayed with their original aspect ratios and colors on navy backgrounds.

- AdSpark: `https://d15fzhw4120coi.cloudfront.net/media/ADSPARK-LOGO-FA-WHITE.png`
- Predikta: `https://framerusercontent.com/images/WGh1zXmdag4JPotIeBb4RmjasU.png?scale-down-to=1024&width=32768&height=10933`
