const { Router } = require('express');
const quoteController = require('../controllers/quote.controller');

const router = Router();

router.post('/:quoteId/regenerate', quoteController.regenerate.bind(quoteController));

module.exports = router;
