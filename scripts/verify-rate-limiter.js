import http from 'node:http';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import app from '../apps/gateway/src/app.js';
import APIKey from '../apps/gateway/src/models/api-key.model.js';
import Project from '../apps/gateway/src/models/project.model.js';
import Route from '../apps/gateway/src/models/route.model.js';
import { setRedisClient, getRedisClient } from '../apps/gateway/src/config/redis.js';

/**
 * Creates an in-memory Redis client mock for deterministic, dependency-free verification.
 */
function createMockRedisClient() {
  const store = new Map(); // key -> { value: number, expireAt: number | null }
  const operations = [];

  const client = {
    isOpen: true,
    getStore: () => store,
    getOperations: () => [...operations],
    clearStore: () => {
      store.clear();
      operations.length = 0;
    },
    async incr(key) {
      if (!this.isOpen) {
        throw new Error('Redis connection is closed');
      }
      operations.push({ op: 'incr', key, time: Date.now() });
      const entry = store.get(key);
      const now = Date.now();

      if (!entry || (entry.expireAt !== null && entry.expireAt <= now)) {
        store.set(key, { value: 1, expireAt: null });
        return 1;
      }

      entry.value += 1;
      return entry.value;
    },
    async expire(key, seconds) {
      if (!this.isOpen) {
        throw new Error('Redis connection is closed');
      }
      operations.push({ op: 'expire', key, seconds, time: Date.now() });
      const entry = store.get(key);
      if (!entry) return 0;
      entry.expireAt = Date.now() + (seconds * 1000);
      return 1;
    },
    async ttl(key) {
      if (!this.isOpen) {
        throw new Error('Redis connection is closed');
      }
      operations.push({ op: 'ttl', key, time: Date.now() });
      const entry = store.get(key);
      const now = Date.now();
      if (!entry || (entry.expireAt !== null && entry.expireAt <= now)) {
        return -2;
      }
      if (entry.expireAt === null) {
        return -1;
      }
      const remainingMs = entry.expireAt - now;
      return Math.max(0, Math.ceil(remainingMs / 1000));
    },
    async get(key) {
      if (!this.isOpen) {
        throw new Error('Redis connection is closed');
      }
      operations.push({ op: 'get', key, time: Date.now() });
      const entry = store.get(key);
      const now = Date.now();
      if (!entry || (entry.expireAt !== null && entry.expireAt <= now)) {
        return null;
      }
      return entry.value.toString();
    },
    async del(key) {
      if (!this.isOpen) {
        throw new Error('Redis connection is closed');
      }
      operations.push({ op: 'del', key, time: Date.now() });
      const deleted = store.delete(key);
      return deleted ? 1 : 0;
    },
  };

  return client;
}

