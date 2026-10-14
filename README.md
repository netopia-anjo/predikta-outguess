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

Open `http://localhost:3100/play`, `/tv`, or `/staff`. The example staff PIN is `4321`; it is for local testing. `DEMO_MODE=1` uses the supplied artwork and confirmed winners with the existing placeholder consent; it does not bypass image-file validation. Each day starts with the supplied 155-prize allocation: open `/staff` to verify quantities and the active day before booth play. Use separate databases for demo and production.

`PUBLIC_URL` must match the browser origin; the join QR and mutation-origin checks use it. The event’s production origin is `https://digicon.predikta.ai`; set this as Cloud Run’s `PUBLIC_URL` (without `/play`). The TV join QR then encodes `https://digicon.predikta.ai/play`. Use this domain for `/play`, `/tv` and `/staff` because mutation checks require the configured origin. Changing the runtime URL does not require migration or reseeding. For phones on the same Wi-Fi, use your computer's LAN URL in `PUBLIC_URL` and restart the server. Camera scanning requires HTTPS or localhost; manual claim-code entry remains available.

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

`content/audiences.json` holds three audiences with five supplied A/B pairs each. The 30 original PNGs came from `/Users/leandrozulaybar/Downloads/ROUNDS`: `AUDIENCE 1/GENZ-Q1..Q5-A/B`, `AUDIENCE 2/MOMS-Q1..Q5-A/B`, and `AUDIENCE 3/YP-Q1..Q5-A/B`. These map to the existing `genz`, `moms`, and `cebu` audience IDs. Source-based round labels and accurate headline/visual descriptions identify each pair without inventing brands.

The user confirmed that the **original B creative wins all 15 pairs**. New games independently shuffle which creative is displayed as A or B in each selected round; the original B artwork remains correct even when displayed as Ad A. Each player receives three distinct randomly selected pairs in a random order from their chosen audience, stored in `players.round_indices` by migration `004_player_round_selection.sql`. Migration `005_player_round_swaps.sql` stores three independent 50/50 swaps in `players.round_swaps`. Reselecting the same audience/retrying/resuming preserves the sample and assignments; server scoring, displayed creatives, winner letters, preference splits and results share the same mapping. NULL swaps preserve existing games' displayed labels. Old three-pair content and NULL selections retain the original order. Sessions still play three 30-second rounds with a maximum score of 690.

Optimized, content-hashed WebP files in `public/content/ads/` preserve the source 1122 × 1402 dimensions and reduce the combined payload from about 57.7 MB to 6.1 MB. Keep old filenames available for earlier content versions. Image creatives use contain sizing, portrait landing previews and enlargement so artwork is not cropped; synthetic brand overlays are hidden on image ads. Both ads load/decode before a new round timer starts. Failed loads offer retry without starting a new round; already-running resumed rounds retain server timing.

Reveal data for all 15 pairs is mapped exactly from the **Sample Copies** section of `/Users/leandrozulaybar/Downloads/[Ext]AdSpark x Predikta - Digicon Booth Activation.docx`: each audience’s rows 1–5 map to its Q1–Q5 artwork. The earlier nine-pair Example rounds section describes different ads and is not used for this import. Preference percentages, emotions, behavioral drivers and both reactions use the document’s wording and values. The document identifies these as illustrative placeholders, so `insightSource: "illustrative"` and the visible simulated-example label remain; they are not measured results or live Predikta responses. Generic audience labels remain for simulated reactions. The original B shares for Q1–Q5 are Gen Z 72/68/74/77/69%, Moms & Titas 73/71/65/70/76%, and Young Professionals 71/73/68/66/72%. Displayed percentages reverse with saved A/B swaps. Public content hides all insights until submission. Existing versions retain their original insights or winner-only reveals. Content validation accepts either three-pair legacy audiences or five-pair pools, validates any supplied insights, and checks all referenced image files even with `DEMO_MODE=1`. Public content still hides answers.

Keep `DEMO_MODE=1` for the current event database/runtime until approved consent/content activation is coordinated. Artwork and winners are now supplied, but `content/approval.json` flags remain false and its consent fields are placeholders. For approved-content activation, fill the approved consent/version and flags truthfully and follow the separate-database mode rule; do not simply flip the runtime mode on an existing placeholder-mode database.

Seeding imports immutable content versions and updates the active version. Existing games retain their original content. Re-seeding preserves players, claims, prize quantities and fulfillment counters. Migrations `002_prize_inventory.sql` and `003_daily_prizes.sql` retain historical GCash/whole-event inventory and claims; old fulfilled claims remain fulfilled without consuming new daily stock, and pending claims use the active day’s wheel. Migration 003 initializes the supplied daily quantities once for existing events; new-event seeding inserts missing daily rows only. Migration 004 adds per-player selection storage; migration 005 adds saved A/B swaps with NULL preserving earlier assignments. Neither migration changes existing claims or inventory. Do not revise an applied migration; add a new migration instead.

On results, the optional saved-interest toggle reads **Run a real Predikta simulation on my next campaign, I would like a trial!** It keeps the existing `wantsSim` field and staff/export behavior. The prize screen has a full-width branded **Know more about AdSpark x Predikta** link button using the configured contact URL, opening in a new tab for both phone and TV and all prize outcomes.

## Staff prize setup

Hot leads has **All**, **Fulfilled** and **Unfulfilled** filters with category counts, combined with name/company/email/role search and ten-record pagination. All is selected initially; changing search or status returns to page one, and live updates retain or clamp the current page. Fulfilled means the staff draw is complete, including terminal no-prize outcomes; those rows say **Draw complete · no prize**. Prize-issued KPIs and exports still count actual prize fulfillment separately.

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

