class AppError extends Error {
  constructor(message, statusCode, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 400);
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

class HubSpotAPIError extends AppError {
  constructor(message, statusCode = 500) {
    super(message, statusCode);
  }
}

class RateLimitError extends AppError {
  constructor(retryAfter = null) {
    super('Rate limit exceeded', 429);
    this.retryAfter = retryAfter;
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  NotFoundError,
  HubSpotAPIError,
  RateLimitError,
};
