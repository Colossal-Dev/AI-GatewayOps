import crypto from 'node:crypto';
import { getRedisClient } from '../config/redis.js';
import {
  getCacheConfig,
  DEFAULT_CACHE_TTL_SECONDS,
  DEFAULT_LOCK_TTL_MS,
  DEFAULT_LOCK_MAX_WAIT_MS,
  DEFAULT_LOCK_WAIT_INTERVAL_MS,
} from '../config/cache.config.js';

export {
  getCacheConfig,
  DEFAULT_CACHE_TTL_SECONDS,
  DEFAULT_LOCK_TTL_MS,
  DEFAULT_LOCK_MAX_WAIT_MS,
  DEFAULT_LOCK_WAIT_INTERVAL_MS,
};

/**
 * Lua script for safe atomic lock release.
 * Ensures the key is only deleted if the stored token matches the caller's token.
 */
const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Delays execution for a specified number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates standard Redis cache key for a project.
 * Format: gateway:cache:project:<projectId>
 *
 * @param {string} projectId
 * @returns {string}
 */
export function getProjectCacheKey(projectId) {
  return `gateway:cache:project:${projectId}`;
}

/**
 * Generates standard Redis cache key for project routes matching an HTTP method.
 * Format: gateway:cache:routes:<projectId>:<METHOD>
 *
 * @param {string} projectId
 * @param {string} method
 * @returns {string}
 */
export function getRouteCacheKey(projectId, method) {
  return `gateway:cache:routes:${projectId}:${String(method).toUpperCase()}`;
}

/**
 * Generates a distributed lock key for a target cache key.
 * Format: gateway:lock:<cacheKey>
 *
 * @param {string} cacheKey
 * @returns {string}
 */
export function getLockKey(cacheKey) {
  return `gateway:lock:${cacheKey}`;
}

/**
 * Resolves the active Redis client safely.
 * @param {object} [clientOverride]
 * @returns {import('redis').RedisClientType | null}
 */
function resolveClient(clientOverride) {
  if (clientOverride !== undefined) {
    return clientOverride;
  }
  try {
    return getRedisClient();
  } catch {
    return null;
  }
}

/**
 * Checks if the Redis client is available and open for commands.
 * @param {any} client
 * @returns {boolean}
 */
function isClientReady(client) {
  return Boolean(client && client.isOpen);
}

/**
 * Helper to identify ObjectId-like structures (Mongoose/BSON ObjectId or test mocks).
 * @param {any} val
 * @returns {boolean}
 */
function isObjectIdLike(val) {
  if (!val || typeof val !== 'object') {
    return false;
  }
  if (
    val._bsontype === 'ObjectID' ||
    val._bsontype === 'ObjectId' ||
    typeof val.toHexString === 'function' ||
    (val.constructor && val.constructor.name === 'ObjectId')
  ) {
    return true;
  }
  if (
    typeof val.toString === 'function' &&
    val.toString !== Object.prototype.toString
  ) {
    const dataKeys = Object.keys(val).filter((k) => k !== 'toString' && typeof val[k] !== 'function');
    if (dataKeys.length === 0) {
      const str = val.toString();
      if (typeof str === 'string' && str !== '[object Object]') {
        return true;
      }
    }
  }
  return false;
}

/**
 * Recursively converts a value into a predictable, clean, JSON-compatible plain data structure.
 *
 * Guarantees:
 * - Unwraps Mongoose document instances via toObject() or toJSON().
 * - Strips internal Mongoose metadata ($__, _doc, $isNew, $locals, __v).
 * - Converts ObjectId instances to standard 24-character hexadecimal strings.
 * - Converts Date instances to ISO-8601 strings.
 * - Recursively processes nested objects and arrays.
 * - Distinguishes actual circular references along ancestor paths from legitimate shared references across branches.
 * - Preserves array lengths and element positions, converting undefined, unsupported, or circular array elements to null.
 * - Excludes functions, symbols, and circular properties from plain objects.
 *
 * @param {any} value - Input value to normalize
 * @param {Set<object>} [ancestors] - Set of active ancestor objects on the current traversal path
 * @returns {any} JSON-safe plain representation
 */
