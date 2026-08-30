import env from '../config/env.js';

/**
 * Centralized error-handling middleware.
 * Formats all unhandled errors into a standardized JSON error response.
 * Keeps stack traces in server logs and never exposes them in HTTP responses.
 *
 * @param {Error & { statusCode?: number, status?: number, code?: string, details?: any[] }} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  const statusCode = Number.isInteger(err.statusCode || err.status)
    ? err.statusCode || err.status
    : 500;

  const isServerError = statusCode >= 500;

  let message = err.message || 'An unexpected error occurred.';
  let code = err.code || (isServerError ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST');
  let details = Array.isArray(err.details) ? err.details : [];

  // In production, mask internal server error message
  if (env.isProduction && isServerError) {
    message = 'An internal server error occurred.';
    code = 'INTERNAL_SERVER_ERROR';
    details = [];
  }

  // Always log server errors with full stack trace on the server side
  if (isServerError) {
    console.error(`[Error] [${req.method} ${req.originalUrl}] ${err.stack || err.message}`);
  }

  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details,
    },
  });
};

export default errorHandler;
