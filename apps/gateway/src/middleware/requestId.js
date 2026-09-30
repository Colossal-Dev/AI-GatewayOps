import crypto from 'node:crypto';

/**
 * Validates whether the provided ID is a valid, safe request ID string.
 *
 * @param {unknown} id
 * @returns {boolean}
 */
export function isValidRequestId(id) {
  if (typeof id !== 'string') {
    return false;
  }
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 255) {
    return false;
  }
  // Reject control characters or newlines to prevent HTTP response splitting
  return !/[\r\n\x00-\x1f\x7f]/.test(trimmed);
}

/**
 * Express middleware for assigning and propagating correlation Request IDs.
 *
 * Requirements:
 * - Every incoming Gateway request receives a unique request ID.
 * - Prefer an incoming X-Request-ID header if present and valid.
 * - Otherwise generate a new UUID v4.
 * - Attach it to req.requestId.
 * - Return the ID in the response header: X-Request-ID.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requestId(req, res, next) {
  const rawHeader = req.get ? req.get('X-Request-ID') : req.headers?.['x-request-id'];

  let id;
  if (isValidRequestId(rawHeader)) {
    id = rawHeader.trim();
  } else {
    id = crypto.randomUUID();
  }

  req.requestId = id;

  if (req.headers) {
    req.headers['x-request-id'] = id;
  }

  if (res.setHeader && !res.headersSent) {
    res.setHeader('X-Request-ID', id);
  }

  return next();
}

export { requestId };
export default requestId;
