import { createClient } from "redis";
import {
  getCache,
  setCache,
  delCache,
} from "../apps/gateway/src/utils/cache.js";

describe("Gateway Cache - Real Redis Integration", () => {
  let redisClient;

  beforeAll(async () => {
    redisClient = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
    });

    redisClient.on("error", (err) => {
      console.error("[Redis Test Client]", err.message);
    });

    await redisClient.connect();
  });

  afterAll(async () => {
    if (redisClient?.isOpen) {
      await redisClient.quit();
    }
  });

  const testKey = "gateway:test:integration";

  beforeEach(async () => {
    await redisClient.del(testKey);
  });

  test("should write and read actual Redis cache", async () => {
    const data = {
      name: "AI GatewayOps",
      version: 1,
    };

    const stored = await setCache(testKey, data, {
      client: redisClient,
      ttlSeconds: 60,
    });

    expect(stored).toBe(true);

    const retrieved = await getCache(testKey, {
      client: redisClient,
    });

    expect(retrieved).toEqual(data);
  });

  test("should return null for a missing Redis key", async () => {
    const result = await getCache(testKey, {
      client: redisClient,
    });

    expect(result).toBeNull();
  });

  test("should delete an actual Redis cache entry", async () => {
    await setCache(
      testKey,
      { value: "delete-me" },
      {
        client: redisClient,
        ttlSeconds: 60,
      },
    );

    const deleted = await delCache(testKey, {
      client: redisClient,
    });

    expect(deleted).toBe(true);

    const result = await getCache(testKey, {
      client: redisClient,
    });

    expect(result).toBeNull();
  });

  test("should apply TTL to actual Redis cache entries", async () => {
    await setCache(
      testKey,
      { value: "expire-me" },
      {
        client: redisClient,
        ttlSeconds: 2,
      },
    );

    const ttl = await redisClient.ttl(testKey);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(2);

    await new Promise((resolve) => setTimeout(resolve, 2500));

    const result = await getCache(testKey, {
      client: redisClient,
    });

    expect(result).toBeNull();
  });
});
