# HS Webhook Prod — Project Context

## Overview

A Node.js system that listens to HubSpot deal and quote changes via webhooks, validates them, processes them in the background via BullMQ/Redis queues, calculates a "health score" for each deal (updates HubSpot with results), and generates/emails PDF quotes to contacts. Failures are handled with retries and exponential backoff.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Framework | Express |
| Database | MongoDB + Mongoose (ODM) |
| Queue | BullMQ (backed by Redis) |
| HubSpot SDK | @hubspot/api-client |
| Validation | Joi |
| Security | helmet, express-rate-limit, custom HMAC signature verification |
| Testing | Jest + Supertest |

## Folder Structure & Responsibilities

```
hs-webhook-prod/
├── .env                        # Environment variables (gitignored)
├── .env.example                # Template with all required vars
├── .gitignore                  # Node.js standard ignores
├── AGENTS.md                   # This file — project context for AI agents
├── README.md                   # Project documentation and setup guide
├── server.js                   # Entry point — connects DB, starts Express
├── package.json
├── jest.config.js              # Jest configuration (setupFiles, testMatch, forceExit)
├── jest.setup.js               # Test env vars (HUBSPOT_ACCESS_TOKEN, HUBSPOT_CLIENT_SECRET, HUBSPOT_APP_ID)
├── postman_collection.json     # Postman collection for manual API testing
│
├── scripts/
│   └── createHubSpotProperties.js  # One-time setup: creates custom deal properties in HubSpot
│
├── tests/
│   ├── healthScore.test.js     # Unit tests for health score (always runs)
│   └── webhook.test.js         # Integration tests for webhook (conditionally skipped)
│
├── src/
│   ├── app.js                         # Express app setup (middleware registration, routes, trust proxy)
│   │
│   ├── config/
│   │   ├── index.js                   # Reads .env, validates via Joi schema (required + defaults), exports config object
│   │   ├── database.js                # Mongoose connection manager + query() helper
│   │   └── queue.js                   # Lazy-initialized BullMQ Queue (deal-processing)
│   │
│   ├── models/
│   │   ├── Deal.js                    # Mongoose schema: hubspotDealId, properties, healthScore, syncStatus, errorMessage
│   │   ├── Event.js                   # Mongoose schema: eventId (unique), eventType, status, retryCount, payload
│   │   └── index.js                   # Re-exports Deal + Event
│   │
│   ├── routes/
│   │   ├── index.js                   # Combines all route files under /webhook, /deals, /quotes
│   │   ├── webhook.routes.js          # POST /webhook/hubspot (middleware order: rateLimiter → signatureVerification → controller)
│   │   ├── workflow.routes.js         # POST /webhook/workflow (with shared-secret auth middleware)
│   │   ├── deal.routes.js             # GET /deals, GET /deals/:id
│   │   └── quote.routes.js            # POST /quotes/:quoteId/regenerate
│   │
│   ├── controllers/
│   │   ├── webhook.controller.js      # Parses webhook payload, delegates to service
│   │   ├── workflow.controller.js     # Handles HubSpot workflow webhook actions (shared-secret auth)
│   │   ├── deal.controller.js         # Handles deal CRUD HTTP requests
│   │   └── quote.controller.js        # POST /quotes/:id/regenerate — enqueues quote PDF job
│   │
│   ├── services/
│   │   ├── webhook.service.js         # Idempotency check, event creation, enqueue job. Detects quote vs deal events.
│   │   ├── deal.service.js            # Class: processDeal(dealId, eventKey) — fetches deal+contacts+companies from HubSpot, calculates health score, updates HubSpot with integration_* properties, manages sync status lifecycle (processing→completed|failed). Also getSyncStatus(dealId).
│   │   ├── healthScore.service.js     # Class: calculate(deal, contacts, companies) → score 0-100.
│   │   ├── quote.service.js           # Class: processQuote(quoteId, overrideContactId?) — fetches quote+associations+line items from HubSpot, finds contact with email, generates PDF, sends email.
│   │   ├── pdf.service.js             # Class: generateQuotePDF(quoteData) — renders Handlebars template → Puppeteer → PDF file.
│   │   └── email.service.js           # Class: sendQuoteEmail() — Nodemailer SMTP transport, sends PDF as attachment.
│   │
│   ├── repositories/
│   │   ├── event.repository.js        # Class-based: create, findByEventId, updateStatus, incrementRetryCount, findByDealId, findByStatus
│   │   └── deal.repository.js         # Class-based: findByDealId, findDealByHubspotId, upsertDeal, listDeals, updateHealthScore, upsertSyncStatus
│   │
│   ├── clients/
│   │   └── hubspot.client.js          # Singleton class wrapping @hubspot/api-client SDK calls. Methods for deals, quotes, contacts, line items, and v4 associations.
│   │
│   ├── templates/
│   │   └── quote.hbs                  # Handlebars template for PDF quote rendering (professional layout with line items table + totals)
│   │
│   ├── validators/
│   │   ├── webhook.validator.js       # Joi schema for incoming webhook event array
│   │   └── deal.validator.js          # Joi schema for deal update payload
│   │
│   ├── middlewares/
│   │   ├── errorHandler.js            # Global error handler — dev/prod detail levels
│   │   ├── requestId.js               # Attaches UUID to req.id, sets X-Request-ID response header
│   │   ├── signatureVerification.js   # HMAC-SHA256 verification of HubSpot webhook requests
│   │   ├── rateLimiter.js             # 100 req/min rate limiter for /webhook/hubspot
│   │   └── workflowAuth.js            # Shared-secret header check (req.headers.workflowsecret) for HubSpot workflow webhook actions
│   │
│   ├── jobs/
│   │   ├── dealProcessor.job.js       # Job function: processes a single deal event (health score)
│   │   ├── quoteProcessor.job.js      # Job function: processes a single quote (PDF generation + email)
│   │   └── worker.js                  # BullMQ Worker — separate process, routes jobs by name to dealProcessor or quoteProcessor
│   │
│   ├── utils/
│   │   └── logger.js                  # JSON-structured logger (debug/info/warn/error)
│   │
│   └── errors/
│       └── customErrors.js            # Error classes: AppError, ValidationError, AuthenticationError,
│                                      #   NotFoundError, HubSpotAPIError, RateLimitError
```

