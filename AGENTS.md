# HS Webhook Prod — Project Context

## Overview

A Node.js system that listens to HubSpot deal changes via webhooks, validates them, processes them in the background via BullMQ/Redis queues, calculates a "health score" for each deal, and updates HubSpot with the result. Failures are handled with retries and exponential backoff.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Framework | Express |
| Database | MongoDB + Mongoose (ODM) |
| Queue | BullMQ (backed by Redis) |
| HubSpot SDK | @hubspot/api-client |
| Validation | Joi |
| Security | helmet, custom HMAC signature verification |
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
└── src/
    ├── app.js                  # Express app setup (middleware registration, routes)
    │
    ├── config/
    │   ├── index.js            # Reads .env, validates via Joi schema (required + defaults), exports config object
    │   ├── database.js         # Mongoose connection manager + query() helper
    │   └── queue.js            # Lazy-initialized BullMQ Queue (deal-processing)
    │
    ├── models/
    │   ├── Deal.js             # Mongoose schema: hubspotDealId, properties, healthScore, syncStatus, errorMessage
    │   ├── Event.js            # Mongoose schema: eventId (unique), eventType, status, retryCount, payload
    │   └── index.js            # Re-exports Deal + Event
    │
    ├── routes/
    │   ├── index.js            # Combines webhook + deal routes under /webhook and /deals
    │   ├── webhook.routes.js   # POST /webhook/hubspot (with signature middleware)
    │   └── deal.routes.js      # GET /deals, GET /deals/:id
    │
    ├── controllers/
    │   ├── webhook.controller.js   # Parses webhook payload, delegates to service
    │   └── deal.controller.js      # Handles deal CRUD HTTP requests
    │
    ├── services/
    │   ├── webhook.service.js      # Idempotency check, event creation, enqueue job
    │   ├── deal.service.js         # Class: processDeal(dealId, eventKey) — fetches deal+contacts+companies from HubSpot, calculates health score, updates HubSpot with integration_* properties, manages sync status lifecycle (processing→completed|failed). Also getSyncStatus(dealId).
    │   └── healthScore.service.js  # Class: calculate(deal, contacts, companies) → score 0-100. Scoring: contacts(+25), companies(+20), amount>5000(+20), closedate≤30d(+15), not closed-lost(+20)
    │
    ├── repositories/
    │   ├── event.repository.js     # Class-based: create, findByEventId, updateStatus, incrementRetryCount, findByDealId, findByStatus
    │   └── deal.repository.js      # Class-based: findByDealId, findDealByHubspotId, upsertDeal, listDeals, updateHealthScore, upsertSyncStatus
    │
    ├── clients/
    │   └── hubspot.client.js       # Singleton class wrapping @hubspot/api-client SDK calls
    │
    ├── validators/
    │   ├── webhook.validator.js    # Joi schema for incoming webhook event array
    │   └── deal.validator.js       # Joi schema for deal update payload
    │
├── middlewares/
│   ├── errorHandler.js         # Global error handler — dev/prod detail levels
│   ├── requestId.js            # Attaches UUID to req.id, sets X-Request-ID response header
│   ├── signatureVerification.js# HMAC-SHA256 verification of HubSpot webhook requests
│   └── rateLimiter.js          # 100 req/min rate limiter for /webhook/hubspot
    │
    ├── jobs/
    │   ├── dealProcessor.job.js    # Job function: processes a single deal event
    │   └── worker.js               # BullMQ Worker — separate process, consumes deal-processing queue
    │
    ├── utils/
    │   └── logger.js               # JSON-structured logger (debug/info/warn/error)
    │
    └── errors/
        └── customErrors.js         # Error classes: AppError, ValidationError, AuthenticationError,
                                    #   NotFoundError, HubSpotAPIError, RateLimitError
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

## Environment Variables (.env)

