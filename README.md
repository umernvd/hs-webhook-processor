# hs-webhook-prod

handles hubspot deals (health score) and quotes (pdf + email) via webhooks, with background job queues, idempotency, and retry handling.

## what you need

- node 18+
- mongodb
- redis
- hubspot private app with the right scopes
- (for quotes) a gmail account with app password, chrome/chromium

## setup

```bash
# 1. install
npm install

# 2. env
cp .env.example .env
# fill in your hubspot token, secrets, smtp, etc

# 3. one-time: create custom deal properties in hubspot
npm run setup:hubspot

# 4. start mongodb (or use atlas — set MONGODB_URI in .env)
mongod

# 5. start redis
redis-server

# 6. start the server (terminal 2)
npm run dev

# 7. start the background worker (terminal 3)
npm run worker

# 8. expose via ngrok (terminal 4)
ngrok http 3000
# copy the url and configure in your hubspot private app's webhooks tab
```

## env vars

| Var | Default | Description |
|-----|---------|-------------|
| `NODE_ENV` | `development` | `development` or `production` |
| `PORT` | `3000` | Express server port |
| `MONGODB_URI` | `mongodb://localhost:27017/hs-webhook` | MongoDB connection string |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `HUBSPOT_ACCESS_TOKEN` | — | HubSpot Private App token (needs scopes for deals, quotes, contacts, line items, associations) |
| `HUBSPOT_CLIENT_SECRET` | — | HubSpot webhook signature secret |
| `HUBSPOT_APP_ID` | — | HubSpot app ID for webhook subscriptions |
| `QUEUE_CONCURRENCY` | `5` | BullMQ worker concurrency |
| `QUEUE_MAX_RETRIES` | `3` | Max job retry attempts |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server for quote email delivery |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username (e.g. your-email@gmail.com) |
| `SMTP_PASS` | — | SMTP app password |
| `SMTP_FROM` | `quotes@yourcompany.com` | From address for quote emails |
| `PDF_STORAGE_PATH` | `./storage/quotes` | Directory for generated PDFs |
| `WORKFLOW_SECRET` | — | Shared secret for HubSpot workflow webhook action auth |

## required hubspot scopes

Your Private App needs these scopes:
- `crm.objects.deals.read` + `crm.objects.deals.write`
- `crm.objects.quotes.read`
- `crm.objects.contacts.read`
- `crm.objects.line_items.read`
- `crm.objects.companies.read`
- `crm.schemas.deals.read` + `crm.schemas.deals.write`
- `crm.schemas.quotes.read`
- `crm.schemas.contacts.read`
- `crm.schemas.line_items.read`
- `crm.schemas.companies.read`

## api endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/webhook/hubspot` | HMAC signature | Receive deal/quote webhooks from HubSpot subscription |
| POST | `/webhook/workflow` | `WorkflowSecret` header | Receive quote-triggered webhook from HubSpot workflow action |
| GET | `/deals` | None | List last 100 synced deals |
| GET | `/deals/:id` | None | Get a specific deal by HubSpot ID |
| POST | `/deals/:dealId/recalculate` | None | Manually trigger health score recalculation |
| GET | `/deals/:dealId/sync-status` | None | Get sync status for a specific deal |
| GET | `/webhook-events?dealId=&status=` | None | List webhook events (filterable by dealId or status) |
| POST | `/quotes/:quoteId/regenerate` | None | (Re)generate PDF quote and send email. Optional body: `{ "contactId": "123" }` to override recipient |
| GET | `/health` | None | Health check — `{ status: 'ok' }` |

## how it works

### deal flow

```
hubspot ──POST/webhook/hubspot (hmac-signed)──▶ express
  │                                                  │
  │  1. verify signature                              │
  │  2. create event (idempotency via unique eventId) │
  │  3. enqueue job to bullmq                          │
  │  4. respond 200 (< 5s)                             │
  │                                                  ▼
  │                                           bullmq worker (background)
  │                                                  │
  │  5. fetch deal + contacts + companies from hubspot
  │  6. calculate health score (0-100)
  │  7. write integration_* properties back to hubspot
  │  8. save result in mongodb
```

### quote flow

```
quote created/changed in hubspot
       │
       ├── webhook subscription ──▶ POST /webhook/hubspot (hmac-signed)
       │                                  └── auto-detects 'quote' via objectType
       │
       └── workflow action ──────▶ POST /webhook/workflow (shared-secret header)
                                        └── workflow actions don't send hmac
       │
       ▼
bullmq worker (background)
  1. fetch quote + associations from hubspot
  2. find contact with email (or use overrideContactId)
  3. fetch line items via v4 associations
  4. compute subtotal = sum(qty × price)
  5. generate pdf via handlebars → puppeteer
  6. email pdf as attachment via smtp (nodemailer)
```

## project structure

