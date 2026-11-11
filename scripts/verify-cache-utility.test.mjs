import {
  getCache,
  setCache,
  delCache,
} from "../apps/gateway/src/utils/cache.js";

// --------------------------------------------------
// Fake Redis
// --------------------------------------------------

class FakeRedis {
  constructor() {
    this.isOpen = true;
    this.store = new Map();
    this.fail = false;
  }

  async get(key) {
    if (this.fail) {
      throw new Error("Redis unavailable");
    }

    const entry = this.store.get(key);

    if (!entry) {
      return null;
    }

    // TTL expiration
    if (entry.expireAt && Date.now() >= entry.expireAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key, value, options = {}) {
    if (this.fail) {
      throw new Error("Redis unavailable");
    }

    const expireAt = options.EX ? Date.now() + options.EX * 1000 : null;

    this.store.set(key, {
      value,
      expireAt,
    });

    return "OK";
  }

  async del(key) {
    if (this.fail) {
      throw new Error("Redis unavailable");
    }

    return this.store.delete(key) ? 1 : 0;
  }
}

// --------------------------------------------------
// Cache Utility Tests
// --------------------------------------------------

describe("Gateway Cache Utility Tests", () => {
  let mockRedis;

  beforeEach(() => {
    mockRedis = new FakeRedis();
  });

  // 1. Store data
  test("should store data in cache", async () => {
    const result = await setCache(
      "user:1",
      { name: "Veer" },
      { client: mockRedis },
    );

    expect(result).toBe(true);
    expect(mockRedis.store.has("user:1")).toBe(true);
  });

  // 2. Retrieve data
  test("should retrieve cached data", async () => {
    await setCache("user:2", { name: "Rahul" }, { client: mockRedis });

    const result = await getCache("user:2", {
      client: mockRedis,
    });

    expect(result).toEqual({ name: "Rahul" });
  });

  // 3. Cache miss
  test("should return null for cache miss", async () => {
    const result = await getCache("missing:key", {
      client: mockRedis,
    });

    expect(result).toBeNull();
  });

  // 4. Delete cache
  test("should delete cached data", async () => {
    await setCache("user:3", { name: "Aman" }, { client: mockRedis });

    const result = await delCache("user:3", {
      client: mockRedis,
    });

    expect(result).toBe(true);

    expect(await getCache("user:3", { client: mockRedis })).toBeNull();
  });

  // 5. Redis get failure
  test("should handle Redis get failure", async () => {
    mockRedis.fail = true;

    const result = await getCache("user:4", {
      client: mockRedis,
    });

    expect(result).toBeNull();
  });

  // 6. Redis set failure
  test("should handle Redis set failure", async () => {
    mockRedis.fail = true;

    const result = await setCache(
      "user:5",
      { name: "Test" },
      { client: mockRedis },
    );

    expect(result).toBe(false);
  });

  // 7. Redis delete failure
  test("should handle Redis delete failure", async () => {
    await setCache("user:6", { name: "Test" }, { client: mockRedis });

    mockRedis.fail = true;

    const result = await delCache("user:6", {
      client: mockRedis,
    });

    expect(result).toBe(false);
  });

  // 8. TTL expiration
  test("should expire cached data after TTL", async () => {
    await setCache(
      "ttl:test",
      { message: "hello" },
      {
        client: mockRedis,
        ttlSeconds: 1,
      },
    );

    // Before expiration
    expect(await getCache("ttl:test", { client: mockRedis })).toEqual({
      message: "hello",
    });

    // Simulate expiration
    const entry = mockRedis.store.get("ttl:test");
    entry.expireAt = Date.now() - 1000;

    // After expiration
    expect(await getCache("ttl:test", { client: mockRedis })).toBeNull();
  });
});
