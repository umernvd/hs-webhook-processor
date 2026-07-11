const { AppError } = require('../errors/customErrors');

function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';

  console.error(`[${req.id}] Error:`, {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    statusCode,
  });

  if (!err.isOperational && process.env.NODE_ENV === 'production') {
    message = 'Something went wrong';
  }

  res.status(statusCode).json({
    error: {
      message,
      requestId: req.id,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}

module.exports = errorHandler;