## Data Flow (End to End)

```
HubSpot deal changes (creation/property change)
        │
        ▼  HTTP POST (signed with HMAC-SHA256)
POST /webhook/hubspot
        │  Headers: x-hubspot-signature-v3, x-hubspot-request-timestamp
        │  Body: [ { eventId, subscriptionId, portalId, objectId, propertyName, ... } ]
        │
        ▼
1. requestId middleware        →  req.id = uuid (or from x-request-id header)
2. signatureVerification       →  HMAC matches? No → 401. Yes → continue.
3. webhook.controller          →  calls webhook.service for each event
4. webhook.service.processWebhookEvents  →  builds composite eventKey = `${portalId}_${subscriptionId}_${eventId}`
                                             calls eventRepository.create() which maps eventKey→eventId
                                             → duplicate key violation (E11000)? Return null, skip (idempotency)
                                             → new event saved (status: pending), enqueue to BullMQ
5. Respond 200 OK to HubSpot (< 5 seconds or HubSpot retries)
        │
        ▼  (background, via BullMQ Worker)
6. dealProcessor.job           →  calls deal.service.processDeal(objectId, eventId)
7. deal.service.processDeal    →  sets Deal.syncStatus = 'processing' via upsertSyncStatus
8. hubspotClient.getDeal       →  HubSpot API: GET /crm/v3/objects/deals/{id}
                                  Returns: { id, properties: { amount, dealstage, ... } }
9. hubspotClient.getAssociatedContacts → HubSpot API: associations
10. hubspotClient.getAssociatedCompanies → HubSpot API: associations
11. healthScoreService.calculate(deal, contacts, companies) → returns score 0-100
12. hubspotClient.updateDeal   →  HubSpot API: PATCH /deals/{id}
                                  Sets: integration_health_score, integration_sync_status,
                                        integration_last_synced_at, integration_error_message
13. dealRepository.upsertSyncStatus → Save healthScore + syncStatus: 'completed' in MongoDB
14. eventRepository.updateStatus → Event.status = 'completed'
        │
        ▼  (on failure at any step after step 7)
    dealRepository.upsertSyncStatus(dealId, { syncStatus: 'failed', errorMessage })
    eventRepository.updateStatus(eventId, 'failed', error.message)
    BullMQ retries job with backoff
```

### PDF Quote Flow

