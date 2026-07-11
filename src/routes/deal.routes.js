const { Router } = require('express');
const dealController = require('../controllers/deal.controller');

const router = Router();

router.get('/', dealController.listDeals.bind(dealController));
router.get('/:id', dealController.getDeal.bind(dealController));
router.post('/:dealId/recalculate', dealController.recalculate.bind(dealController));
router.get('/:dealId/sync-status', dealController.getSyncStatus.bind(dealController));

module.exports = router;
