/**
 * Cache Configuration Defaults and Environment Variable Resolvers.
 *
 * Configurable via environment variables:
 * - GATEWAY_CACHE_TTL_SECONDS / CACHE_TTL_SECONDS: Cache entry time-to-live in seconds (default: 300)
 * - GATEWAY_CACHE_LOCK_TTL_MS / CACHE_LOCK_TTL_MS: Per-key distributed lock expiration in milliseconds (default: 3000)
 * - GATEWAY_CACHE_LOCK_MAX_WAIT_MS / CACHE_LOCK_MAX_WAIT_MS: Maximum time to wait for lock before MongoDB fallback (default: 300)
 * - GATEWAY_CACHE_LOCK_WAIT_INTERVAL_MS / CACHE_LOCK_WAIT_INTERVAL_MS: Polling retry interval while waiting for lock (default: 50)
 */

export const DEFAULT_CACHE_TTL_SECONDS = 300; // 5 minutes
export const DEFAULT_LOCK_TTL_MS = 3000; // 3 seconds
export const DEFAULT_LOCK_MAX_WAIT_MS = 300; // 300 ms
export const DEFAULT_LOCK_WAIT_INTERVAL_MS = 50; // 50 ms

/**
 * Retrieves the normalized cache configuration from environment variables with safe defaults.
 *
 * @returns {{
 *   ttlSeconds: number,
 *   lockTtlMs: number,
 *   lockMaxWaitMs: number,
 *   lockWaitIntervalMs: number
 * }}
 */
export function getCacheConfig() {
  const envTtl = parseInt(process.env.GATEWAY_CACHE_TTL_SECONDS || process.env.CACHE_TTL_SECONDS || '', 10);
  const envLockTtl = parseInt(process.env.GATEWAY_CACHE_LOCK_TTL_MS || process.env.CACHE_LOCK_TTL_MS || '', 10);
  const envMaxWait = parseInt(process.env.GATEWAY_CACHE_LOCK_MAX_WAIT_MS || process.env.CACHE_LOCK_MAX_WAIT_MS || '', 10);
  const envInterval = parseInt(process.env.GATEWAY_CACHE_LOCK_WAIT_INTERVAL_MS || process.env.CACHE_LOCK_WAIT_INTERVAL_MS || '', 10);

  return {
    ttlSeconds: Number.isInteger(envTtl) && envTtl > 0 ? envTtl : DEFAULT_CACHE_TTL_SECONDS,
    lockTtlMs: Number.isInteger(envLockTtl) && envLockTtl > 0 ? envLockTtl : DEFAULT_LOCK_TTL_MS,
    lockMaxWaitMs: Number.isInteger(envMaxWait) && envMaxWait > 0 ? envMaxWait : DEFAULT_LOCK_MAX_WAIT_MS,
    lockWaitIntervalMs: Number.isInteger(envInterval) && envInterval > 0 ? envInterval : DEFAULT_LOCK_WAIT_INTERVAL_MS,
  };
}