```
Quote created/changed in HubSpot
        │
        ├─ (via webhook subscription)                       (via workflow action)
        │  POST /webhook/hubspot                             POST /webhook/workflow
        │  Body: [ { objectId, subscriptionType, ... } ]     Body: { hs_object_id, contactId? }
        │  Auth: HMAC-SHA256 signature                       Auth: X-Workflow-Secret header
        │                                                    (HMAC not sent by workflow actions)
        ▼
1. webhook.service._getObjectType(event) → detects 'quote' via objectType or subscriptionType
2. webhook.service enqueues 'process-quote' job directly (skips eventRepository — no DB)
   ──── OR ────
   workflow.controller extracts hs_object_id, enqueues 'process-quote' job
        │
        ▼  (background, via BullMQ Worker — same queue as deals)
3. quoteProcessor.job          →  calls quoteService.processQuote(quoteId, contactId?)
4. quoteService.processQuote   →  fetches quote + associations (deals + contacts) from HubSpot
5. contact selection:
   - If overrideContactId provided → use it directly, fetch contact
   - Otherwise → iterate associated contacts, pick first one with an email
6. hubspotClient.getQuoteLineItems → v4 associations → fetch each line item by ID
7. Compute subtotal from line items: sum of (qty × price)
8. pdfService.generateQuotePDF  →  Handlebars renders quote.hbs → Puppeteer generates PDF
                                     File: storage/quotes/quote-{id}-{timestamp}.pdf
9. emailService.sendQuoteEmail  →  Nodemailer sends PDF as attachment via SMTP
10. Log success, return { success: true, quoteId }
        │
        ▼  (on failure)
    Log error, re-throw
    BullMQ retries with backoff (3 attempts)
```

## Environment Variables (.env)

```
NODE_ENV                = development | production
PORT                    = 3000
MONGODB_URI             = mongodb://localhost:27017/hs-webhook
REDIS_HOST              = localhost
REDIS_PORT              = 6379
HUBSPOT_ACCESS_TOKEN    = pat-na2-...  (HubSpot Private App token — needs scopes for deals, quotes, contacts, line items, associations)
HUBSPOT_CLIENT_SECRET   = ...          (HubSpot webhook signature secret)
HUBSPOT_APP_ID          = ...          (HubSpot app ID for webhook subscriptions)
QUEUE_CONCURRENCY       = 5
QUEUE_MAX_RETRIES       = 3
SMTP_HOST               = smtp.gmail.com   (SMTP server for quote email delivery)
SMTP_PORT               = 587
SMTP_USER               = your-email@gmail.com
SMTP_PASS               = your-app-password
SMTP_FROM               = quotes@yourcompany.com
PDF_STORAGE_PATH        = ./storage/quotes   (directory where generated PDFs are saved)
WORKFLOW_SECRET         = ...                (shared secret for HubSpot workflow webhook action auth)
```

Config validation runs at startup via Joi schema — validates types, applies defaults, crashes with a descriptive error if `HUBSPOT_ACCESS_TOKEN` or `HUBSPOT_CLIENT_SECRET` are missing. Other fields fall back to sensible defaults.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /webhook/hubspot | HMAC signature | Receive deal/quote webhooks from HubSpot subscription |
| POST | /webhook/workflow | `WorkflowSecret` header | Receive quote-triggered webhook from HubSpot workflow action |
| GET | /deals | None | List last 100 synced deals |
| GET | /deals/:id | None | Get a specific deal by HubSpot ID |
| POST | /deals/:dealId/recalculate | None | Manually trigger health score recalculation |
| GET | /deals/:dealId/sync-status | None | Get sync status for a specific deal |
| GET | /webhook-events?dealId= or ?status= | None | List webhook events with optional filters and pagination |
| POST | /quotes/:quoteId/regenerate | None | (Re)generate PDF quote and send email. Optional body: `{ "contactId": "123" }` to override recipient |
| GET | /health | None | Health check — returns `{ status: 'ok' }` |

## Key Design Decisions & Conventions

### Architecture Rules
- Each layer has ONE responsibility: route → controller → service → repository
- Controllers handle HTTP concerns only (parse request, send response)
- Services contain business logic
- Repositories abstract DB queries
- Clients abstract external API calls
- Jobs are the background processing layer

### App Setup (app.js / server.js)
- **Raw body capture**: `express.json({ verify: (req, buf) => { req.rawBody = buf.toString('utf8') } })` captures the raw request body for accurate HMAC signature verification
- **Health check**: `GET /health` returns `{ status: 'ok' }` — useful for load balancers and monitoring
- **Worker is separate**: The BullMQ worker runs in its own process (`npm run worker`), not embedded in the Express server. Server and worker each connect to MongoDB independently.
- **Graceful shutdown**: `server.js` handles SIGTERM/SIGINT — closes HTTP server, then calls `closeConnections()` (Redis/BullMQ), then `closeDatabase()` (MongoDB)
- Routes are mounted at root level (no `/api` prefix)

