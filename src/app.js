const express = require('express');
const helmet = require('helmet');
const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const requestIdMiddleware = require('./middlewares/requestId');

const app = express();

app.use(helmet());

app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));

app.use(requestIdMiddleware);

app.use(routes);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use(errorHandler);

module.exports = app;
