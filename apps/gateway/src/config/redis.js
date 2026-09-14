import { createClient } from 'redis';

let redisClient = null;

/**
 * Sanitizes Redis connection URL for safe logging (masks credentials).
 * @param {string} url - Raw connection URL
 * @returns {string} Sanitized URL
 */
export function sanitizeRedisUrl(url) {
  if (!url) return 'undefined';
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    // If not a standard URL, mask using regex
    return url.replace(/:\/\/[^@]+@/, '://****:****@');
  }
}

/**
 * Returns the active Redis client instance, or null if not connected.
 * @returns {import('redis').RedisClientType | null}
 */
export function getRedisClient() {
  return redisClient;
}

/**
 * Connects to Redis cache using the configured REDIS_URL environment variable.
 * @returns {Promise<import('redis').RedisClientType>}
 */
export async function connectRedis() {
  const url = process.env.REDIS_URL;

  if (!url) {
    const errorMsg = 'REDIS_URL is not defined in environment variables';
    console.error(`[Redis] Configuration error: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  const sanitizedUrl = sanitizeRedisUrl(url);

  try {
    redisClient = createClient({
      url,
      socket: {
        reconnectStrategy: false,
      },
    });

    redisClient.on('error', (err) => {
      console.error(`[Redis] Connection error: ${err.message}`);
    });

    redisClient.on('connect', () => {
      console.log(`[Redis] Connection established: ${sanitizedUrl}`);
    });

    redisClient.on('end', () => {
      console.log('[Redis] Connection disconnected');
    });

    await redisClient.connect();
    console.log('[Redis] Successfully connected to Redis');
    return redisClient;
  } catch (error) {
    console.error(`[Redis] Failed to connect to ${sanitizedUrl}: ${error.message}`);
    if (redisClient) {
      try {
        await redisClient.disconnect();
      } catch {
        // Ignore cleanup errors
      }
      redisClient = null;
    }
    throw error;
  }
}

/**
 * Disconnects from Redis cleanly.
 * @returns {Promise<void>}
 */
export async function disconnectRedis() {
  try {
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
      console.log('[Redis] Successfully disconnected from Redis');
    }
  } catch (error) {
    console.error(`[Redis] Error during disconnect: ${error.message}`);
    throw error;
  } finally {
    redisClient = null;
  }
}