### HubSpot Client
- Singleton class instance exported (not a factory)
- Uses SDK methods (`crm.deals.basicApi.*`, `crm.quotes.basicApi.*`, etc.) not raw `apiRequest()`
- Error handler maps status codes → `RateLimitError` (429) or `HubSpotAPIError`
- Available methods:
  - **Deals**: `getDeal(dealId)` → `amount, dealstage, closedate, dealname`; `updateDeal(dealId, properties)` → PATCH; `listDeals(limit)` → `getPage`
  - **Quotes**: `getQuote(quoteId)` → `hs_title, hs_expiration_date, amount, hs_currency`
  - **Contacts**: `getContact(contactId)` → `email, firstname, lastname, company`
  - **Line Items**: `getQuoteLineItems(quoteId)` → v4 associations → fetch each line item by ID (`name, quantity, price, amount`)
  - **Associations (v4)**: `getAssociatedContacts(dealId)` (deal→contacts); `getAssociatedCompanies(dealId)` (deal→companies); `getQuoteAssociations(quoteId)` (quote→deals + quote→contacts via `Promise.all`)
- **Important**: v4 associations API returns `toObjectId` (not `id`) in `results[]`
- To add new HubSpot API calls: add a method to this class

### Signature Verification
- Format: `HMAC-SHA256(clientSecret, rawBody + timestamp)` — uses `crypto.createHmac('sha256', clientSecret).update(rawBody + timestamp).digest('base64')`
- Uses `req.rawBody` (captured via `express.json({ verify })` callback) instead of `JSON.stringify(req.body)` — this ensures the exact bytes HubSpot sent are used for HMAC, preventing mismatches from key reordering or number precision changes by the JSON parser
- Falls back to `JSON.stringify(req.body)` if `req.rawBody` is unavailable
- Timestamp must be within 5 minutes of server time
- Header: `x-hubspot-signature-v3` + `x-hubspot-request-timestamp`
- Uses `return next(error)` instead of `throw error` for Express error-handling portability
- Rejects with 401 if signature doesn't match or timestamp is stale

### Request ID
- Stored as `req.id` (not `req.requestId`)
- Uses incoming `x-request-id` header if present (for distributed tracing)
- Falls back to `crypto.randomUUID()`
- Sets `X-Request-ID` response header

### Rate Limiter (rateLimiter.js)
- Uses `express-rate-limit` with `standardHeaders: true`, `legacyHeaders: false`
- Window: 60 seconds, max 100 requests
- Applied to `POST /webhook/hubspot` before signature verification
- Returns 429 with `{ error: "Too many webhook requests, please try again later" }`

### Error Handling
- Custom error classes: `AppError`, `ValidationError` (400), `AuthenticationError` (401), `NotFoundError` (404), `HubSpotAPIError` (varies), `RateLimitError` (429)
- All custom errors have `isOperational = true` — safe to expose message
- In production: non-operational errors show "Something went wrong"
- In development: full stack traces are included in responses
- Global error handler is registered last in Express middleware chain

### Logger (logger.js)
- JSON-structured logger with `timestamp`, `level`, `message`, optional `meta` fields
- Uses `console.log` for info/warn/debug, `console.error` for errors (not `logger.error`) — error handler calls `console.error` directly
- Level filtering: `debug` level in development (`NODE_ENV !== 'production'`), `info` level in production
- Exports: `logger.error(msg, meta)`, `logger.warn(msg, meta)`, `logger.info(msg, meta)`, `logger.debug(msg, meta)`

### Global Error Handler (errorHandler.js)
- Registered last in Express middleware chain
- Logs via `console.error` (not logger utility), includes `requestId: req.id` and stack traces in dev
- In production: non-operational errors show `"Something went wrong"` (no stack trace)
- Returns JSON: `{ error: { message, requestId, stack? } }`

### Idempotency
- Composite `eventKey = ${portalId}_${subscriptionId}_${eventId}` built from HubSpot webhook fields — stored as `eventId` in MongoDB
- No separate `findByEventId` check — idempotency relies on `Event.create()` failing with error code `11000` (duplicate key on unique `eventId` field) returning `null`
- If `create()` returns `null`, event is a duplicate → skipped (returns `status: 'duplicate'`)
- This is a 1-query idempotency check (not 2) — more efficient
- Event statuses: `pending → processing → completed | failed`

