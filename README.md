# Design Scraper & Mix It

Extract a website's design system, or blend two references, using screenshots,
CSS evidence and AI vision. Inspect the result visually and export five formats
without another AI request: Extended Markdown, Compact Markdown, CSS variables,
Tailwind-compatible CSS and design tokens JSON.

Design Scraper is a minimal workspace for examining one reference. **Mix It** is
its colorful experimental counterpart for combining two websites, reached through
a GSAP paint transition. Both experiences share saved designs, session activity
and estimated costs. The typographic study and paint sculpture pause when
off-screen or in a hidden tab and honor reduced-motion preferences.

Switching worlds plays a paint transition: the requested world renders only
once the paint covers the viewport, and the return to Design Scraper drains the
paint to monochrome while it retreats.

[Explore Design Scraper](https://design-scraper.pages.dev/) ·
[Open the app](https://design-scraper.pages.dev/app/#/analyze) ·
[Browse saved designs](https://design-scraper.pages.dev/app/#/library)

The public landing at `/` is static HTML. The application lives at `/app/`,
with its existing hash navigation. Saved results can be linked directly, for
example `/app/#/library/stripe`; opening and exporting them uses no analysis
quota. These are dated third-party analyses, not official brand guides.

Legacy `/demo/` links also forward to `/app/` with their hash intact.

Only the landing is listed in `sitemap.xml`. The application retains HTTP and HTML
`noindex, nofollow, noarchive`; `robots.txt` allows crawling so those directives
can be read. Preview deployment hosts also receive `noindex`. Old root hash
links forward to the matching application section. Unknown paths return a real 404.

## Architecture

- **Frontend:** React, TypeScript and Vite, deployed on Cloudflare Pages.
- **API:** Cloudflare Worker with exact-origin CORS and shared admission limits.
- **Capture:** Browser Run and Playwright, with public-network validation,
  resource limits and isolated browser contexts.
- **Coordination:** SQLite Durable Objects for shared quotas and one analysis
  object per admitted request.
- **Output:** One validated `DesignSystem` produces all documents and exports.
  Values retain their source, confidence and detected/inferred status. Missing
  evidence appears as explicit gaps.

The shared allowance uses Gemini. Choose **Use your own key** to use Gemini, Claude,
OpenAI or Grok through your provider account. The UI shows the configured model
before analysis. Costs are always estimates, not invoices; models without
configured pricing show an unavailable estimate.

## Requirements

- Node.js 24.22.1 LTS and npm (`nvm use` selects the pinned version).
  Patched Node.js 22.23.4+ and 26.12.1+ are also supported.
- Chromium installed through Playwright for browser tests.
- OpenSSL available on your PATH for the local HTTPS UI tests.
- A Cloudflare account and Gemini API key only when running real captures and
  analysis. Tests below use fixtures, local Chromium and local SQLite.

## Install and test

```sh
npm --prefix frontend ci
npm --prefix cloudflare-backend ci
cd cloudflare-backend
npx playwright install chromium
npm run types
npm run verify
cd ../frontend
npm test
VITE_API_URL=https://design-scraper-phase8.lucas-malizia27.workers.dev npm run build:pages
cd ../cloudflare-backend
npm run test:ui
```

`verify` checks generated files, TypeScript, unit/contract tests, real Chromium,
real workerd/SQLite, private resource relay integration and a deployment dry-run. `test:ui` serves the actual Pages
build on loopback and intercepts API responses: both modes, direct access without credentials,
errors, keyboard access, responsive layouts and every copy/download format are
checked without provider calls. If you change the build's API origin, supply the
same `API_URL` when running the UI test.

The UI suite also verifies the landing's initial HTML, indexing rules, canonical
and social metadata, responsive breakpoints, saved-result downloads, and old
hash links. Landing screenshots are saved in `output/playwright/landing-a/`.

## Run locally

Create the environment files without overwriting existing credentials:

```sh
cp -n cloudflare-backend/.dev.vars.example cloudflare-backend/.dev.vars
cp -n frontend/.env.example frontend/.env.local
```

Fill `GEMINI_API_KEY`, `IP_HASH_SECRET` and `PHASE8_AUTH_TOKEN` in `.dev.vars`.
Generate independent random values for the latter two, for example with
`openssl rand -hex 32`. The historical token variable name is retained for
compatibility with existing Cloudflare Secrets; it protects administrative budget
diagnostics through the protected endpoint and operational scripts. The public
interface never requests it. Never place secrets in `VITE_*`.

Start the API and frontend in separate terminals:

```sh
# Terminal 1
cd cloudflare-backend
npx wrangler login
npm run dev
```

```sh
# Terminal 2
cd frontend
npm run dev
```

Open `http://localhost:5173/` for the landing or
`http://localhost:5173/app/#/analyze` for the application. The landing and saved
library can be reviewed with only the frontend running. Vite proxies
`/api` to the local Worker at `127.0.0.1:8787`; the default local frontend API URL
is empty for this purpose. Local quotas
live in `.wrangler/`, separate from the deployed SQLite state.

Development servers bind to loopback. Do not expose Vite, its preview server or
the local Worker to the public internet. Tailwind processes repository sources
at build time; it does not process submitted websites. Its `braces@3.0.3`
dependency still has an unpatched nested-pattern denial-of-service advisory
([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)).
Build only trusted sources and glob configuration. The vulnerable CSS selector
parser is overridden to the patched `7.1.6` release. Neither package is shipped
in the static Pages application or the Worker request bundle. Workers runs on
Cloudflare's managed runtime; `nodejs_compat` does not deploy the local Node.js
binary. Keep the local build and test runtime patched independently.

Real capture uses the remote Browser Run binding and consumes the account's
browser allowance; Gemini calls consume provider quota. Local Chromium tests
exercise capture without creating those remote sessions. See Cloudflare's
[remote bindings documentation](https://developers.cloudflare.com/workers/local-development/bindings-per-env/).

## API and output contract

Public JSON requests (no access code):

```http
POST /api/analyze
Content-Type: application/json

{"url":"https://example.com"}
```

```http
POST /api/mix
Content-Type: application/json

{"url_1":"https://first.example","url_2":"https://second.example","bias":0}
```

Bias values `-50`, `-25`, `0`, `25`, `50` map to `100/0`, `75/25`, `50/50`,
`25/75`, `0/100`. Excluded sources are not captured. Responses include
`design_system`, `documents`, `exports`, and `metadata.usage`; `design_md` is the
Extended Markdown compatibility field. Technical exports are derived locally;
Tailwind-compatible output does not imply that the source site uses Tailwind.

The canonical schema is [`schema.json`](cloudflare-backend/src/domain/schema.json).
After editing it, run `npm run generate` in `cloudflare-backend/` to update types
and the standalone validator. The generator never rewrites expected test outputs.
See [contract fixtures and verification](#contract-fixtures-and-verification).

## Deploy and operate

Deployment configuration lives in
[`wrangler.jsonc`](cloudflare-backend/wrangler.jsonc). The shared service runs
on Cloudflare Free with these normal ceilings:

| Limit | Value |
| --- | --- |
| Global admissions | 20 per UTC day |
| Admissions per IP | 3/hour and 5 per UTC day |
| Active analyses | 1 |
| Browser capture | 8 minutes/day reserved by the app |
| Estimated shared AI budget | USD 1/day; USD 30 accumulated |

Capture or AI budgets may stop admission before the request-count limit is
reached. Required resources that fail to load return an explicit capture error.
An image used only as a CSS background that returns HTTP 404 remains absent and
is recorded in Known Gaps; available background colors and gradients are preserved.
The app opens directly without an access code. Administrative budget diagnostics
remain authenticated.

Capture focuses on static branding: typography, colors, backgrounds, spacing,
image treatment, borders and page structure. Video/audio downloads and playback
are excluded; existing video boxes and available posters remain visible. Media
exclusions appear in Known Gaps and do not replace required CSS, fonts or images.

## Use your own key

On the HTTPS site, choose **Use your own key**, select a provider, paste its API
key and accept responsibility for your provider's charges and terms. The key
stays in tab memory and travels over HTTPS to the Worker and selected provider
only for analysis. The application does not save it to browser storage, cookies,
logs or a database. Reloading, navigating away, closing the tab, switching
provider, choosing Shared allowance or clicking **Clear key** clears the key.
Page screenshots and extracted evidence are processed under your provider's terms.

BYOK uses one AI attempt per analysis and never falls back to the shared key.
The provider's tokens, estimated cost and credential errors are isolated from
the demo's AI ledger. All admission, IP, concurrency and Browser Run limits in
the table still apply. An additional in-memory tab guard limits BYOK to one
active request, three attempts/hour and five per UTC day; reloading does not
reset the server's limits. Cancel stops waiting, but work already started may
still consume quota.

The local HTTP development UI supports the shared allowance. BYOK requires HTTPS on
both the page and API; there is no insecure localhost exception. Local browser
tests serve the built app over temporary HTTPS with mocked APIs and fake keys.

## Repository layout

```text
frontend/              React app, Pages headers, UI tests and build scripts
cloudflare-backend/    Worker, Browser Run, SQLite coordination and domain logic
  src/domain/          Canonical schema, normalization and output rendering
  tests/               Fixed fixtures and unit/Chromium tests
  scripts/             Generation, runtime tests and operational checks
```

## License

[MIT](LICENSE). Saved website analyses describe third-party references; their
inclusion does not grant rights to the referenced brands or website content.

## Spending, loading and saved designs

The **Design library** is a catalog of saved analyses
(`frontend/src/examples/catalog.json` plus one saved response per entry). Each
card opens the full result or downloads its `design.md` without any analysis
request. The forms offer those same references as **Try** chips that only
prefill URLs. Focusing a URL field reads the public `/api/quotas` endpoint once
and shows the remaining shared analyses next to the submit button; nothing is
requested on page load. Opening the page never contacts the API.

Open the key settings and expand **Models & estimated rates** to read the server's
configured models and USD rates per million input/output tokens. Unconfigured
prices remain unavailable. **Session spending** records completed, failed and
cancelled requests in tab memory, separates demo/BYOK and provider subtotals,
and reports partial totals when costs are unknown. Reload clears this history.
This is neither a provider invoice nor global account spending. Each request
shows provider calls, generation attempts and auxiliary calls (such as Gemini
countTokens), plus reported usage and the separate conservative demo ledger
amount. Failed requests show zero calls only when confirmed by the server.
After cancellation or disconnection, counts are the last received lower bound
and final consumption stays unknown.

While analyzing, the UI receives live stages over the same POST response and
shows a spinner, elapsed time and the percentage of completed steps: admission,
each active source capture, AI analysis and export preparation. This is task
completion, not an estimate of time remaining. A successful result is required
before 100%. Older JSON-only backends retain the indeterminate fallback.
Errors retain their issue code and cause; retry is offered only when the backend
marks the error retryable and its `Retry-After` deadline has elapsed. Cancel
stops waiting and does not guarantee remote work or charges have stopped.

**Site API availability** loads the public counter when Activity & costs opens.
It shows analyses left today, capture time, running analyses, shared AI capacity,
visitor limits and the daily reset. Refreshing never starts an analysis or uses
AI credit. Failed refreshes retain clearly labeled last-known values; an unknown
counter is not displayed as zero. This is site capacity, not a provider account
balance. A personal API key pays for AI but retains shared admission and capture
limits. Administrative diagnostics are not part of the public interface.

For a local Pages preview, run `npm run preview` from `frontend/` after the Pages
build. Vite proxies only `/api/quotas` to the HTTPS API origin declared in the
build's CSP (or an explicit `VITE_API_URL`). This allows the public counter to
load from localhost without changing production CORS or forwarding credentials.
Development still uses the local Worker proxy; production uses the configured
API origin directly.

The **saved design library** includes reviewed snapshots of Stripe (September 10, 2026),
Milligram, Example Domain and a Bootstrap/Milligram blend (September 9, 2026). Opening, copying
and downloading them uses static application assets only, with no analysis API,
AI or Browser Run calls. Their historical usage is excluded from session totals.
These are historical analyses, not current captures or official brand guides.

To add an example, review a saved successful response for public source URLs and
sensitive data, keep only its public result fields, and add it to
`frontend/src/examples/` and add its metadata to `catalog.json` in that directory.
`frontend/src/library.ts` loads each response as a separate application chunk. Preserve
its evidence, gaps, original analysis date and all five consistent outputs.
Validate the file against the canonical schema and renderers without calling AI:

```sh
cd cloudflare-backend
npm run verify:results -- \
  ../frontend/src/examples/bootstrap-milligram.json \
  ../frontend/src/examples/example-domain.json \
  ../frontend/src/examples/milligram.json \
  ../frontend/src/examples/stripe.json
```

Pass successful response files only; `catalog.json` contains library metadata,
not an analysis result. Include a new response path when validating a new example.

`npm run test:ui` also checks the library's copy/download bytes, zero analysis
requests while browsing examples, provider rates, session spending, cancellation,
retry deadlines, streamed results, public quotas, administrative budget access
and responsive layouts from 320 to 1440 pixels.

## Contract fixtures and verification

[`src/domain/schema.json`](cloudflare-backend/src/domain/schema.json) is the
canonical contract. `npm run generate` produces TypeScript types and a standalone
AJV validator; `npm run generate:check` detects drift. Prompts and browser
extraction sources are maintained directly in `cloudflare-backend/src/domain/`.

The fixed expected outputs in
[`tests/fixtures/`](cloudflare-backend/tests/fixtures/) cover single and mixed
sources, every bias, evidence classification, escaping and all five exports.
They are independent expected answers: never regenerate them automatically to
make a failing renderer test pass. An intentional contract change should explain
the before/after behavior and update only the affected fixtures.

Run these commands from `cloudflare-backend/`:

| Command | Purpose |
| --- | --- |
| `npm run types` | Generate binding and Worker runtime types |
| `npm run generate:check` | Check generated contract files |
| `npm run typecheck` | Check backend TypeScript |
| `npm test` | Unit, contract, provider, security and quota tests |
| `npm run test:chromium` | Real Chromium capture tests with controlled local resources |
| `npm run test:sections` | Pixel checks for contiguous capture, lazy images and style restoration |
| `npm run test:runtime` | Real workerd/SQLite coordination, persistence and restart tests |
| `npm run test:relay` | Private relay integration in local workerd and Chromium |
| `npm run deploy:dry-run` | Build the Worker without deploying |
| `npm run verify` | Run the complete backend sequence above |
| `npm run test:ui` | Test the built Pages app locally with intercepted APIs |
| `npm run test:pages` | Test the deployed Pages app with intercepted APIs |
| `npm run verify:results -- <files>` | Validate saved successful responses without AI calls |

Install both packages before Chromium tests; the font fixture uses a frontend
dependency. Chromium and workerd tests fail if their runtimes cannot run. Relay
tests exercise binary transfers, per-resource and aggregate ceilings,
cancellation, private redirects, provider redirects and cleanup acknowledgments.
BYOK tests use fake keys and check isolation, key clearing and the absence of
credentials from storage, logs and returned errors. The UI harness uses temporary
loopback HTTPS certificates, allows those certificates only in its local browser,
blocks unexpected outbound connections and removes the certificates afterward.

None of the default test suites calls a real AI provider or remote Browser Run.
Without explicit file arguments, `verify:results` looks for local
`cloudflare-backend/reports/result-*.json`; a fresh clone should use the checked-in
examples listed above. Reports and screenshots generated by tests are local
artifacts excluded from Git.

## Capture policy and limits

The Worker fulfills public HTTP(S) resources through a private `ResourceRelay`
Durable Object with `global_fetch_strictly_public`. Each redirect gets fresh
URL/DNS validation. Private/reserved addresses, embedded credentials and
non-default ports are rejected. Browser contexts block service workers,
WebSockets and downloads. Relay storage retains no resource bodies, URLs or
headers. The installation/build patch for the pinned Playwright driver fails
if its expected dependency version or source changes; review it during upgrades.

The configured profile captures a 1440 px wide region up to 4000 px high, with
600 page requests and 60 seconds per source. Each source has a 32 MB download
budget, with at most four resources in flight; each resource is limited to 8 MB
and 25 seconds within the source deadline. Both sources share an 800-call relay
guard including reserved cleanup calls. Browser contexts close before AI
processing starts. Uncertain cleanup retains the conservative reservation.

Capture waits for required visual resources, triggers lazy images in the region
and checks clipping and visibility. Missing required CSS, fonts or visible
content images fail capture. Failed blocking, deferred, module or unidentifiable
scripts remain errors. An explicitly async classic script may be unavailable
only when styled headings, substantial visible copy and controls are already
rendered without a busy shell; that limited evidence produces a Known Gap and
does not verify hydration or interactive behavior. Safety and budget failures
still fail immediately. The confirmed CSS-background-only HTTP 404 exception
described above also retains an explicit gap.

Viewport photographs are composed within the original deadline and byte budget.
A changing layout discards the tiles, waits briefly for stability and recomposes
once. A second change returns `CAPTURE_LAYOUT_CHANGED`. Sticky/fixed elements
are normalized for photographs, inline styles are restored and finite CSS
transitions are completed. JavaScript animation states and excluded media remain
explicit limitations. Up to 24 distinct measured elements retain source locators,
computed properties and source influence through normalization and every export.

For a new single-source result, proposed colors unmatched by the bounded
captured evidence keep their value and inference status, but confidence is
capped at 0.5 with a token-specific gap. A proposed global maximum equal to the
viewport width receives the same qualification without matching maximum-width
evidence. Measured references, mixed-system proposals and fixed historical
fixtures preserve their existing meaning.

## Configuration, quotas and deployment

Review the Worker name, Pages project, CORS origins, frontend CSP, provider models
and estimated prices before deploying a fork. The supplied commands target the
configured demo. Keep `global-budget-v1` stable when updating an existing
deployment: renaming it starts a different quota ledger. SQLite classes are
`QuotaCoordinator`, `AnalysisSession` and `ResourceRelay`; keep their private
bindings and existing additive migrations in `wrangler.jsonc`.

Server credentials belong only in ignored `.dev.vars` files or Cloudflare Secrets.
The frontend receives only `VITE_API_URL`. Public analysis uses
`REQUIRE_AUTH=false`; the historical `PHASE8_AUTH_TOKEN` protects administrative
budget diagnostics and retains its existing secret name. Public quotas expose no
money totals or IP identifiers. Public-mode capture diagnostics are disabled.
Operational logs omit prompts, page content, URLs and credentials.

`GET /api/providers` exposes allowlisted provider/model pairs and available
estimated prices. Models are server-controlled by `GEMINI_MODEL`,
`ANTHROPIC_MODEL`, `OPENAI_MODEL` and `XAI_MODEL`. BYOK requests use paired
`X-AI-Provider` and `X-AI-Key` HTTPS headers; bodies cannot override credentials,
provider URLs or models. Provider endpoints are fixed and reject redirects.
Only the configured shared provider/model inherits its configured demo prices;
missing BYOK prices stay unavailable. Preview aliases need explicit CORS access.

Admission atomically reserves browser time, tokens and estimated AI cost. Known
usage refunds unused allowance; uncertain attempts retain conservative amounts.
BYOK retains shared capture/admission limits but does not reserve or settle demo
AI money/tokens or affect its circuit. Only the funding marker persists, never
the key. Gemini checks the complete multimodal input with countTokens before
generation. Daily counters reset at 00:00 UTC; hourly IP windows last one hour.
The accumulated USD 30 estimated ceiling survives midnight, restart and deploy.
Failed admitted work counts toward abuse limits; invalid input fails first.

From `cloudflare-backend/`, after configuring your own credentials:

```sh
npx wrangler login
npm run types
npm run verify
# Initial provisioning only: reads .dev.vars and preserves existing random secrets.
node scripts/provision-secrets.mjs
npx wrangler deploy
```

Ordinary code deployments do not need secret reprovisioning. From `frontend/`:

```sh
VITE_API_URL=https://design-scraper-phase8.lucas-malizia27.workers.dev npm run build:pages
node ../cloudflare-backend/node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name design-scraper --branch main
```

`build:pages` requires a bare HTTPS API origin matching `public/_headers` CSP.
When deploying elsewhere, update the frontend CSP and backend CORS together.
Local tests do not establish remote CPU/memory capacity or provider availability.
Account Browser Run quotas remain shared across separate application ledgers.
Restore temporary QA overrides and check normal remote limits after deployment.

## Remote checks and live QA

These commands, run from `cloudflare-backend/`, check the deployed app and
authenticated budgets without starting an analysis:

```sh
node scripts/validate-remote.mjs
node scripts/budget-status.mjs
npm run test:pages
```

POST `/api/analyze` and `/api/mix` support ordinary JSON and streamed
`Accept: application/x-ndjson` responses. Streams contain `progress` events and
one terminal `result` or `error` event. Once streaming starts, HTTP status is 200,
so clients must inspect the terminal event. A truncated stream is incomplete and
must not auto-retry. Administrative authorization is never required for public
analysis. Cancel stops waiting and does not prove that remote work stopped.

Live QA requires a separately authorized provider/capture budget. These commands
consume real quota and are excluded from default tests:

```sh
# One single-source analysis and one mix, after checking available reservations.
node scripts/verify-pages.mjs --live
# Only the remaining mix.
MIX_SOURCE_ONE=https://example.com/ MIX_SOURCE_TWO=https://milligram.io/ node scripts/verify-pages.mjs --live --mix-only
# One single-source analysis and one mix using the local Gemini credential as BYOK.
node scripts/verify-byok.mjs --live
```

The BYOK live check allows at most USD 0.25 estimated AI cost and 180 seconds of
capture with the normal configuration, checks unchanged demo AI counters and
saves results without credentials. Other providers depend on the visitor's own
account and model access. Application measurements and estimates are never
authoritative Cloudflare or provider invoices.
