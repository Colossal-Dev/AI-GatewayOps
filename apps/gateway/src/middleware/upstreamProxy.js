/**
 * List of hop-by-hop headers that should not be forwarded between client and upstream.
 */
const HOP_BY_HOP_HEADERS = new Set([
  'x-api-key',
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
]);

/**
 * Builds the complete upstream target URL without malformed double slashes,
 * preserving dynamic path parameters and query strings.
 *
 * @param {string} upstreamBase - Upstream base URL configured on Project (e.g., 'http://localhost:3000' or 'https://api.service.internal/v1')
 * @param {string} pathname - Request pathname (e.g., '/users/123')
 * @param {string} [urlWithQuery] - Raw request URL containing query parameters if any (e.g., '/users/123?page=1')
 * @returns {string}
 */
export function buildUpstreamUrl(upstreamBase, pathname, urlWithQuery = '') {
  const cleanBase = upstreamBase.trim().replace(/\/+$/, '');
  const cleanPath = (pathname || '/').replace(/^\/+/, '');

  let targetUrl = cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;

  // Preserve query string from request if present
  if (urlWithQuery && urlWithQuery.includes('?')) {
    const queryString = urlWithQuery.substring(urlWithQuery.indexOf('?'));
    targetUrl += queryString;
  }

  return targetUrl;
}

/**
 * Middleware for forwarding authenticated and matched requests to the project's upstream service.
 *
 * Architecture:
 *   apiKeyAuth -> routeMatcher -> upstreamProxy
 *
 * Responsibilities:
 * 1. Uses req.project.upstream as the target base URL.
 * 2. Uses req.method for the HTTP request method.
 * 3. Preserves the request body for POST, PUT, PATCH, etc.
 * 4. Filters out sensitive and hop-by-hop headers (strips X-API-Key and secret).
 * 5. Preserves query string and dynamic route path.
 * 6. Forwards upstream response status, headers, and body back to the client.
 * 7. Forwards connection failures to next(error) for standard Express handling.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function upstreamProxy(req, res, next) {
  let targetUrl = '';

  try {
    const upstreamBase = req.project?.upstream;

    // Protection against missing or invalid upstream configuration
    if (!upstreamBase || typeof upstreamBase !== 'string' || !upstreamBase.trim()) {
      return res.status(502).json({
        success: false,
        error: {
          code: 'BAD_GATEWAY',
          message: 'Invalid or missing upstream configuration',
        },
      });
    }

    // Validate upstream URL format
    try {
      new URL(upstreamBase.trim());
    } catch {
      return res.status(502).json({
        success: false,
        error: {
          code: 'BAD_GATEWAY',
          message: 'Invalid upstream URL configuration',
        },
      });
    }

    const pathname = req.path || '/';
    const rawUrl = req.originalUrl || req.url || '';
    targetUrl = buildUpstreamUrl(upstreamBase, pathname, rawUrl);

    // Build forwarded headers (exclude X-API-Key and hop-by-hop headers)
    const forwardedHeaders = {};
    if (req.headers) {
      for (const [key, value] of Object.entries(req.headers)) {
        const lowerKey = key.toLowerCase();
        if (!HOP_BY_HOP_HEADERS.has(lowerKey) && value !== undefined) {
          forwardedHeaders[lowerKey] = value;
        }
      }
    }

    const method = (req.method || 'GET').toUpperCase();
    const fetchOptions = {
      method,
      headers: forwardedHeaders,
    };

    // Forward request body for mutation methods (POST, PUT, PATCH, DELETE)
    if (method !== 'GET' && method !== 'HEAD' && req.body !== undefined && req.body !== null) {
      if (Buffer.isBuffer(req.body) || typeof req.body === 'string') {
        fetchOptions.body = req.body;
      } else if (typeof req.body === 'object') {
        fetchOptions.body = JSON.stringify(req.body);
        if (!forwardedHeaders['content-type']) {
          forwardedHeaders['content-type'] = 'application/json';
        }
      }
    }

    // Execute upstream fetch
    const upstreamResponse = await fetch(targetUrl, fetchOptions);

    // Forward response status
    res.status(upstreamResponse.status);

    // Forward response headers safely (excluding hop-by-hop headers)
    upstreamResponse.headers.forEach((value, name) => {
      const lowerName = name.toLowerCase();
      if (lowerName !== 'transfer-encoding' && lowerName !== 'connection' && lowerName !== 'keep-alive') {
        res.setHeader(name, value);
      }
    });

    // Forward upstream response body as buffer to support JSON, text, or binary
    const responseArrayBuffer = await upstreamResponse.arrayBuffer();
    const responseBuffer = Buffer.from(responseArrayBuffer);

    return res.send(responseBuffer);
  } catch (error) {
    console.error(`[upstreamProxy] Upstream forwarding failure to ${targetUrl || 'upstream'}: ${error.message}`);
    return next(error);
  }
}

export { upstreamProxy };
export default upstreamProxy;