export function toPlainData(value, ancestors = new Set()) {
  if (value === null || value === undefined) {
    return value;
  }

  // Primitives (string, number, boolean)
  if (typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') {
      return undefined;
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }

  // Circular reference protection: cycle detected if value is currently in the active ancestor chain
  if (ancestors.has(value)) {
    return undefined;
  }

  // Date instances -> ISO-8601 strings
  if (value instanceof Date) {
    return value.toISOString();
  }

  // ObjectId / BSON-like instances
  if (isObjectIdLike(value)) {
    return value.toString();
  }

  // Unwrap Mongoose document or subdocument
  let unwrapped = value;
  if (typeof value.toObject === 'function') {
    try {
      unwrapped = value.toObject({ depopulate: true, versionKey: false });
    } catch {
      // If toObject throws or fails, proceed with raw object
    }
  } else if (typeof value.toJSON === 'function') {
    try {
      unwrapped = value.toJSON();
    } catch {
      // If toJSON throws, proceed with raw object
    }
  }

  if (unwrapped === null || unwrapped === undefined) {
    return unwrapped;
  }
  if (typeof unwrapped !== 'object') {
    return unwrapped;
  }

  // Re-check post-unwrap in case toObject/toJSON returned Date or ObjectId
  if (unwrapped instanceof Date) {
    return unwrapped.toISOString();
  }
  if (isObjectIdLike(unwrapped)) {
    return unwrapped.toString();
  }

  // Check if unwrapped target is an active ancestor
  if (ancestors.has(unwrapped)) {
    return undefined;
  }

  // Track active ancestors along the current traversal path
  ancestors.add(value);
  const trackUnwrapped = unwrapped !== value && typeof unwrapped === 'object';
  if (trackUnwrapped) {
    ancestors.add(unwrapped);
  }

  try {
    // Arrays: recursively normalize elements while preserving array lengths and indices
    if (Array.isArray(unwrapped)) {
      return unwrapped.map((item) => {
        const normalized = toPlainData(item, ancestors);
        // JSON-compatible: undefined, functions, symbols, and circular values become null in arrays
        return normalized === undefined ? null : normalized;
      });
    }

    // Plain objects: recursively normalize keys and values
    const plain = {};
    for (const [k, v] of Object.entries(unwrapped)) {
      // Strip Mongoose internal metadata
      if (k === '__v' || k === '$__' || k === '_doc' || k === '$isNew' || k === '$locals') {
        continue;
      }
      if (typeof v === 'function' || typeof v === 'symbol') {
        continue;
      }

      const normalizedChild = toPlainData(v, ancestors);
      // In objects, undefined values (including circular references) are omitted
      if (normalizedChild !== undefined) {
        plain[k] = normalizedChild;
      }
    }

    return plain;
  } finally {
    // Backtrack: remove from active ancestor chain so sibling branches can reference the same shared object
    ancestors.delete(value);
    if (trackUnwrapped) {
      ancestors.delete(unwrapped);
    }
  }
}

/**
 * Safely retrieves and deserializes a JSON value from Redis cache.
 * Returns null on cache miss, malformed data, or Redis read failure.
 *
 * @param {string} key
 * @param {object} [options]
 * @param {object} [options.client]
 * @param {(raw: string) => any} [options.deserialize]
 * @returns {Promise<any | null>}
 */
export async function getCache(key, options = {}) {
  const client = resolveClient(options.client);
  if (!isClientReady(client)) {
    return null;
  }

  try {
    const raw = await client.get(key);
    if (raw === null || raw === undefined) {
      return null;
    }

    const deserialize = options.deserialize || JSON.parse;
    try {
      return deserialize(raw);
    } catch (parseErr) {
      console.warn(`[ConfigCache] Warning: Malformed JSON entry for key "${key}", ignoring cache: ${parseErr.message}`);
      // Remove corrupted entry asynchronously to prevent repeated parse failures
      try {
        await client.del(key);
      } catch {
        // Ignore deletion error
      }
      return null;
    }
  } catch (err) {
    console.warn(`[ConfigCache] Warning: Redis get failed for key "${key}": ${err.message}`);
    return null;
  }
}

