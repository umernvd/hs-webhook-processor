const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/app');
const config = require('../src/config');

function generateSignature(body, timestamp) {
  const sourceString = config.hubspot.clientSecret + JSON.stringify(body) + timestamp;
  return crypto.createHash('sha256').update(sourceString).digest('hex');
}

const describeIf = (condition) => condition ? describe : describe.skip;

describeIf(process.env.RUN_INTEGRATION_TESTS === 'true')('Webhook Endpoints', () => {
  const validPayload = [{
    objectId: 12345,
    eventId: 1,
    subscriptionId: 1,
    portalId: 123,
    occurredAt: Date.now(),
  }];

  test('should reject request with invalid signature', async () => {
    const timestamp = Date.now().toString();

    const response = await request(app)
      .post('/webhook/hubspot')
      .set('x-hubspot-signature-v3', 'invalid-signature')
      .set('x-hubspot-request-timestamp', timestamp)
      .send(validPayload);

    expect(response.status).toBe(401);
  });

  test('should accept valid webhook request', async () => {
    const timestamp = Date.now().toString();
    const signature = generateSignature(validPayload, timestamp);

    const response = await request(app)
      .post('/webhook/hubspot')
      .set('x-hubspot-signature-v3', signature)
      .set('x-hubspot-request-timestamp', timestamp)
      .send(validPayload);

    expect(response.status).toBe(200);
    expect(response.body.received).toBe(true);
  });

  test('should reject invalid payload', async () => {
    const timestamp = Date.now().toString();
    const invalidPayload = [{ invalid: 'data' }];
    const signature = generateSignature(invalidPayload, timestamp);

    const response = await request(app)
      .post('/webhook/hubspot')
      .set('x-hubspot-signature-v3', signature)
      .set('x-hubspot-request-timestamp', timestamp)
      .send(invalidPayload);

    expect(response.status).toBe(400);
  });

  describe('Idempotency', () => {
    test('should process duplicate event only once', async () => {
      const timestamp = Date.now().toString();
      const signature = generateSignature(validPayload, timestamp);

      const response1 = await request(app)
        .post('/webhook/hubspot')
        .set('x-hubspot-signature-v3', signature)
        .set('x-hubspot-request-timestamp', timestamp)
        .send(validPayload);

      expect(response1.status).toBe(200);

      const response2 = await request(app)
        .post('/webhook/hubspot')
        .set('x-hubspot-signature-v3', signature)
        .set('x-hubspot-request-timestamp', timestamp)
        .send(validPayload);

      expect(response2.status).toBe(200);
      expect(response2.body.results[0].status).toBe('duplicate');
    });
  });
});