// Starts Gateway Express server on an ephemeral port
function startGatewayServer() {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        server,
        baseUrl,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

// Starts local mock upstream server
function startMockUpstreamServer() {
  let requestCount = 0;
  let lastReceivedRequest = null;

  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });

    req.on('end', () => {
      requestCount += 1;
      lastReceivedRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: rawBody,
      };

      res.writeHead(200, {
        'content-type': 'application/json',
        'x-upstream-service': 'mock-upstream-v1',
      });
      res.end(JSON.stringify({ success: true, source: 'mock-upstream', url: req.url }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        server,
        baseUrl,
        getRequestCount: () => requestCount,
        getLastRequest: () => lastReceivedRequest,
        reset: () => {
          requestCount = 0;
          lastReceivedRequest = null;
        },
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

async function runRateLimiterVerification() {
  console.log('=== AI-GatewayOps: Redis-Backed API Rate Limiter Verification ===\n');

  const upstream = await startMockUpstreamServer();
  const gateway = await startGatewayServer();
  const mockRedis = createMockRedisClient();
  const originalRedisClient = getRedisClient();
  setRedisClient(mockRedis);

  // Setup test secrets and mock entities
  const testSecret = 'sec_live_ratelimit_test_secret_123';
  const hashedSecret = await bcrypt.hash(testSecret, 10);
  const projectId = '64abc1234567890123456789';

  const mockProject = {
    _id: projectId,
    id: projectId,
    name: 'Rate Limit Test Project',
    status: 'active',
    upstream: upstream.baseUrl,
  };

  const mockApiKey1 = {
    _id: 'key_doc_1',
    keyId: 'gw_key_alpha',
    projectId,
    secretHash: hashedSecret,
    status: 'active',
  };

  const mockApiKey2 = {
    _id: 'key_doc_2',
    keyId: 'gw_key_beta',
    projectId,
    secretHash: hashedSecret,
    status: 'active',
  };

  const mockApiKeyExpiry = {
    _id: 'key_doc_3',
    keyId: 'gw_key_expiry_test',
    projectId,
    secretHash: hashedSecret,
    status: 'active',
  };

  const mockRoutes = [
    {
      _id: 'route_users',
      projectId,
      path: '/users/123',
      method: 'GET',
    },
    {
      _id: 'route_orders',
      projectId,
      path: '/orders',
      method: 'GET',
    },
  ];

  // Mock DB model methods
  const originalApiKeyFindOne = APIKey.findOne;
  const originalProjectFindById = Project.findById;
  const originalRouteFind = Route.find;

  APIKey.findOne = async (query) => {
    if (query?.keyId === mockApiKey1.keyId) return mockApiKey1;
    if (query?.keyId === mockApiKey2.keyId) return mockApiKey2;
    if (query?.keyId === mockApiKeyExpiry.keyId) return mockApiKeyExpiry;
    return null;
  };

  Project.findById = async (id) => {
    if (id === projectId) return mockProject;
    return null;
  };

  Route.find = async (query) => {
    const { projectId: pId, method } = query;
    return mockRoutes.filter((r) => r.projectId === pId && r.method === method);
  };

  try {
    // -----------------------------------------------------------------------
    // Test 1: Health endpoint does NOT consume rate-limit quota
    // -----------------------------------------------------------------------
    {
      console.log('[Test 1] Health Endpoint (/api/health and /health)');
      mockRedis.clearStore();
      upstream.reset();

      const resApi = await fetch(`${gateway.baseUrl}/api/health`);
      const bodyApi = await resApi.json();
      assert.equal(resApi.status, 200, 'GET /api/health must return 200');
      assert.equal(bodyApi.status, 'ok');

      const resRoot = await fetch(`${gateway.baseUrl}/health`);
      const bodyRoot = await resRoot.json();
      assert.equal(resRoot.status, 200, 'GET /health must return 200');
      assert.equal(bodyRoot.status, 'ok');

      assert.equal(mockRedis.getStore().size, 0, 'Health check must not create any Redis rate-limit keys');
      assert.equal(upstream.getRequestCount(), 0, 'Upstream must not be contacted for health endpoints');
      console.log('  -> PASS: Health endpoints return 200 and consume NO rate-limit quota\n');
    }

    // -----------------------------------------------------------------------
    // Test 2: Valid API key, request under limit reaches upstream
    // -----------------------------------------------------------------------
    {
      console.log('[Test 2] Valid API Key Request Under Limit');
      process.env.RATE_LIMIT_WINDOW_SECONDS = '60';
      process.env.RATE_LIMIT_MAX_REQUESTS = '3';
      mockRedis.clearStore();
      upstream.reset();

      const res = await fetch(`${gateway.baseUrl}/proxy/users/123`, {
        headers: { 'X-API-Key': `${mockApiKey1.keyId}.${testSecret}` },
      });
      const body = await res.json();

      assert.equal(res.status, 200, 'Request under limit must return HTTP 200');
      assert.equal(body.source, 'mock-upstream', 'Response must come from upstream');
      assert.equal(upstream.getRequestCount(), 1, 'Upstream must receive exactly 1 request');
      assert.equal(res.headers.get('x-ratelimit-limit'), '3', 'X-RateLimit-Limit header must be 3');
      assert.equal(res.headers.get('x-ratelimit-remaining'), '2', 'X-RateLimit-Remaining header must be 2');
      console.log('  -> PASS: Request allowed, headers injected (Limit: 3, Remaining: 2), upstream reached\n');
    }

    // -----------------------------------------------------------------------
    // Test 3: Multiple requests under the limit (up to capacity)
    // -----------------------------------------------------------------------
    {
      console.log('[Test 3] Multiple Requests Under Limit');
      // 2nd request
      const res2 = await fetch(`${gateway.baseUrl}/proxy/users/123`, {
        headers: { 'X-API-Key': `${mockApiKey1.keyId}.${testSecret}` },
      });
      assert.equal(res2.status, 200, '2nd request must return HTTP 200');
      assert.equal(res2.headers.get('x-ratelimit-remaining'), '1', 'Remaining must be 1');

      // 3rd request (last allowed in window)
      const res3 = await fetch(`${gateway.baseUrl}/proxy/users/123`, {
        headers: { 'X-API-Key': `${mockApiKey1.keyId}.${testSecret}` },
      });
      assert.equal(res3.status, 200, '3rd request must return HTTP 200');
      assert.equal(res3.headers.get('x-ratelimit-remaining'), '0', 'Remaining must be 0');
      assert.equal(upstream.getRequestCount(), 3, 'Upstream must receive all 3 requests');
      console.log('  -> PASS: All 3 requests under limit succeeded and reached upstream\n');
    }

    // -----------------------------------------------------------------------
    // Test 4: Request exceeding the limit (HTTP 429 RATE_LIMIT_EXCEEDED)
    // -----------------------------------------------------------------------
    {
      console.log('[Test 4] Request Exceeding Rate Limit (HTTP 429)');
      const initialUpstreamCount = upstream.getRequestCount();

      // 4th request (exceeds limit of 3)
      const res4 = await fetch(`${gateway.baseUrl}/proxy/users/123`, {
        headers: { 'X-API-Key': `${mockApiKey1.keyId}.${testSecret}` },
      });
      const body4 = await res4.json();

      assert.equal(res4.status, 429, 'Exceeded request must return HTTP 429');
      assert.equal(body4.success, false, 'Body success must be false');
      assert.equal(body4.error?.code, 'RATE_LIMIT_EXCEEDED', 'Error code must be RATE_LIMIT_EXCEEDED');
      assert.equal(res4.headers.get('x-ratelimit-limit'), '3', 'Limit header must be 3');
      assert.equal(res4.headers.get('x-ratelimit-remaining'), '0', 'Remaining header must be 0');
      assert.ok(res4.headers.get('retry-after'), 'Retry-After header must be set');
      assert.ok(parseInt(res4.headers.get('retry-after'), 10) > 0, 'Retry-After must be a positive integer');

      // Crucial: Upstream must NOT be reached
      assert.equal(upstream.getRequestCount(), initialUpstreamCount, 'Upstream must NOT be contacted when rate limited');
      console.log('  -> PASS: 429 RATE_LIMIT_EXCEEDED returned, Retry-After header present, upstream untouched\n');
    }

    // -----------------------------------------------------------------------
    // Test 5: Verify Redis counter is actually being used
    // -----------------------------------------------------------------------
    {
      console.log('[Test 5] Verify Redis Counter Usage and Key Format');
      const nowSeconds = Math.floor(Date.now() / 1000);
      const currentWindow = Math.floor(nowSeconds / 60);
      const expectedKey = `gateway:ratelimit:${mockApiKey1.keyId}:${currentWindow}`;

      const storedVal = await mockRedis.get(expectedKey);
      assert.equal(storedVal, '4', 'Redis key must hold current counter value (4)');

      const ttl = await mockRedis.ttl(expectedKey);
      assert.ok(ttl > 0, 'Redis key must have active TTL expiration set');

      const operations = mockRedis.getOperations();
      const incrOps = operations.filter((op) => op.op === 'incr' && op.key === expectedKey);
      const expireOps = operations.filter((op) => op.op === 'expire' && op.key === expectedKey);

      assert.equal(incrOps.length, 4, 'Redis INCR must have been called 4 times on key');
      assert.ok(expireOps.length >= 1, 'Redis EXPIRE must have been set on initial increment');
      console.log(`  -> PASS: Verified Redis counter "${expectedKey}" = 4 with TTL = ${ttl}s\n`);
    }

    // -----------------------------------------------------------------------
    // Test 6: Verify separate API keys have separate rate-limit buckets
    // -----------------------------------------------------------------------
    {
      console.log('[Test 6] Bucket Separation Between API Keys');
      // mockApiKey1 is currently rate limited. Now send request with mockApiKey2.
      const resApiKey2 = await fetch(`${gateway.baseUrl}/proxy/users/123`, {
        headers: { 'X-API-Key': `${mockApiKey2.keyId}.${testSecret}` },
      });
      const bodyApiKey2 = await resApiKey2.json();

      assert.equal(resApiKey2.status, 200, 'API Key 2 must be allowed even when API Key 1 is rate limited');
      assert.equal(bodyApiKey2.source, 'mock-upstream');
      assert.equal(resApiKey2.headers.get('x-ratelimit-remaining'), '2', 'API Key 2 has its own remaining quota (2)');

      // Verify API Key 1 is STILL rate limited
      const resApiKey1Again = await fetch(`${gateway.baseUrl}/proxy/users/123`, {
        headers: { 'X-API-Key': `${mockApiKey1.keyId}.${testSecret}` },
      });
      assert.equal(resApiKey1Again.status, 429, 'API Key 1 must remain rate limited');

      const nowSeconds = Math.floor(Date.now() / 1000);
      const currentWindow = Math.floor(nowSeconds / 60);
      const key1 = `gateway:ratelimit:${mockApiKey1.keyId}:${currentWindow}`;
      const key2 = `gateway:ratelimit:${mockApiKey2.keyId}:${currentWindow}`;

      assert.equal(await mockRedis.get(key1), '5');
      assert.equal(await mockRedis.get(key2), '1');
      console.log('  -> PASS: Separate API keys maintain completely isolated rate limit buckets in Redis\n');
    }

    // -----------------------------------------------------------------------
    // Test 7: Verify counter expires after configured window
    // -----------------------------------------------------------------------
    {
      console.log('[Test 7] Counter Expiration Across Configured Window');
      // Configure 1-second window and limit of 1 request
      process.env.RATE_LIMIT_WINDOW_SECONDS = '1';
      process.env.RATE_LIMIT_MAX_REQUESTS = '1';

      // 1st request with mockApiKeyExpiry: allowed
      const res1 = await fetch(`${gateway.baseUrl}/proxy/users/123`, {
        headers: { 'X-API-Key': `${mockApiKeyExpiry.keyId}.${testSecret}` },
      });
      assert.equal(res1.status, 200, 'Initial request in window 1 must be allowed');

      // 2nd request in same window: rate-limited
      const res2 = await fetch(`${gateway.baseUrl}/proxy/users/123`, {
        headers: { 'X-API-Key': `${mockApiKeyExpiry.keyId}.${testSecret}` },
      });
      assert.equal(res2.status, 429, 'Subsequent request in same 1-second window must be 429');

      // Wait 1.15 seconds for fixed window to roll over
      console.log('  -> Waiting for 1-second window to roll over...');
      await new Promise((r) => setTimeout(r, 1150));

      // 3rd request in next window: should be allowed again
      const res3 = await fetch(`${gateway.baseUrl}/proxy/users/123`, {
        headers: { 'X-API-Key': `${mockApiKeyExpiry.keyId}.${testSecret}` },
      });
      assert.equal(res3.status, 200, 'Request in next window must be allowed after expiry');
      console.log('  -> PASS: Rate limit reset after window elapsed\n');

      // Restore env vars
      process.env.RATE_LIMIT_WINDOW_SECONDS = '60';
      process.env.RATE_LIMIT_MAX_REQUESTS = '60';
    }

    // -----------------------------------------------------------------------
    // Test 8: Unauthenticated request rejection does NOT create rate-limit bucket
    // -----------------------------------------------------------------------
    {
      console.log('[Test 8] Unauthenticated Request Rejection');
      mockRedis.clearStore();
      upstream.reset();

      // Missing API key
      const resMissing = await fetch(`${gateway.baseUrl}/proxy/users/123`);
      const bodyMissing = await resMissing.json();

      assert.equal(resMissing.status, 401, 'Missing API key must return 401');
      assert.equal(bodyMissing.error?.code, 'UNAUTHORIZED');

      // Invalid secret format
      const resInvalid = await fetch(`${gateway.baseUrl}/proxy/users/123`, {
        headers: { 'X-API-Key': 'malformed_key_header_without_dot' },
      });
      assert.equal(resInvalid.status, 401, 'Malformed API key must return 401');

      // Verify no rate limit bucket was created in Redis
      assert.equal(mockRedis.getStore().size, 0, 'Unauthenticated requests must not create Redis keys');
      assert.equal(upstream.getRequestCount(), 0, 'Upstream must not be contacted');
      console.log('  -> PASS: Unauthenticated requests return 401 without creating Redis buckets\n');
    }

    // -----------------------------------------------------------------------
    // Test 9: Middleware execution order verification
    // -----------------------------------------------------------------------
    {
      console.log('[Test 9] Middleware Execution Order (apiKeyAuth -> rateLimiter -> routeMatcher -> upstreamProxy)');
      process.env.RATE_LIMIT_WINDOW_SECONDS = '60';
      process.env.RATE_LIMIT_MAX_REQUESTS = '1';
      mockRedis.clearStore();
      upstream.reset();

      // Step A: apiKeyAuth runs before rateLimiter
      // An invalid key is rejected with 401 and creates NO Redis rate limit entry
      const resA = await fetch(`${gateway.baseUrl}/proxy/users/123`, {
        headers: { 'X-API-Key': `${mockApiKey1.keyId}.invalid_secret` },
      });
      assert.equal(resA.status, 401, 'apiKeyAuth must run first and reject bad secret');
      assert.equal(mockRedis.getStore().size, 0, 'rateLimiter must not run if apiKeyAuth fails');

      // Step B: rateLimiter runs before routeMatcher
      // Send 1 valid request to consume quota
      const resB1 = await fetch(`${gateway.baseUrl}/proxy/users/123`, {
        headers: { 'X-API-Key': `${mockApiKey1.keyId}.${testSecret}` },
      });
      assert.equal(resB1.status, 200);

      // Send 2nd request to an UNMATCHED route (/nonexistent/path)
      // Since rateLimiter runs before routeMatcher, it must return 429 (not 404!)
      const resB2 = await fetch(`${gateway.baseUrl}/proxy/nonexistent/path`, {
        headers: { 'X-API-Key': `${mockApiKey1.keyId}.${testSecret}` },
      });
      const bodyB2 = await resB2.json();
      assert.equal(resB2.status, 429, 'rateLimiter must block request with 429 before routeMatcher checks path');
      assert.equal(bodyB2.error?.code, 'RATE_LIMIT_EXCEEDED');

      // Step C: routeMatcher runs before upstreamProxy
      // Reset rate limit for a new key, request unmatched route
      const resC = await fetch(`${gateway.baseUrl}/proxy/nonexistent/path`, {
        headers: { 'X-API-Key': `${mockApiKey2.keyId}.${testSecret}` },
      });
      const bodyC = await resC.json();
      assert.equal(resC.status, 404, 'routeMatcher must return 404 for unmatched route');
      assert.equal(bodyC.error?.code, 'ROUTE_NOT_FOUND');
      assert.equal(upstream.getRequestCount(), 1, 'upstreamProxy must not be reached when routeMatcher fails');

      console.log('  -> PASS: Verified strict pipeline order: apiKeyAuth -> rateLimiter -> routeMatcher -> upstreamProxy\n');
    }

    // -----------------------------------------------------------------------
    // Test 10: Graceful degradation when Redis is unavailable (Fail Open)
    // -----------------------------------------------------------------------
    {
      console.log('[Test 10] Graceful Degradation on Redis Failure (Fail Open)');
      mockRedis.isOpen = false; // Simulate Redis outage
      upstream.reset();

      const res = await fetch(`${gateway.baseUrl}/proxy/users/123`, {
        headers: { 'X-API-Key': `${mockApiKey1.keyId}.${testSecret}` },
      });
      const body = await res.json();

      assert.equal(res.status, 200, 'Gateway must not crash or fail when Redis is unavailable');
      assert.equal(body.source, 'mock-upstream', 'Request should safely proceed to upstream');
      assert.equal(upstream.getRequestCount(), 1, 'Upstream should be reached');
      console.log('  -> PASS: Redis unavailability handled gracefully without crashing or 500 error\n');

      mockRedis.isOpen = true;
    }

    console.log('=== ALL 10 RATE LIMITER VERIFICATION CHECKS PASSED SUCCESSFULLY! ===\n');
  } finally {
    // Restore original DB methods and Redis client
    APIKey.findOne = originalApiKeyFindOne;
    Project.findById = originalProjectFindById;
    Route.find = originalRouteFind;
    setRedisClient(originalRedisClient);

    // Close servers
    await gateway.close();
    await upstream.close();
  }
}

runRateLimiterVerification().catch((err) => {
  console.error('\n❌ Rate Limiter Verification Failed:', err);
  process.exit(1);
});
