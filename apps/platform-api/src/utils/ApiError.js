/**
 * Custom Error class for operational API errors.
 * Integrates directly with the centralized errorHandler middleware.
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status code (e.g. 400, 401, 403, 404, 409, 500)
   * @param {string} code - Machine-readable error code (e.g. 'INVALID_CREDENTIALS')
   * @param {string} message - Human-readable error message
   * @param {any[]} [details=[]] - Optional list of detailed errors / field validation errors
   */
  constructor(statusCode, code, message, details = []) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export default ApiError;