/**
 * Safely serializes and stores a value in Redis with a TTL.
 * Never stores null or undefined values.
 * Returns true on success, false if skipped or on Redis write error.
 *
 * @param {string} key
 * @param {any} value
 * @param {object} [options]
 * @param {number} [options.ttlSeconds]
 * @param {object} [options.client]
 * @param {(val: any) => string} [options.serialize]
 * @returns {Promise<boolean>}
 */
export async function setCache(key, value, options = {}) {
  if (value === null || value === undefined) {
    return false;
  }

  const client = resolveClient(options.client);
  if (!isClientReady(client)) {
    return false;
  }

  const config = getCacheConfig();
  const ttlSeconds = Number.isInteger(options.ttlSeconds) && options.ttlSeconds > 0
    ? options.ttlSeconds
    : config.ttlSeconds;

  try {
    const plainValue = toPlainData(value);
    const serialize = options.serialize || JSON.stringify;
    const serialized = serialize(plainValue);

    await client.set(key, serialized, { EX: ttlSeconds });
    return true;
  } catch (err) {
    console.warn(`[ConfigCache] Warning: Redis set failed for key "${key}": ${err.message}`);
    return false;
  }
}

/**
 * Safely deletes a cache entry from Redis.
 *
 * @param {string} key
 * @param {object} [options]
 * @param {object} [options.client]
 * @returns {Promise<boolean>}
 */
export async function delCache(key, options = {}) {
  const client = resolveClient(options.client);
  if (!isClientReady(client)) {
    return false;
  }

  try {
    await client.del(key);
    return true;
  } catch (err) {
    console.warn(`[ConfigCache] Warning: Redis del failed for key "${key}": ${err.message}`);
    return false;
  }
}

/**
 * Safely deletes multiple cache keys from Redis.
 *
 * @param {string[]} keys
 * @param {object} [options]
 * @param {object} [options.client]
 * @returns {Promise<boolean>}
 */
export async function delCacheKeys(keys, options = {}) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return false;
  }

  const client = resolveClient(options.client);
  if (!isClientReady(client)) {
    return false;
  }

  try {
    await client.del(keys);
    return true;
  } catch (err) {
    console.warn(`[ConfigCache] Warning: Redis delKeys failed: ${err.message}`);
    return false;
  }
}

/**
 * Atomically attempts to acquire a per-key distributed lock using SET NX PX.
 *
 * Distinguishes lock contention from Redis communication failure:
 * - Returns `true` if lock was successfully acquired.
 * - Returns `false` if the key is legitimately locked by another caller (contention).
 * - Throws an Error if Redis is unavailable or the command threw an infrastructure error.
 *
 * @param {string} lockKey
 * @param {string} lockToken
 * @param {number} lockTtlMs
 * @param {object} [clientOverride]
 * @returns {Promise<boolean>}
 * @throws {Error} If Redis is disconnected, uninitialized, or command execution fails.
 */
export async function acquireLock(lockKey, lockToken, lockTtlMs, clientOverride) {
  const client = resolveClient(clientOverride);
  if (!isClientReady(client)) {
    throw new Error('Redis client is unavailable or disconnected');
  }

  try {
    const reply = await client.set(lockKey, lockToken, {
      NX: true,
      PX: lockTtlMs,
    });
    // 'OK' means lock acquired. null/false means key already exists (contention).
    return reply === 'OK' || reply === true;
  } catch (err) {
    console.warn(`[ConfigCache] Warning: Lock acquisition operation failed for "${lockKey}": ${err.message}`);
    throw err;
  }
}

/**
 * Safely releases a per-key distributed lock using atomic Lua evaluation.
 * Releases the lock ONLY if the held token matches lockToken.
 *
 * @param {string} lockKey
 * @param {string} lockToken
 * @param {object} [clientOverride]
 * @returns {Promise<boolean>}
 */
