# Outguess the Crowd

The AdSpark × Predikta booth game, rebuilt in Next.js with PostgreSQL. Players predict which of two ads an audience prefers across three timed rounds. The TV runs the same game with a live leaderboard, and the staff desk records manual reward fulfillment and exports leads.

| Route | Purpose |
| --- | --- |
| `/play` | Phone game, joined through the TV QR |
| `/tv` | PIN-protected landscape touchscreen game and live board |
| `/staff` | PIN-protected claims, leads and CSV exports |
| `/api/health` | Database and seeded-event readiness |

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

Open `http://localhost:3100/play`, `/tv`, or `/staff`. The example staff PIN is `4321`; it is for local testing. `DEMO_MODE=1` releases 100 test rewards for the current Manila day. Use separate databases for demo and production.

`PUBLIC_URL` must match the browser origin; the join QR and mutation-origin checks use it. For phones on the same Wi-Fi, use your computer's LAN URL in `PUBLIC_URL` and restart the server. Camera scanning requires HTTPS or localhost; manual claim-code entry remains available.

## Game and reward behavior

- Three rounds, 30 seconds each. Correct Hunch/Pretty sure/All in picks earn 100/150/200 points; wrong picks earn 20/20/0. Correct picks also earn one point per whole second remaining, up to 30. Maximum score: 690.
- Servers calculate scores. Client timing may reduce server elapsed time by at most three seconds; submissions received more than 15 seconds after the timer ends become timeouts. With no pick, a timeout earns zero points.
- Registration is retry-safe with an `Idempotency-Key`; mobile numbers are unique per event. Start, lock, finish, award retries and fulfillment are safe to repeat. Phone sessions last 30 days; staff and TV sessions last 12 hours.
- Accuracy and average confidence determine the four personas. Timeouts are excluded from average confidence. Leaderboard ties use total round time, then completion time.
- Inventory is reserved at completion, independently of score, while released stock remains. Scheduled allocations roll forward, subject to the event-wide 300-GC cap. Players without stock can check again at the next drop.
- Staff scan or enter the six-character code, confirm the GCash number, arrange the manual payout with AdSpark, and record fulfillment. The app does not initiate a payment. The player screen refreshes claim status automatically.
- The board polls every three seconds; staff data and claim status every five. Public leaderboard names are shortened. Staff data and authenticated API responses are never cached by the service worker.
- Marketing opt-in is separate from game consent. Consent text, version and time are recorded with each registration. CSV exports include opt-in and consent information and guard against spreadsheet formulas.

## Registration validation

Client and server enforce the same registration rules. All player fields, campaign qualifiers and game consent are required; marketing opt-in is optional. Names, company and role are limited to 120 characters and email to 254. The mobile field accepts digits and an optional leading `+`, limiting entry to 11 characters for `09…`, 12 for `639…`, 13 for `+639…`, or 10 for `9…`. Formatted pastes have separators removed before applying that limit. The API accepts up to 24 raw phone characters for formatting but rejects invalid or excessive digits rather than shortening them. Oversized or non-text registration values are rejected. PH numbers normalize to the same 11-digit number for duplicate checks. Email syntax is validated; phone ownership and email delivery are not verified.

Inline errors identify the affected fields and focus the first invalid field. Staff PINs require 4–12 digits; claim codes use the reward code alphabet. Editing a claim code clears the old lookup and confirmations, and overlapping staff actions are blocked. Production configuration rejects the local example session secret and staff PIN.

The TV requires the same `STAFF_PIN` before showing the booth screen. Unlock it once on the TV browser; its HTTP-only session survives refreshes for 12 hours. The TV session is separate from staff access and cannot authorize claims or exports. TV data and game endpoints require this session, and failed PIN attempts share the staff lockout. Use **Lock TV** when leaving the booth unattended; locking revokes the session on the server. Phone play at `/play` remains public.

## Content and event setup

`content/audiences.json` holds three audiences with three rounds each. Each ad can specify `image: "/content/ads/filename.webp"`; place the asset in `public/content/ads/`. Keep assets optimized and use a new filename when changing an image. `content/respondents.json` labels the simulated reactions.

The supplied creatives, preference splits and reactions are placeholders. To activate production:

1. Supply the final AdSpark images and approved Predikta results.
2. Replace the placeholder event dates and allocations in `content/gc-schedule.json`. Times are Manila time; total allocations must not exceed 300.
3. Copy `content/approval.example.json` to `content/approval.json`, insert approved consent text and its version, and set the three approval flags to true.
4. Set `DEMO_MODE=0`, a matching HTTPS `PUBLIC_URL`, a random `SESSION_SECRET` of at least 32 characters, and a private staff PIN.
5. Run migrations and seed against the production database before starting the production service.

Seeding imports immutable content versions and updates the active version. Existing games retain their original content. Re-seeding preserves players and claims and rejects changes to released allocations once rewards have been awarded. Do not revise an applied migration; add a new migration instead.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run build
```

Integration tests create and remove a separate temporary schema on the local database. Set `TEST_DATABASE_URL` to use another disposable development database; its user needs schema creation permission. Tests exercise 25 concurrent games and concurrent awards at the 300-reward limit.

Playwright requires Chromium (`npx playwright install chromium`). It uses the running preview, or starts it if absent, and creates test players in the demo event. Set `E2E_BASE_URL` to test a production-style local container. Browser screenshots and traces are in the ignored `test-results` directory.

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

The template keeps one instance warm, permits three instances, uses concurrency 40, and limits each database pool to five connections. All sessions, throttling and inventory are stored in PostgreSQL, so replicas share state. Enable Cloud SQL backups and point-in-time recovery through your infrastructure configuration. Observe Cloud Run 5xx/latency, `/api/health`, and the staff reward totals; logs avoid request bodies and personal details.

The gallery, separate analytics display, Crowd Showdown, SMS OTP, Google Sheets sync, live Predikta calls and automatic AdSpark wallet/payout integrations are deferred.

## Brand assets

The co-branding uses unchanged image assets served by the official [AdSpark](https://www.adspark.ph/) and [Predikta](https://predikta.ai/) websites. They are stored locally for venue reliability and displayed with their original aspect ratios and colors on navy backgrounds.

- AdSpark: `https://d15fzhw4120coi.cloudfront.net/media/ADSPARK-LOGO-FA-WHITE.png`
- Predikta: `https://framerusercontent.com/images/WGh1zXmdag4JPotIeBb4RmjasU.png?scale-down-to=1024&width=32768&height=10933`
