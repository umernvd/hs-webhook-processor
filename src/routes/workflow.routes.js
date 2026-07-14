const { Router } = require('express');
const workflowController = require('../controllers/workflow.controller');
const verifyWorkflowSecret = require('../middlewares/workflowAuth');

const router = Router();

router.post(
  '/workflow',
  verifyWorkflowSecret,
  workflowController.handleWorkflowEvent.bind(workflowController)
);

module.exports = router;