export async function releaseLock(lockKey, lockToken, clientOverride) {
  const client = resolveClient(clientOverride);
  if (!isClientReady(client)) {
    return false;
  }

  try {
    if (typeof client.eval === 'function') {
      const result = await client.eval(RELEASE_LOCK_LUA, {
        keys: [lockKey],
        arguments: [lockToken],
      });
      return Number(result) === 1;
    }

    // Fallback for mock environments without Lua eval
    const current = await client.get(lockKey);
    if (current === lockToken) {
      await client.del(lockKey);
      return true;
    }
    return false;
  } catch (err) {
    console.warn(`[ConfigCache] Warning: Lock release failed for "${lockKey}": ${err.message}`);
    throw err;
  }
}

/**
 * Cache-aside fetcher with per-key distributed locking and bounded fallback.
 *
 * Algorithm:
 * 1. Attempt reading key from Redis cache. If hit, parse and return clean data.
 * 2. On cache miss:
 *    a. If Redis is unavailable: call loader directly and return result immediately.
 *    b. If locking is disabled: call loader, cache non-null result, and return.
 *    c. If locking is enabled:
 *       - Try to acquire distributed lock atomically (SET NX PX).
 *       - If Redis fails during lock acquisition: bypass lock polling and call loader directly.
 *       - If lock acquired:
 *         - Double-check cache (in case another process populated it while waiting).
 *         - Call loader (MongoDB source of truth).
 *         - Cache successful result with configured TTL.
 *         - Safely release lock in finally block via Lua script.
 *         - Return result.
 *       - If lock held by another process (contention):
 *         - Poll cache every `lockWaitIntervalMs` up to `lockMaxWaitMs`.
 *         - If cache gets populated by holder during wait: return it.
 *         - If Redis fails during polling: break immediately and fall back to loader.
 *         - If wait times out: safely fall back to MongoDB loader directly.
 * 3. Never cache errors, null, or undefined.
 * 4. Never let Redis failures block the MongoDB loader.
 *
 * Concurrency & Lock Expiration Semantics:
 * - Distributed locking is a stampede-mitigation optimization to reduce redundant database queries.
 * - This mechanism does NOT guarantee strictly "exactly-once" loader execution under every timing condition.
 * - Specifically, if a database loader takes longer than `lockTtlMs`, the lock will expire in Redis. A subsequent
 *   concurrent request can then acquire the lock and execute the loader while the original loader is still running.
 * - Atomic token-checked Lua release ensures that when the initial slow loader eventually completes, it cannot
 *   accidentally delete the lock or corrupt state owned by the subsequent caller.
 * - Lock renewal (heartbeat/watchdog) is intentionally omitted in this phase because Gateway configuration lookups
 *   are fast indexed queries (1-10ms), while the default lock TTL (3000ms) provides a ~300x buffer.
 *
 * @template T
 * @param {string} key - Target cache key
 * @param {() => Promise<T>} loader - Database loader callback (MongoDB source of truth)
 * @param {object} [options]
 * @param {number} [options.ttlSeconds] - Configurable cache TTL (seconds)
 * @param {number} [options.lockTtlMs] - Distributed lock expiration (ms)
 * @param {number} [options.lockMaxWaitMs] - Maximum duration to wait for lock before direct fallback (ms)
 * @param {number} [options.lockWaitIntervalMs] - Polling interval while waiting for lock (ms)
 * @param {boolean} [options.useLock=true] - Whether to use distributed locking
 * @param {object} [options.client] - Redis client override (useful for testing)
 * @param {(raw: string) => any} [options.deserialize] - Custom deserializer
 * @param {(val: any) => string} [options.serialize] - Custom serializer
 * @returns {Promise<T>}
 */