```
NODE_ENV          = development | production
PORT              = 3000
MONGODB_URI       = mongodb://localhost:27017/hs-webhook
REDIS_HOST        = localhost
REDIS_PORT        = 6379
HUBSPOT_ACCESS_TOKEN  = pat-na2-...  (HubSpot Private App token)
HUBSPOT_CLIENT_SECRET = ...          (HubSpot webhook signature secret)
HUBSPOT_APP_ID        = ...          (HubSpot app ID for webhook subscriptions)
QUEUE_CONCURRENCY = 5
QUEUE_MAX_RETRIES = 3
```

Config validation runs at startup via Joi schema — validates types, applies defaults, crashes with a descriptive error if `HUBSPOT_ACCESS_TOKEN` or `HUBSPOT_CLIENT_SECRET` are missing. Other fields fall back to sensible defaults.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /webhook/hubspot | HMAC signature | Receive deal webhooks from HubSpot |
| GET | /deals | None | List last 100 synced deals |
| GET | /deals/:id | None | Get a specific deal by HubSpot ID |
| POST | /deals/:dealId/recalculate | None | Manually trigger health score recalculation |
| GET | /deals/:dealId/sync-status | None | Get sync status for a specific deal |
| GET | /webhook-events?dealId= or ?status= | None | List webhook events with optional filters and pagination |
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
- Uses SDK methods (`crm.deals.basicApi.*`) not raw `apiRequest()`
- `getDeal` selects properties: `amount`, `dealstage`, `closedate`, `dealname`
- Error handler maps status codes → `RateLimitError` (429) or `HubSpotAPIError`
- Available methods: `getDeal`, `updateDeal`, `getAssociatedContacts`, `getAssociatedCompanies`
- To add new HubSpot API calls: add a method to this class

### Signature Verification
- Format: `SHA256(clientSecret + rawBody + timestamp)`
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

### Error Handling
- Custom error classes: `AppError`, `ValidationError` (400), `AuthenticationError` (401), `NotFoundError` (404), `HubSpotAPIError` (varies), `RateLimitError` (429)
- All custom errors have `isOperational = true` — safe to expose message
- In production: non-operational errors show "Something went wrong"
- In development: full stack traces are included in responses
- Global error handler is registered last in Express middleware chain

### Idempotency
- Composite `eventKey = ${portalId}_${subscriptionId}_${eventId}` built from HubSpot webhook fields — stored as `eventId` in MongoDB
- No separate `findByEventId` check — idempotency relies on `Event.create()` failing with error code `11000` (duplicate key on unique `eventId` field) returning `null`
- If `create()` returns `null`, event is a duplicate → skipped (returns `status: 'duplicate'`)
- This is a 1-query idempotency check (not 2) — more efficient
- Event statuses: `pending → processing → completed | failed`

### Webhook Validator (validators/webhook.validator.js)
- `validateWebhookPayload(payload)` — validates full payload array, throws `ValidationError` (400) on invalid input
- Each event validated as a Joi object with `number()` types for `objectId`, `eventId`, `subscriptionId`, `portalId`, `occurredAt`

### Controllers (webhook.controller.js, deal.controller.js)
- Both are class-based singletons: `new WebhookController()`, `new DealController()`
- **WebhookController**: `handleHubSpotWebhook` — validates payload, delegates to `WebhookService.processWebhookEvents()`, returns `{ received, count, results }`
- **DealController**: `getDeal` (GET), `listDeals` (GET), `recalculate` (POST — triggers manual job), `getSyncStatus` (GET), `getWebhookEvents` (GET — filterable, paginated)

### MongoDB Schemas
- Field naming: **camelCase** (eventId, hubspotDealId, retryCount, lastError)
- Timestamps: `createdAt`/`updatedAt` via Mongoose `timestamps: true`
- All models exported via `src/models/index.js`

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

### Repositories (event.repository.js, deal.repository.js)
- Both are class-based singletons exported via `new ClassName()`
- **EventRepository**: `create()`, `findByEventId()`, `updateStatus()`, `incrementRetryCount()`, `findByDealId()`, `findByStatus()`
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