### Webhook Validator (validators/webhook.validator.js)
- `validateWebhookPayload(payload)` — validates full payload array, throws `ValidationError` (400) on invalid input
- Each event validated as a Joi object with `number()` types for `objectId`, `eventId`, `subscriptionId`, `portalId`, `occurredAt`

### Controllers (webhook.controller.js, deal.controller.js, quote.controller.js, workflow.controller.js)
- All are class-based singletons: `new WebhookController()`, etc.
- **WebhookController**: `handleHubSpotWebhook` — validates payload, delegates to `WebhookService.processWebhookEvents()`, returns `{ received, count, results }`
- **DealController**: `getDeal` (GET), `listDeals` (GET), `recalculate` (POST — triggers manual job), `getSyncStatus` (GET), `getWebhookEvents` (GET — filterable, paginated). Deal IDs validated with `/^\d+$/` regex.
- **QuoteController**: `regenerate` (POST — enqueues `process-quote` job, accepts optional `contactId` in body)
- **WorkflowController**: `handleWorkflowEvent` (POST — extracts `hs_object_id` + optional `contactId`, enqueues `process-quote` job)

### MongoDB Schemas
- Field naming: **camelCase** (eventId, hubspotDealId, retryCount, lastError)
- Timestamps: `createdAt`/`updatedAt` via Mongoose `timestamps: true`
- All models exported via `src/models/index.js`

**Deal model** (`Deal.js`):
  - Fields: `hubspotDealId` (String, unique, indexed), `properties` (Map of String), `healthScore` (Number), `syncStatus` (String, enum: `pending, processing, completed, failed, synced`), `errorMessage` (String), `lastSyncedAt` (Date)
  - Indexes: `{ hubspotDealId: 1 }` (unique), `{ syncStatus: 1 }`

**Event model** (`Event.js`):
  - Fields: `eventId` (String, unique, indexed), `eventType` (String), `subscriptionId` (String), `portalId` (String), `objectId` (String, required), `propertyName` (String), `propertyValue` (String), `changeSource` (String), `payload` (Mixed), `status` (String, enum: `pending, processing, completed, failed`), `retryCount` (Number), `lastError` (String), `processedAt` (Date)
  - Indexes: `{ eventId: 1 }` (unique), `{ status: 1 }`, `{ objectId: 1, createdAt: -1 }`

### Database (database.js)
- `connectDatabase()` — connects Mongoose to `config.mongodbUri`. Calls `process.exit(1)` on failure.
- `closeDatabase()` — closes Mongoose connection if active.
- `query(collection, pipeline)` — helper for raw MongoDB aggregation pipelines: `mongoose.connection.db.collection(collection).aggregate(pipeline).toArray()`
- `connection` — exposes `mongoose.connection` directly

### Queue (BullMQ)
- Queue name: `deal-processing`
- **Lazy initialization** — Queue and Redis connection are created on first access (via ES6 getters on `module.exports`). No Redis connection at module load time.
- Exposed as lazy getters: `module.exports = { get connection() { ... }, get dealQueue() { ... } }`. Existing consumers (`const { dealQueue } = require()`) work unchanged — destructuring triggers the getter.
- Redis connection via `new Redis({ host, port, maxRetriesPerRequest: null, retryStrategy })` — shared between Queue and Worker via `{ connection }` export
- `retryStrategy`: exponential backoff starting at 50ms, max 2000ms (`Math.min(times * 50, 2000)`)
- Redis connection errors are silently suppressed via `connection.on('error', () => {})` — ioredis handles reconnection internally
- Default job options (set on Queue, applies to every job):
  - `attempts`: `config.queue.maxRetries` (default 3)
  - `backoff`: exponential, starting at 2 seconds
  - `removeOnComplete`: keeps completed jobs for 24h (max 1000)
  - `removeOnFail`: keeps failed jobs for 7 days
- Worker runs as a separate process (`npm run worker`)
- Worker concurrency and rate limiter configured via env vars
- Also exports `closeConnections()` (calls `dealQueue.close()` + `connection.quit()`) for graceful shutdown / SIGTERM handlers — safe to call even if queue was never initialized (null checks)