export async function getOrSetCache(key, loader, options = {}) {
  if (typeof loader !== 'function') {
    throw new TypeError('getOrSetCache requires a loader function as second argument');
  }

  const client = resolveClient(options.client);

  // If Redis is not available or not open, bypass cache completely and call loader
  if (!isClientReady(client)) {
    const loaded = await loader();
    return toPlainData(loaded);
  }

  // 1. Initial Cache Check
  const cached = await getCache(key, {
    client,
    deserialize: options.deserialize,
  });
  if (cached !== null) {
    return cached;
  }

  const useLock = options.useLock !== false;

  // 2. Cache Miss without Locking
  if (!useLock) {
    const loaded = await loader();
    const plain = toPlainData(loaded);
    if (plain !== null && plain !== undefined) {
      await setCache(key, plain, {
        client,
        ttlSeconds: options.ttlSeconds,
        serialize: options.serialize,
      });
    }
    return plain;
  }

  // 3. Cache Miss with Per-Key Distributed Lock
  const config = getCacheConfig();
  const lockKey = getLockKey(key);
  const lockToken = crypto.randomUUID();
  const lockTtlMs = Number.isInteger(options.lockTtlMs) && options.lockTtlMs > 0
    ? options.lockTtlMs
    : config.lockTtlMs;
  const lockMaxWaitMs = Number.isInteger(options.lockMaxWaitMs) && options.lockMaxWaitMs > 0
    ? options.lockMaxWaitMs
    : config.lockMaxWaitMs;
  const lockWaitIntervalMs = Number.isInteger(options.lockWaitIntervalMs) && options.lockWaitIntervalMs > 0
    ? options.lockWaitIntervalMs
    : config.lockWaitIntervalMs;

  let lockAcquired = false;
  try {
    lockAcquired = await acquireLock(lockKey, lockToken, lockTtlMs, client);
  } catch (lockErr) {
    // Redis infrastructure failure: do NOT poll! Fall back immediately to MongoDB loader.
    console.warn(`[ConfigCache] Warning: Bypassing lock polling due to Redis error (${lockErr.message}). Calling loader directly.`);
    const fallbackLoaded = await loader();
    const fallbackPlain = toPlainData(fallbackLoaded);
    if (fallbackPlain !== null && fallbackPlain !== undefined) {
      await setCache(key, fallbackPlain, {
        client,
        ttlSeconds: options.ttlSeconds,
        serialize: options.serialize,
      });
    }
    return fallbackPlain;
  }

  // If lock was not acquired due to legitimate contention, wait and poll with bound
  if (!lockAcquired) {
    const startTime = Date.now();
    while (!lockAcquired && (Date.now() - startTime) < lockMaxWaitMs) {
      await sleep(lockWaitIntervalMs);

      // Check if the holding process populated the cache
      const pollCheck = await getCache(key, {
        client,
        deserialize: options.deserialize,
      });
      if (pollCheck !== null) {
        return pollCheck;
      }

      // Try acquiring again
      try {
        lockAcquired = await acquireLock(lockKey, lockToken, lockTtlMs, client);
      } catch (pollErr) {
        // If Redis throws during poll, break immediately without lingering
        console.warn(`[ConfigCache] Warning: Redis error during lock polling (${pollErr.message}). Breaking poll to load from DB.`);
        break;
      }
    }
  }

  // If we acquired the lock (we are the leader)
  if (lockAcquired) {
    try {
      // Double-check cache in case it was populated right before we acquired the lock
      const doubleCheck = await getCache(key, {
        client,
        deserialize: options.deserialize,
      });
      if (doubleCheck !== null) {
        return doubleCheck;
      }

      // Call loader (MongoDB source of truth)
      const loaded = await loader();
      const plain = toPlainData(loaded);

      // Only cache valid, non-null, non-undefined data
      if (plain !== null && plain !== undefined) {
        await setCache(key, plain, {
          client,
          ttlSeconds: options.ttlSeconds,
          serialize: options.serialize,
        });
      }

      return plain;
    } finally {
      // Ensure lock release failure does not mask a successfully loaded MongoDB result
      try {
        await releaseLock(lockKey, lockToken, client);
      } catch (releaseErr) {
        console.warn(`[ConfigCache] Warning: Failed to release lock "${lockKey}": ${releaseErr.message}`);
      }
    }
  }

  // Lock could not be acquired within max wait duration (contention timeout or poll failure):
  // Fall back safely to loader directly without blocking further
  const fallbackLoaded = await loader();
  const fallbackPlain = toPlainData(fallbackLoaded);
  if (fallbackPlain !== null && fallbackPlain !== undefined) {
    await setCache(key, fallbackPlain, {
      client,
      ttlSeconds: options.ttlSeconds,
      serialize: options.serialize,
    });
  }
  return fallbackPlain;
}
