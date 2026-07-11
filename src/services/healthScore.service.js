class HealthScoreService {
  calculate(deal, contacts, companies) {
    let score = 0;

    if (contacts?.length > 0) {
      score += 25;
    }

    if (companies?.length > 0) {
      score += 20;
    }

    const amount = parseFloat(deal.properties?.amount) || 0;
    if (amount > 5000) {
      score += 20;
    }

    if (deal.properties?.closedate) {
      const closeDate = new Date(deal.properties.closedate);
      const now = new Date();
      const daysUntilClose = (closeDate - now) / (1000 * 60 * 60 * 24);

      if (daysUntilClose > 0 && daysUntilClose <= 30) {
        score += 15;
      }
    }

    const stage = (deal.properties?.dealstage || '').toLowerCase();
    if (!stage.includes('closedlost') && !stage.includes('closed_lost')) {
      score += 20;
    }

    return Math.min(score, 100);
  }
}

module.exports = new HealthScoreService();
