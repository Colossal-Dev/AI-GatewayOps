import { getRedisClient } from "../config/redis.js";
import { getCacheConfig } from "../config/cache.config.js";

/**
 * Resolve the Redis client dynamically.
 *
 * The Redis client is initialized by connectRedis(),
 * so it must be retrieved when each operation executes.
 */
function resolveClient(client) {
  return client || getRedisClient();
}

/**
 * Check whether Redis is connected and ready.
 */
function isClientReady(client) {
  return Boolean(client && client.isOpen);
}

/**
 * Convert Mongoose documents into plain objects.
 */
export function toPlainData(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value.toObject === "function") {
    return value.toObject();
  }

  return value;
}

/**
 * GET cache value.
 *
 * Returns:
 * - Parsed value on cache hit
 * - null on cache miss or Redis failure
 */
export async function getCache(key, options = {}) {
  if (!key) {
    return null;
  }

  const client = resolveClient(options.client);

  if (!isClientReady(client)) {
    return null;
  }

  try {
    const value = await client.get(key);

    if (value === null) {
      return null;
    }

    return JSON.parse(value);
  } catch (err) {
    console.warn(`[ConfigCache] GET failed for "${key}": ${err.message}`);

    return null;
  }
}

/**
 * SET cache value with expiration.
 *
 * Supports both:
 * setCache(key, value, { client, ttlSeconds })
 * setCache(key, value, ttlSeconds, { client })
 *
 * Returns true on success, false on failure.
 */
export async function setCache(
  key,
  value,
  ttlOrOptions,
  additionalOptions = {},
) {
  if (!key || value === null || value === undefined) {
    return false;
  }

  // Support both calling conventions.
  const options =
    typeof ttlOrOptions === "object" && ttlOrOptions !== null
      ? ttlOrOptions
      : additionalOptions;

  const ttlSeconds =
    typeof ttlOrOptions === "number" ? ttlOrOptions : options.ttlSeconds;

  const client = resolveClient(options.client);

  if (!isClientReady(client)) {
    return false;
  }

  const ttl = ttlSeconds ?? getCacheConfig().ttlSeconds;

  if (!Number.isInteger(ttl) || ttl <= 0) {
    console.warn("[ConfigCache] Invalid TTL supplied");
    return false;
  }

  try {
    const serialized = JSON.stringify(toPlainData(value));

    if (serialized === undefined) {
      return false;
    }

    await client.set(key, serialized, {
      EX: ttl,
    });

    return true;
  } catch (err) {
    console.warn(`[ConfigCache] SET failed for "${key}": ${err.message}`);

    return false;
  }
}

/**
 * DELETE one cache key.
 *
 * Returns true when a key was deleted.
 */
export async function delCache(key, options = {}) {
  if (!key) {
    return false;
  }

  const client = resolveClient(options.client);

  if (!isClientReady(client)) {
    return false;
  }

  try {
    const deleted = await client.del(key);

    return deleted > 0;
  } catch (err) {
    console.warn(`[ConfigCache] DELETE failed for "${key}": ${err.message}`);

    return false;
  }
}

/**
 * DELETE multiple cache keys.
 *
 * Returns the number of deleted keys.
 */
export async function delCacheKeys(keys, options = {}) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return 0;
  }

  const client = resolveClient(options.client);

  if (!isClientReady(client)) {
    return 0;
  }

  try {
    return await client.del(keys);
  } catch (err) {
    console.warn(`[ConfigCache] Multi-delete failed: ${err.message}`);

    return 0;
  }
}

/**
 * INVALIDATE all response cache entries belonging to a project.
 *
 * Cache key format:
 * gateway:response:<projectId>:<hash>
 *
 * Uses SCAN instead of KEYS to avoid blocking Redis.
 *
 * Returns the number of deleted keys.
 */
export async function invalidateProjectResponseCache(projectId, options = {}) {
  if (!projectId) {
    return 0;
  }

  const client = resolveClient(options.client);

  if (!isClientReady(client)) {
    return 0;
  }

  const pattern = `gateway:response:${projectId}:*`;

  let cursor = "0";
  let deletedCount = 0;

  try {
    do {
      const result = await client.scan(cursor, {
        MATCH: pattern,
        COUNT: 100,
      });

      cursor = String(result.cursor);

      if (result.keys.length > 0) {
        deletedCount += await client.del(result.keys);
      }
    } while (cursor !== "0");

    return deletedCount;
  } catch (err) {
    console.warn(
      `[ConfigCache] Project cache invalidation failed for "${projectId}": ${err.message}`,
    );

    return deletedCount;
  }
}

/**
 * GET cache value or calculate and store it.
 *
 * Useful for avoiding duplicate expensive operations.
 */
export async function getOrSetCache(key, factory, ttlSeconds, options = {}) {
  const cached = await getCache(key, options);

  if (cached !== null) {
    return cached;
  }

  if (typeof factory !== "function") {
    throw new TypeError("Cache factory must be a function");
  }

  const value = await factory();

  await setCache(key, value, ttlSeconds, options);

  return value;
}

/**
 * Generate project-level cache key.
 */
export function getProjectCacheKey(projectId, suffix = "") {
  return `gateway:project:${projectId}:${suffix}`;
}

/**
 * Generate route-level cache key.
 */
export function getRouteCacheKey(routeId, suffix = "") {
  return `gateway:route:${routeId}:${suffix}`;
}

/**
 * Generate distributed lock key.
 */
export function getLockKey(key) {
  return `gateway:lock:${key}`;
}

/**
 * Acquire a distributed Redis lock.
 *
 * Returns the lock value on success, false otherwise.
 */
export async function acquireLock(key, options = {}) {
  const client = resolveClient(options.client);

  if (!isClientReady(client)) {
    return false;
  }

  const lockTTL = options.ttlMs ?? getCacheConfig().lockTtlMs;

  const lockValue = options.lockValue ?? `${Date.now()}-${Math.random()}`;

  try {
    const result = await client.set(getLockKey(key), lockValue, {
      NX: true,
      PX: lockTTL,
    });

    return result === "OK" ? lockValue : false;
  } catch (err) {
    console.warn(`[ConfigCache] Lock acquisition failed: ${err.message}`);

    return false;
  }
}

/**
 * Release a distributed lock safely.
 *
 * Deletes the lock only if its value matches.
 */
export async function releaseLock(key, lockValue, options = {}) {
  if (!lockValue) {
    return false;
  }

  const client = resolveClient(options.client);

  if (!isClientReady(client)) {
    return false;
  }

  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;

  try {
    const result = await client.eval(script, {
      keys: [getLockKey(key)],
      arguments: [lockValue],
    });

    return result === 1;
  } catch (err) {
    console.warn(`[ConfigCache] Lock release failed: ${err.message}`);

    return false;
  }
}
