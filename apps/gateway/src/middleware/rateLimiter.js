import { getRedisClient } from '../config/redis.js';

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_REQUESTS = 60;

/**
 * Retrieves the configured rate limit window and max requests from environment variables.
 * Falls back to sensible development defaults (60 seconds, 60 requests).
 *
 * @returns {{ windowSeconds: number, maxRequests: number }}
 */
export function getRateLimitConfig() {
  const envWindow = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS || '', 10);
  const envMax = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '', 10);

  const windowSeconds = Number.isInteger(envWindow) && envWindow > 0 ? envWindow : DEFAULT_WINDOW_SECONDS;
  const maxRequests = Number.isInteger(envMax) && envMax > 0 ? envMax : DEFAULT_MAX_REQUESTS;

  return { windowSeconds, maxRequests };
}

/**
 * Generates deterministic namespaced Redis key for rate limiting.
 * Format: gateway:ratelimit:<api-key-id>:<window>
 *
 * @param {string} apiKeyId - Authenticated API key identifier
 * @param {number} windowIndex - Fixed-window timestamp bucket index
 * @returns {string}
 */
export function getRateLimitRedisKey(apiKeyId, windowIndex) {
  return `gateway:ratelimit:${apiKeyId}:${windowIndex}`;
}

/**
 * Redis-backed rate limiting middleware for authenticated Gateway traffic.
 *
 * Architecture Position:
 *   apiKeyAuth -> rateLimiter -> routeMatcher -> upstreamProxy
 *
 * Behavior:
 * 1. Identifies the authenticated API key identity from req.apiKey.
 * 2. Uses Redis INCR and EXPIRE to maintain fixed-window request counters.
 * 3. Injects standard rate-limit headers (X-RateLimit-Limit, X-RateLimit-Remaining).
 * 4. If limit is exceeded: injects Retry-After header and returns HTTP 429 RATE_LIMIT_EXCEEDED.
 * 5. If Redis is unavailable or throws: fails safely (fails open) and logs the infrastructure warning.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function rateLimiter(req, res, next) {
  const apiKeyId = req.apiKey?.keyId || req.apiKey?._id?.toString() || req.apiKey?.id;

  // Rate limiting quota is consumed strictly by authenticated traffic
  if (!apiKeyId) {
    return next();
  }

  const { windowSeconds, maxRequests } = getRateLimitConfig();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const currentWindow = Math.floor(nowSeconds / windowSeconds);
  const redisKey = getRateLimitRedisKey(apiKeyId, currentWindow);

  let redisClient = null;
  try {
    redisClient = getRedisClient();
  } catch (err) {
    console.error(`[RateLimiter] Error retrieving Redis client: ${err.message}`);
  }

  // Gracefully handle Redis unavailability without crashing or creating in-memory fallbacks
  if (!redisClient || !redisClient.isOpen) {
    console.warn('[RateLimiter] Redis is unavailable. Allowing request to proceed.');
    return next();
  }

  try {
    const count = await redisClient.incr(redisKey);

    if (count === 1) {
      await redisClient.expire(redisKey, windowSeconds);
    }

    const remaining = Math.max(0, maxRequests - count);
    const resetSeconds = Math.max(1, ((currentWindow + 1) * windowSeconds) - nowSeconds);

    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());

    if (count > maxRequests) {
      res.setHeader('Retry-After', resetSeconds.toString());
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded. Please try again later.',
        },
      });
    }

    return next();
  } catch (error) {
    console.error(`[RateLimiter] Redis rate limiting operation failed: ${error.message}`);
    // Fail safely and consistently without exposing internal errors or crashing
    return next();
  }
}

export { rateLimiter };
export default rateLimiter;