### Job Retry Behavior (dealProcessor.job.js)
- Job with 3 code paths on failure:
  1. **RateLimitError (429)**: Increments retry counter → sets event status to `pending` → re-enqueues the job via `dealQueue.add(data, { delay })` with HubSpot's `retry-after` delay — current job returns `{ success: false, reason: 'rate_limited' }` (no BullMQ retry on current job; the re-enqueued copy runs after the custom delay)
  2. **HubSpotAPIError < 500 (4xx, non-429)**: Increments retry counter → sets event status to `failed` → returns `{ success: false }` — **no retry** (client error, won't succeed on retry)
  3. **Other errors (network, 5xx, etc.)**: Increments retry counter → sets event status to `processing` → re-throws — BullMQ retries with exponential backoff
- `incrementRetryCount()` only increments the counter (no longer sets `status: 'failed'`) — status is managed separately via `updateStatus()`

### Health Score Algorithm (healthScore.service.js)
- Class method: `calculate(deal, contacts, companies)` returns score 0-100
- Scoring factors (additive, starting from 0, capped at 100):
  - Deal has ≥1 associated contact: **+25**
  - Deal has ≥1 associated company: **+20**
  - Deal amount > $5,000: **+20**
  - Close date is in the future AND within 30 days: **+15** (strictly future — `> 0` days until close, not `>= 0`)
  - Deal stage is NOT "closedlost" or "closed_lost": **+20**
- Edge cases handled: past close dates get no points, `closed_lost` variant also caught
- No side effects — easy to unit test
- To modify scoring: only edit `healthScore.service.js`

### Deal Service (deal.service.js)
- Class-based singleton: `processDeal(dealId, eventKey)`, `getSyncStatus(dealId)`
- `processDeal` manages the full lifecycle:
  1. Sets Deal syncStatus → `processing`
  2. Fetches deal + contacts + companies from HubSpot API
  3. Calculates health score via HealthScoreService
  4. Updates HubSpot with custom `integration_*` properties
  5. Saves result with syncStatus → `completed`
  6. On any error: sets syncStatus → `failed`, saves error message, re-throws

### Quote Service (quote.service.js)
- Class-based singleton: `processQuote(quoteId, overrideContactId = null)`
- Full lifecycle (no DB — one-shot job):
  1. Fetch quote (`getQuote`) + associations (`getQuoteAssociations`) from HubSpot in parallel
  2. **Contact selection**: If `overrideContactId` provided, fetch that contact directly and validate email exists. Otherwise iterate `associations.contacts`, calling `getContact` on each until one with `properties.email` is found. Throws `'No associated contact has an email address'` if none found.
  3. Fetch line items via `getQuoteLineItems` (v4 associations → fetch each by ID)
  4. Compute `subtotal` = sum of all `(qty × price)` across mapped line items (replaces `quote.properties.amount` which is often 0)
  5. Build `quoteData`: `{ hubspotQuoteId, contactName, lineItems[], subtotal, currency }`
  6. Call `pdfService.generateQuotePDF(quoteData)` → returns `{ pdfPath }`
  7. Call `emailService.sendQuoteEmail(contact.email, contactName, pdfPath, quoteId)`
  8. Log success, return `{ success: true, quoteId }`
- On error: log error, re-throw (BullMQ handles retry)

### PDF Service (pdf.service.js)
- Class-based singleton: `generateQuotePDF(quoteData)`
- Registers Handlebars helper `multiply(a, b) => (a * b).toFixed(2)` at module scope
- Steps:
  1. Read `src/templates/quote.hbs` via `fs.readFile`
  2. Compile with Handlebars, render with data (subtotal, tax=10%, total, line items, currency)
  3. Launch Puppeteer (`headless: 'new'`, `--no-sandbox`, `--disable-setuid-sandbox`)
  4. Set page content, wait for `networkidle0`
  5. Ensure `config.storage.quotesPath` directory exists (`fs.mkdir` recursive)
  6. Generate PDF to `quote-{id}-{timestamp}.pdf` (A4, 20px margins, print background)
  7. Close browser, return `{ pdfPath, html }`
- No Puppeteer pool — simple launch/close per request

### Email Service (email.service.js)
- Class-based singleton
- Constructor creates Nodemailer transporter from `config.email` (host, port, auth)
- `sendQuoteEmail(recipientEmail, recipientName, pdfPath, quoteNumber)` — sends HTML email with PDF as attachment
  - From: `config.email.from`
  - Subject: `Your Quote #{quoteNumber}`
  - Body: Polite HTML with recipient name
  - Attachment: `Quote-{quoteNumber}.pdf` (from generated PDF path)
- `verifyConnection()` — calls `transporter.verify()` for health checks/manual testing

### Quote Processor Job (quoteProcessor.job.js)
- Extracts `{ quoteId, contactId }` from `job.data`
- Calls `quoteService.processQuote(quoteId, contactId)`
- No eventRepository calls (quote events skip DB entirely — no Event documents)
- Retry behavior:
  1. **RateLimitError (429)**: Re-enqueues via `dealQueue.add(data, { delay })` with HubSpot's `retry-after` delay
  2. **HubSpotAPIError < 500 (4xx, non-429)**: Permanent fail (client error)
  3. **Other errors (network, 5xx)**: Re-throws → BullMQ exponential backoff (3 attempts)

### Workflow Endpoint (workflow.controller.js + workflowAuth middleware)
- **Why it exists**: HubSpot workflow webhook actions don't send HMAC signatures (unlike webhook subscriptions). A separate unauthenticated endpoint with shared-secret header auth is needed.
- **workflowAuth.js** — reads `req.headers['workflowsecret']`, compares against `config.workflow.secret`. Returns 401 `AuthenticationError` on mismatch/missing.
- **workflow.controller.js** — `handleWorkflowEvent(req, res, next)`:
  1. Extracts `hs_object_id` (or `objectId`) from request body
  2. Extracts optional `contactId` from request body (to override recipient)
  3. Enqueues `'process-quote'` job to deal-processing queue with `{ quoteId, contactId }`
  4. Returns 200 `{ received: true, quoteId }`
- Route: `POST /webhook/workflow` with `verifyWorkflowSecret` middleware

### Webhook Service — Quote Detection (webhook.service.js)
- `_getObjectType(event)` — determines if an incoming webhook event is for a quote or deal:
  1. If `event.objectType` exists → return it (lowercased)
  2. Else if `event.subscriptionType` includes `'quote'` → return `'quote'`
  3. Default → `'deal'`
- For quote events: **skips eventRepository entirely** (no Event document, no idempotency tracking). Enqueues `'process-quote'` directly.
- For deal events: existing behavior unchanged (Event document created, idempotency check, enqueue `'process-deal'`)

### Worker — Job Routing (worker.js)
- Single `deal-processing` queue, routes by `job.name`:
  ```js
  if (job.name === 'process-quote') return await processQuoteJob(job);
  return await processDealJob(job);
  ```
- Both server (Express) and worker (BullMQ) connect to MongoDB + Redis independently
- Worker has rate limiter: max 10 jobs/second

### Repositories (event.repository.js, deal.repository.js)
- Both are class-based singletons exported via `new ClassName()`
- **EventRepository**: `create()` (maps `eventKey→eventId`, `dealId→objectId`), `findByEventId()`, `updateStatus()`, `incrementRetryCount()`, `findByDealId()`, `findByStatus()`
- **DealRepository**: `findByDealId()`, `findDealByHubspotId()`, `upsertDeal()`, `listDeals()`, `updateHealthScore()`, `upsertSyncStatus(dealId, data)` — flexible partial update
- `upsertSyncStatus` accepts `data` with optional fields: `healthScore`, `syncStatus`, `errorMessage`
- Duplicate key errors (MongoDB code 11000) in `EventRepository.create()` return `null` instead of throwing

## Running the Project

```bash
# One-time: Create HubSpot custom properties (run once before first use)
npm run setup:hubspot            # Creates integration_* properties in HubSpot

# Terminal 1: Start MongoDB
mongod

# Terminal 2: Start Redis
redis-server

# Terminal 3: Start server
npm run dev                      # or: npm start

# Terminal 4: Start background worker
npm run worker                   # or: npm run worker:dev (with nodemon)

# Terminal 5: Start ngrok for webhook URL
ngrok http 3000
```

## npm Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `start` | `node server.js` | Production server start |
| `dev` | `nodemon server.js` | Development server with auto-restart |
| `worker` | `node src/jobs/worker.js` | Production worker start |
| `worker:dev` | `nodemon src/jobs/worker.js` | Development worker with auto-restart |
| `test` | `jest` | Run unit tests |
| `test:watch` | `jest --watch` | Run tests in watch mode |
| `test:integration` | `RUN_INTEGRATION_TESTS=true jest` | Run all tests including integration |
| `setup:hubspot` | `node scripts/createHubSpotProperties.js` | Create custom properties in HubSpot |

## Testing Conventions

- Test files live in `tests/` at project root (matched by Jest config `testMatch: ['**/tests/**/*.test.js']`)
- **jest.config.js** references `jest.setup.js` which sets `HUBSPOT_ACCESS_TOKEN` and `HUBSPOT_CLIENT_SECRET` before any test loads
- Two test files:
  - **`tests/healthScore.test.js`** — Pure unit tests for health score calculation. No infrastructure needed. Runs on every `npm test`.
  - **`tests/webhook.test.js`** — Integration tests for the webhook endpoint. Uses Supertest. **Conditionally skipped** via `describeIf(process.env.RUN_INTEGRATION_TESTS === 'true')`. Requires MongoDB + Redis to pass.
- Run tests:
  ```bash
  npm test                              # Unit tests only
  RUN_INTEGRATION_TESTS=true npm test   # All tests (needs infra)
  ```
- The `describeIf` pattern:
  ```js
  const describeIf = (condition) => condition ? describe : describe.skip;
  describeIf(process.env.RUN_INTEGRATION_TESTS === 'true')('Webhook Endpoints', () => { ... });
  ```
- Pure functions (healthScore.service) should be tested first — easiest to mock
- Mock HubSpot API calls and DB calls in unit tests

## Adding a New Feature

1. If it touches an external API → add method to `src/clients/`
2. If it reads/writes DB → add function to appropriate `src/repositories/`
3. If it has business logic → add to `src/services/`
4. If it handles HTTP → add to `src/controllers/` + `src/routes/`
5. If it runs in background → add to `src/jobs/`
6. If it needs validation → add/update Joi schema in `src/validators/`
7. Export through `src/models/index.js` if it adds a new collection

## Common Gotchas

- **Body parsing order matters**: `express.json()` must be registered before routes
- **Error handler order**: Must be registered AFTER routes (last middleware)
- **Worker is separate**: `npm run worker` starts a different Node process
- **Queue is lazy**: Redis connection is created on first `dealQueue.add()` call, not at module load. If Redis is down, the server starts fine but job enqueue will fail.
- **Worker connects DB at startup**: Worker process calls `connectDatabase()` before creating the Worker. MongoDB must be accessible from the worker process.
- **req.id vs req.requestId**: All code uses `req.id` (set by requestId.js middleware)
- **Custom properties must exist in HubSpot**: Run `npm run setup:hubspot` before processing deals. If `integration_*` properties don't exist, `updateDeal()` will return 400 and the job will fail (non-retryable).
- **SIGTERM/SIGINT**: Both server and worker handle graceful shutdown — always send a signal before killing the process to avoid connection drops.
- **Rate limited?**: The `/webhook/hubspot` endpoint has a 100 req/min rate limiter applied before signature verification. If exceeded, returns 429 with `{ error: "Too many webhook requests" }`.
- **Config validated via Joi**: Config validation uses Joi schema with types and defaults. Non-numeric values for `PORT`, `REDIS_PORT`, `QUEUE_CONCURRENCY`, `QUEUE_MAX_RETRIES` will cause startup failure.
- **Quote PDF subtotal is computed from line items, not quote.amount**: HubSpot stores the quote total in `amount` property, but it's often 0. The system instead sums `qty × price` from the associated line items to calculate subtotal, tax (10%), and total.
- **v4 associations return `toObjectId`, not `id`**: When using `crm.associations.v4.basicApi.getPage()`, the `results[]` array contains objects with `toObjectId` (not `id`). Both `getQuoteLineItems` and `getQuoteAssociations` consumers read `toObjectId`.
- **Quote events bypass MongoDB entirely**: No Event document is created for quote webhooks. The job is enqueued directly. No idempotency tracking for quote events — BullMQ's retry mechanism handles duplicates, and manual `regenerate` is intentionally repeatable.
- **Two ways to trigger quote processing**: (1) HubSpot webhook subscription → `POST /webhook/hubspot` (auto-detects quote via `_getObjectType`), (2) HubSpot workflow action → `POST /webhook/workflow` (shared-secret auth via `X-Workflow-Secret` header). Workflow actions don't send HMAC signatures.
- **Contact selection fallback**: When no `contactId` is provided, quotes iterate the associated contacts and pick the **first one with an email address**. If none has an email, the job fails with `'No associated contact has an email address'`.
- **Chrome/Chromium required for PDF generation**: Puppeteer needs a Chrome binary. Install with `npx puppeteer browsers install chrome` if not present. The `--no-sandbox` flag is set for headless operation.