```
├── .env.example
├── server.js                    # Entry point — connects DB, starts Express
├── jest.config.js
├── jest.setup.js
├── postman_collection.json
│
├── scripts/
│   └── createHubSpotProperties.js    # One-time: creates integration_* properties
│
├── tests/
│   ├── healthScore.test.js      # Unit tests (always run)
│   └── webhook.test.js          # Integration tests (conditional)
│
├── src/
│   ├── app.js                   # Express app setup
│   ├── config/
│   │   ├── index.js             # Env validation via Joi
│   │   ├── database.js          # Mongoose connection
│   │   └── queue.js             # Lazy-initialized BullMQ queue
│   │
│   ├── models/
│   │   ├── Deal.js              # Mongoose schema
│   │   ├── Event.js             # Mongoose schema
│   │   └── index.js
│   │
│   ├── routes/
│   │   ├── index.js             # Combines all route files
│   │   ├── webhook.routes.js
│   │   ├── workflow.routes.js
│   │   ├── deal.routes.js
│   │   └── quote.routes.js
│   │
│   ├── controllers/
│   │   ├── webhook.controller.js
│   │   ├── workflow.controller.js
│   │   ├── deal.controller.js
│   │   └── quote.controller.js
│   │
│   ├── services/
│   │   ├── webhook.service.js   # Idempotency + event creation + job enqueue
│   │   ├── deal.service.js      # Deal processing lifecycle
│   │   ├── healthScore.service.js # Score calculation (0-100)
│   │   ├── quote.service.js     # Quote processing (PDF + email)
│   │   ├── pdf.service.js       # Handlebars → Puppeteer → PDF
│   │   └── email.service.js     # Nodemailer SMTP transport
│   │
│   ├── repositories/
│   │   ├── event.repository.js
│   │   └── deal.repository.js
│   │
│   ├── clients/
│   │   └── hubspot.client.js    # Wraps @hubspot/api-client SDK
│   │
│   ├── templates/
│   │   └── quote.hbs            # Handlebars PDF quote template
│   │
│   ├── validators/
│   │   ├── webhook.validator.js
│   │   └── deal.validator.js
│   │
│   ├── middlewares/
│   │   ├── errorHandler.js
│   │   ├── requestId.js
│   │   ├── signatureVerification.js  # HMAC-SHA256
│   │   ├── rateLimiter.js            # 100 req/min
│   │   └── workflowAuth.js           # Shared-secret header check
│   │
│   ├── jobs/
│   │   ├── dealProcessor.job.js
│   │   ├── quoteProcessor.job.js
│   │   └── worker.js            # BullMQ Worker — routes by job name
│   │
│   ├── utils/
│   │   └── logger.js            # JSON-structured logger
│   │
│   └── errors/
│       └── customErrors.js
```

## npm scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `start` | `node server.js` | Production server |
| `dev` | `nodemon server.js` | Dev server with auto-restart |
| `worker` | `node src/jobs/worker.js` | Production worker |
| `worker:dev` | `nodemon src/jobs/worker.js` | Dev worker with auto-restart |
| `test` | `jest` | Unit tests only |
| `test:watch` | `jest --watch` | Tests in watch mode |
| `test:integration` | `RUN_INTEGRATION_TESTS=true jest` | All tests (needs infra) |
| `setup:hubspot` | `node scripts/createHubSpotProperties.js` | Create custom HubSpot properties |

## testing

```bash
# unit tests (no infrastructure needed)
npm test

# integration tests (requires mongodb + redis)
RUN_INTEGRATION_TESTS=true npm test
```

## troubleshooting

### pdf not generating
- chrome/chromium must be installed: `npx puppeteer browsers install chrome`
- check `PDF_STORAGE_PATH` is writable

### emails not sending
- verify smtp credentials — gmail requires an app password (not your regular password)
- enable 2-factor auth on the gmail account, then generate an app password

### workflow secret mismatch
- the workflow endpoint reads `req.headers['workflowsecret']` (all lowercase)
- `WORKFLOW_SECRET` in `.env` must match what hubspot sends in the `workflowsecret` header

### v4 associations api
- the v4 associations api returns `toObjectId` (not `id`) in results
- already handled in `quote.service.js` and `hubspot.client.js`

### contact not found
- quotes iterate associated contacts and pick the first one with an email
- if none has an email, the job fails with `'No associated contact has an email address'`
- you can pass `contactId` in the request body to override

### webhook signature fails
- `HUBSPOT_CLIENT_SECRET` must match your hubspot app's client secret
- request timestamp must be within 5 minutes of server time
- hmac is computed against `req.rawBody`, not `JSON.stringify(req.body)`

### jobs not processing
- check worker is running: `npm run worker`
- check redis connection: `redis-cli ping`
- view failed jobs: `redis-cli --scan --pattern 'bull:deal-processing:*'`

### deal health score is 0
- verify the deal exists in hubspot with valid properties
- check the deal has associated contacts (+25) and companies (+20)
- ensure custom properties (`integration_*`) exist — run `npm run setup:hubspot`

### server won't start
- check mongodb is running: `mongod --version`
- check redis is running: `redis-cli ping`
- verify `.env` exists with all required vars
- config validation crashes on startup if `HUBSPOT_ACCESS_TOKEN` or `HUBSPOT_CLIENT_SECRET` are missing
