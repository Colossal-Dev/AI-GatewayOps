let customLoggerHook = null;

/**
 * Sets a custom hook for capturing log entries (useful for programmatic testing).
 *
 * @param {((logData: object, logMsg: string) => void) | null} hook
 */
export function setLogHook(hook) {
  customLoggerHook = hook;
}

/**
 * Resets the custom log hook.
 */
export function resetLogHook() {
  customLoggerHook = null;
}

/**
 * Extracts sanitized request and response metadata for observability logging.
 * Strictly avoids logging sensitive headers, tokens, secrets, or request bodies.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {number} durationMs
 * @returns {object}
 */
export function extractLogData(req, res, durationMs) {
  const requestId = req.requestId || (res.getHeader ? res.getHeader('X-Request-ID') : null) || 'unknown';
  const method = req.method ? req.method.toUpperCase() : 'UNKNOWN';
  const url = req.originalUrl || req.url || req.path || '/';
  const statusCode = res.statusCode || 200;

  // Extract API key identifier only (never secret or secretHash)
  let apiKeyId = null;
  if (req.apiKey) {
    apiKeyId = req.apiKey.keyId || (req.apiKey._id ? req.apiKey._id.toString() : null) || req.apiKey.id || null;
  }

  // Extract matched route pattern if available
  let route = null;
  if (req.routeConfig) {
    route = req.routeConfig.path || null;
  }

  // Extract project ID if available
  let projectId = null;
  if (req.project) {
    projectId = req.project._id ? req.project._id.toString() : req.project.id || null;
  } else if (req.apiKey?.projectId) {
    projectId = req.apiKey.projectId.toString ? req.apiKey.projectId.toString() : req.apiKey.projectId;
  } else if (req.routeConfig?.projectId) {
    projectId = req.routeConfig.projectId.toString ? req.routeConfig.projectId.toString() : req.routeConfig.projectId;
  }

  return {
    requestId,
    method,
    url,
    statusCode,
    durationMs: Number(durationMs.toFixed(2)),
    apiKeyId,
    route,
    projectId,
  };
}

/**
 * Formats extracted log data into a clear console log string.
 *
 * @param {object} logData
 * @returns {string}
 */
export function formatLogMessage(logData) {
  const parts = [
    `[Gateway Access]`,
    `${logData.method} ${logData.url}`,
    `${logData.statusCode}`,
    `${logData.durationMs}ms`,
    `[reqId: ${logData.requestId}]`,
  ];

  if (logData.apiKeyId) {
    parts.push(`[apiKeyId: ${logData.apiKeyId}]`);
  }
  if (logData.projectId) {
    parts.push(`[projectId: ${logData.projectId}]`);
  }
  if (logData.route) {
    parts.push(`[route: ${logData.route}]`);
  }

  return parts.join(' ');
}

/**
 * Express middleware for Gateway request logging and response completion tracking.
 *
 * Requirements:
 * - Records requestId, method, url, status, duration, apiKeyId, route, projectId.
 * - Does not log sensitive headers, secrets, credentials, tokens, or bodies.
 * - Records accurately on both successful responses and error pipeline terminations.
 * - Does not interfere with request processing or swallow errors.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requestLogger(req, res, next) {
  const startTime = process.hrtime.bigint();
  let logged = false;

  const logCompletion = () => {
    if (logged) return;
    logged = true;

    try {
      const elapsedNs = process.hrtime.bigint() - startTime;
      const durationMs = Number(elapsedNs) / 1e6;
      const logData = extractLogData(req, res, durationMs);

      // Attach logData for inspection if needed
      req.logData = logData;

      const logMsg = formatLogMessage(logData);
      console.log(logMsg);

      if (typeof customLoggerHook === 'function') {
        customLoggerHook(logData, logMsg);
      }
    } catch (err) {
      console.error(`[requestLogger] Error logging request completion: ${err.message}`);
    }
  };

  if (res.once) {
    res.once('finish', logCompletion);
    res.once('close', logCompletion);
  }

  return next();
}

export { requestLogger };
export default requestLogger;
