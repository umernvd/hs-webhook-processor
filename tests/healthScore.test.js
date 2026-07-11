const healthScoreService = require('../src/services/healthScore.service');

describe('Health Score Calculation', () => {
  test('should calculate full score correctly', () => {
    const deal = {
      properties: {
        amount: '10000',
        closedate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
        dealstage: 'qualifiedtobuy',
      }
    };

    const contacts = [{ id: '1' }];
    const companies = [{ id: '1' }];

    const score = healthScoreService.calculate(deal, contacts, companies);
    expect(score).toBe(100);
  });

  test('should give zero for minimal deal', () => {
    const deal = {
      properties: {
        dealstage: 'closedlost',
      }
    };

    const score = healthScoreService.calculate(deal, [], []);
    expect(score).toBe(0);
  });
});