The yellow TV cash banner shows the active day’s remaining GCash value (PHP 15,500 initially per day). Package value is separate from cash payouts: ten packages across both days are worth PHP 750,000. The package banner uses configured totals, so it does not decrease after wins; staff adjustments to package quantities update the advertised pool. Merchandise and package counts show active-day stock. The backend retains a permanent 15% no-prize probability; the 85% winning portion uses role-adjusted weights: ordinary roles use package weight 1 and other-prize weight 4; qualifying marketing leaders use package weight 480 and other-prize weight 52. These integer weights give leaders exactly a 20% package chance at the supplied full daily stock. With no prizes left, new spins are blocked until staff restocks or activates another day; games and draw codes still work.

Package odds at full daily stock are approximately 0.7% per spin for ordinary roles and exactly 20% for VP/Vice President of Marketing, Head of Marketing, CMO/Chief Marketing Officer and Marketing Director/Director of Marketing. Matching uses the saved registration role with case/space/period/comma/hyphen normalization and an exact title allowlist, including VP Marketing, Vice President Marketing, Marketing VP and Marketing Head. Partial titles, assistant roles and additional title text do not qualify. Role qualification, weighted draws and probability snapshots live only in `src/server/prize-odds.ts`, protected by `server-only`; client-supplied role/odds overrides are ignored. The visible wheel uses equal-sized available-prize categories for every role and shows no percentages. Its animation reveals the server-recorded outcome rather than displaying odds. Staff fulfillment responses carry only category IDs/names/counts and the winning ID; actual probability snapshots remain in PostgreSQL. Probabilities vary as stock depletes; when packages are the only prize left, they share the entire 85% winning chance for all roles. Existing draw outcomes and wheel snapshots are preserved. This change needs no migration or environment variables.

Player and staff screens distinguish pending, prize, no-prize and historical results. For compatibility, `claimed_at` is the terminal staff-draw timestamp for new outcomes; no-prize rows have `draw_outcome=no_prize` and no `prize_id`. Reports exclude them from prize fulfillment counts. CSV exports include outcome, draw timestamp, prize day, cash payout amount and separate package value. The old catalog/inventory remains archived and is not silently mapped into the supplied daily allocations.

`ADSPARK_CONTACT_URL` defaults to `https://www.adspark.ph/get-in-touch`. `ADSPARK_PRIVACY_POLICY_URL` defaults to the supplied `https://www.adspark.ph/privacy-policy`; an optional HTTPS override remains available. The policy link appears even when the variable is unset or blank. Contact links appear on the prize claim screen, and policy links appear beside game consent. New optional links can be configured in the console as ordinary environment variables.

## Focused checks

Run `npm run lint`, `npm run typecheck`, and `npm run build`. The event workflow does not require broad unit or end-to-end suites. The targeted prize checks can run with `npm run test:integration -- -t 'daily prizes|prize fulfillment'`; they use a separate temporary schema on local PostgreSQL and verify concurrent last-item draws, idempotent fulfillment, stock edits/restocking, reseeding, historical claims, registration, the 15% boundary, no-prize retries, daily separation, day-switch races and package value. The ad-import checks can run with `npm run test -- -t 'ad import'` and `npm run test:integration -- -t 'ad shuffle|ad selection|complete game has authoritative'`; they verify all image references, hidden answers, unique/stable three-pair samples, original-B scoring under saved A/B swaps, percentage mapping, illustrative content and legacy game preservation. The post-game checks can run with `npm run test:integration -- -t 'campaign questions'`; they cover deferred code issuance, invalid answers, retries, saved answers in staff reporting, and existing codes. Set `TEST_DATABASE_URL` only to a disposable/local development database whose user can create schemas.

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

For this artwork/reveal/shuffle upgrade, keep the Cloud SQL Auth Proxy running and use this order:

1. Apply the additive migration: `npx tsx --env-file=.env.production scripts/migrate.ts`.
2. Rebuild/upload a new image containing the new public assets, deploy it in Cloud Run and refresh booth browsers so they use the compatible reveal/selection renderer. Existing active content remains available at this point.
3. Activate the new content: `npx tsx --env-file=.env.production scripts/seed.ts`, then reload the TV and new-player browsers. Match `DEMO_MODE=1` with the existing database/runtime.

Deploy before seeding the new content so active content uses the compatible assets, illustrative-insight labels and shuffle renderer. Do not reset the database, edit an applied migration, or change content versions for existing players. Re-seeding preserves claims, daily allocations, active day and fulfillment history. No new environment variables are needed for this upgrade. Initial deployments still use the setup commands above; migration 003 creates the supplied daily stock once, and `/staff` selects the active event day.

The template keeps one instance warm, permits three instances, uses concurrency 40, and limits each database pool to five connections. All sessions, throttling and inventory are stored in PostgreSQL, so replicas share state. Enable Cloud SQL backups and point-in-time recovery through your infrastructure configuration. Observe Cloud Run 5xx/latency, `/api/health`, and the staff reward totals; logs avoid request bodies and personal details.

The gallery, separate analytics display, Crowd Showdown, SMS OTP, Google Sheets sync, live Predikta calls and automatic AdSpark wallet/payout integrations are deferred.

## Brand assets

The co-branding uses unchanged image assets served by the official [AdSpark](https://www.adspark.ph/) and [Predikta](https://predikta.ai/) websites. They are stored locally for venue reliability and displayed with their original aspect ratios and colors on navy backgrounds.

- AdSpark: `https://d15fzhw4120coi.cloudfront.net/media/ADSPARK-LOGO-FA-WHITE.png`
- Predikta: `https://framerusercontent.com/images/WGh1zXmdag4JPotIeBb4RmjasU.png?scale-down-to=1024&width=32768&height=10933`
