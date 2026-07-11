# HubSpot Deal Integration

Production-ready webhook integration for HubSpot deals with background processing via BullMQ/Redis, MongoDB persistence, and health score calculation.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start MongoDB:
   ```bash
   mongod
   # or use MongoDB Atlas — set MONGODB_URI in .env
   ```

3. Start Redis:
   ```bash
   redis-server
   ```

4. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your HubSpot credentials
   ```

5. Start the server:
   ```bash
   npm run dev
   ```

6. Start the background worker (separate terminal):
   ```bash
   npm run worker
   ```

7. Expose webhook URL (separate terminal):
   ```bash
   ngrok http 3000
   ```
   Copy the ngrok URL and configure it in your HubSpot Private App's Webhooks tab.

## Running Tests

```bash
# Unit tests (no infrastructure required)
npm test

# Integration tests (requires MongoDB + Redis)
RUN_INTEGRATION_TESTS=true npm test
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /webhook/hubspot | HMAC signature | Receive deal webhooks from HubSpot |
| GET | /deals | None | List last 100 synced deals |
| GET | /deals/:id | None | Get a specific deal by HubSpot ID |
| POST | /deals/:dealId/recalculate | None | Manually trigger health score recalculation |
| GET | /deals/:dealId/sync-status | None | Get sync status for a specific deal |
| GET | /webhook-events | None | List webhook events (filterable by dealId or status) |
| GET | /health | None | Health check |

## Architecture

```
HubSpot ──POST/webhook──▶ Express ──▶ BullMQ ──▶ Worker ──▶ HubSpot API
                            │            │                    │
                            ▼            ▼                    ▼
                        MongoDB      Redis              Health Score
                        (events,     (queue)            Calculation
                         deals)
```

### Layers

| Layer | Responsibility |
|-------|---------------|
| **Routes** | HTTP method/path mapping |
| **Controllers** | Parse request, send response |
| **Services** | Business logic and orchestration |
| **Repositories** | Database queries |
| **Clients** | External API calls (HubSpot SDK) |
| **Jobs** | Background processing (BullMQ workers) |
| **Middlewares** | Request validation, auth, error handling |

### Data Flow

1. HubSpot sends signed webhook POST to `/webhook/hubspot`
2. Signature verification middleware validates HMAC-SHA256
3. Controller validates payload structure via Joi
4. Service checks idempotency (composite eventKey), saves event to MongoDB, enqueues job to BullMQ
5. Worker picks up the job, fetches deal + associated contacts/companies from HubSpot API
6. Health score (0-100) is calculated based on contacts, companies, amount, close date, and stage
7. Score and sync status are written back to HubSpot as custom properties (`integration_*`)
8. MongoDB event and deal records are updated

## Project Structure

```
├── .env.example              # Environment variable template
├── server.js                 # Entry point — connects DB, starts Express
├── jest.config.js            # Jest configuration
├── jest.setup.js             # Test environment setup (env vars)
│
├── src/
│   ├── app.js                # Express app setup (middleware, routes)
│   ├── config/               # Env validation, MongoDB, Redis, Queue config
│   ├── models/               # Mongoose schemas (Deal, Event)
│   ├── routes/               # Express route definitions
│   ├── controllers/          # HTTP request handlers
│   ├── services/             # Business logic layer
│   ├── repositories/         # Database abstraction layer
│   ├── clients/              # HubSpot API client
│   ├── middlewares/          # Express middleware (auth, errors, requestId)
│   ├── validators/           # Joi validation schemas
│   ├── jobs/                 # BullMQ worker and job processors
│   ├── errors/               # Custom error classes
│   └── utils/                # Logger utilities
│
└── tests/                    # Test files
    ├── healthScore.test.js   # Unit tests for health score
    └── webhook.test.js       # Integration tests (conditional)
```

## Troubleshooting

### Server won't start
- Check MongoDB is running: `mongod --version`
- Check Redis is running: `redis-cli ping`
- Verify `.env` file exists and has all required vars
- Config validation will crash on startup if `HUBSPOT_ACCESS_TOKEN` or `HUBSPOT_CLIENT_SECRET` are missing

### Webhook signature fails
- Ensure `HUBSPOT_CLIENT_SECRET` matches your HubSpot app's client secret
- Check the request timestamp is within 5 minutes of server time
- The HMAC is computed against `req.rawBody` (exact bytes sent by HubSpot), not `JSON.stringify(req.body)`

### Jobs not processing
- Check worker is running: `npm run worker`
- Check Redis connection: `redis-cli ping`
- View failed jobs in Redis: `redis-cli --scan --pattern 'bull:deal-processing:*'`

### Deal health score is 0
- Verify the deal exists in HubSpot with valid properties
- Check the deal has associated contacts (+25) and companies (+20)
- Ensure custom properties (`integration_*`) exist in HubSpot — run `npm run setup:hubspot`