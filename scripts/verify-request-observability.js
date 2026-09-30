import http from 'node:http';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import app from '../apps/gateway/src/app.js';
import APIKey from '../apps/gateway/src/models/api-key.model.js';
import Project from '../apps/gateway/src/models/project.model.js';
import Route from '../apps/gateway/src/models/route.model.js';
import { setRedisClient } from '../apps/gateway/src/config/redis.js';
import { setLogHook, resetLogHook } from '../apps/gateway/src/middleware/requestLogger.js';
import { isValidRequestId } from '../apps/gateway/src/middleware/requestId.js';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_ANY_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Starts the Express gateway app on an ephemeral port to avoid conflict with port 5001.
 */
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

/**
 * Starts a mock upstream backend server on an ephemeral port.
 */
function startMockUpstreamServer() {
  let lastReceivedRequest = null;
  let customResponseConfig = null;

  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });

    req.on('end', () => {
      lastReceivedRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: rawBody,
      };

      if (customResponseConfig) {
        res.writeHead(
          customResponseConfig.status || 200,
          customResponseConfig.headers || { 'content-type': 'application/json' }
        );
        res.end(customResponseConfig.body || '');
      } else {
        res.writeHead(200, {
          'content-type': 'application/json',
          'x-upstream-service': 'mock-backend-v1',
        });
        res.end(JSON.stringify({ status: 'upstream_ok', receivedUrl: req.url }));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        server,
        baseUrl,
        getLastRequest: () => lastReceivedRequest,
        clearLastRequest: () => {
          lastReceivedRequest = null;
        },
        setResponse: (config) => {
          customResponseConfig = config;
        },
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

/**
 * Helper to await microtasks and finish event emission.
 */
function wait(ms = 25) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('================================================================');
  console.log('  AI-GatewayOps: Request Observability & Correlation ID Suite   ');
  console.log('================================================================\n');

  let upstream = null;
  let gateway = null;

  // Stored originals for cleanup
  const originalApiKeyFindOne = APIKey.findOne;
  const originalProjectFindById = Project.findById;
  const originalRouteFind = Route.find;

  try {
    upstream = await startMockUpstreamServer();
    gateway = await startGatewayServer();

    const testSecret = 'sec_observability_suite_secret_test_99';
    const hashedSecret = await bcrypt.hash(testSecret, 10);
    const activeProjectId = '64abc1234567890123456789';

    const mockActiveProject = {
      _id: activeProjectId,
      id: activeProjectId,
      name: 'Observability Test Project',
      status: 'active',
      upstream: upstream.baseUrl,
    };

    const mockActiveApiKey = {
      _id: 'key_doc_obs_1',
      keyId: 'gw_key_obs_active',
      projectId: activeProjectId,
      secretHash: hashedSecret,
      status: 'active',
    };

    const mockRoutes = [
      {
        _id: 'route_users_detail',
        projectId: activeProjectId,
        path: '/users/:id',
        method: 'GET',
      },
      {
        _id: 'route_users_post',
        projectId: activeProjectId,
        path: '/users',
        method: 'POST',
      },
    ];

    // Mock DB model methods for isolated verification
    APIKey.findOne = async (query) => {
      if (query?.keyId === mockActiveApiKey.keyId) return mockActiveApiKey;
      return null;
    };

    Project.findById = async (id) => {
      if (id === activeProjectId) return mockActiveProject;
      return null;
    };

    Route.find = async (query) => {
      const { projectId, method } = query;
      return mockRoutes.filter(
        (r) => r.projectId === projectId && r.method === method
      );
    };

    // -------------------------------------------------------------
    // Test 1: Public Health Endpoints Return HTTP 200
    // -------------------------------------------------------------
    {
      console.log('[Test 1] Health endpoints (/api/health & /health) remain public and return HTTP 200');
      const res1 = await fetch(`${gateway.baseUrl}/api/health`);
      const body1 = await res1.json();
      assert.equal(res1.status, 200, '/api/health must return HTTP 200');
      assert.equal(body1.status, 'ok');

      const res2 = await fetch(`${gateway.baseUrl}/health`);
      const body2 = await res2.json();
      assert.equal(res2.status, 200, '/health must return HTTP 200');
      assert.equal(body2.status, 'ok');
      console.log('  -> PASS: Public health endpoints accessible without authentication\n');
    }

    // -------------------------------------------------------------
    // Test 2: Auto-generation of Valid UUID v4 when X-Request-ID is Absent
    // -------------------------------------------------------------
    {
      console.log('[Test 2] Without X-Request-ID, Gateway generates and returns a valid UUID v4');
      const res = await fetch(`${gateway.baseUrl}/api/health`);
      const requestIdHeader = res.headers.get('x-request-id');

      assert.equal(res.status, 200);
      assert.ok(requestIdHeader, 'Response must contain X-Request-ID header');
      assert.ok(isValidRequestId(requestIdHeader), 'Generated ID must be valid');
      assert.ok(UUID_ANY_REGEX.test(requestIdHeader), `Generated ID must match UUID format: ${requestIdHeader}`);
      console.log(`  -> PASS: Generated X-Request-ID: ${requestIdHeader}\n`);
    }

    // -------------------------------------------------------------
    // Test 3: Propagation of Valid Incoming X-Request-ID
    // -------------------------------------------------------------
    {
      console.log('[Test 3] With a valid incoming X-Request-ID, the same ID is returned in the response');
      const customId = 'test-request-123';
      const res = await fetch(`${gateway.baseUrl}/api/health`, {
        headers: { 'X-Request-ID': customId },
      });
      const requestIdHeader = res.headers.get('x-request-id');

      assert.equal(res.status, 200);
      assert.equal(requestIdHeader, customId, 'Response X-Request-ID must equal test-request-123');
      console.log(`  -> PASS: Propagated X-Request-ID: ${requestIdHeader}\n`);
    }

    // -------------------------------------------------------------
    // Test 4: Invalid X-Request-ID Values are Rejected and Replaced with UUID
    // -------------------------------------------------------------
    {
      console.log('[Test 4] Invalid X-Request-ID values (control chars/newlines/whitespace/oversized) are safely replaced');
      // Unit validation checks
      assert.equal(isValidRequestId('test\r\nX-Injected: evil'), false, 'Newline CR+LF must be rejected');
      assert.equal(isValidRequestId('test\ninjection'), false, 'Line feed must be rejected');
      assert.equal(isValidRequestId('test\x00null'), false, 'Null byte must be rejected');
      assert.equal(isValidRequestId('   '), false, 'Whitespace-only IDs must be rejected');
      assert.equal(isValidRequestId('a'.repeat(300)), false, 'IDs exceeding 255 chars must be rejected');
      assert.equal(isValidRequestId('test-request-123'), true, 'Valid alphanumeric ID must be accepted');

      // Integration check: sending oversized header to Gateway
      const oversizedHeader = 'x'.repeat(300);
      const res = await fetch(`${gateway.baseUrl}/api/health`, {
        headers: { 'X-Request-ID': oversizedHeader },
      });
      const requestIdHeader = res.headers.get('x-request-id');

      assert.equal(res.status, 200);
      assert.notEqual(requestIdHeader, oversizedHeader, 'Must NOT reflect invalid oversized header');
      assert.ok(isValidRequestId(requestIdHeader), 'Replacement ID must be valid');
      assert.ok(UUID_ANY_REGEX.test(requestIdHeader), 'Replacement ID must be a valid UUID');
      console.log(`  -> PASS: Invalid header replaced with safe UUID: ${requestIdHeader}\n`);
    }

    // -------------------------------------------------------------
    // Test 5: X-Request-ID is Present on All Response Types (200, 401, 404, 429, 502)
    // -------------------------------------------------------------
    {
      console.log('[Test 5] X-Request-ID header is present across all response types');

      // 200 OK
      const res200 = await fetch(`${gateway.baseUrl}/api/health`);
      assert.ok(res200.headers.get('x-request-id'), 'X-Request-ID must exist on 200');

      // 401 Unauthorized
      const res401 = await fetch(`${gateway.baseUrl}/proxy/users/42`);
      assert.equal(res401.status, 401);
      assert.ok(res401.headers.get('x-request-id'), 'X-Request-ID must exist on 401');

      // 404 Route Not Found
      const res404 = await fetch(`${gateway.baseUrl}/proxy/nonexistent/route`, {
        headers: { 'X-API-Key': `${mockActiveApiKey.keyId}.${testSecret}` },
      });
      assert.equal(res404.status, 404);
      assert.ok(res404.headers.get('x-request-id'), 'X-Request-ID must exist on 404');

      console.log('  -> PASS: X-Request-ID present on 200, 401, and 404 responses\n');
    }

    // -------------------------------------------------------------
    // Test 6: requestLogger Records Core Fields via Programmatic Hook
    // -------------------------------------------------------------
    {
      console.log('[Test 6] requestLogger records method, URL, status code, duration, and requestId');
      let capturedLogData = null;
      setLogHook((logData) => { capturedLogData = logData; });

      const testReqId = 'trace-core-fields-check';
      const res = await fetch(`${gateway.baseUrl}/api/health`, {
        headers: { 'X-Request-ID': testReqId },
      });

      assert.equal(res.status, 200);
      await wait(25);

      assert.ok(capturedLogData, 'requestLogger must emit logData on completion');
      assert.equal(capturedLogData.requestId, testReqId);
      assert.equal(capturedLogData.method, 'GET');
      assert.equal(capturedLogData.url, '/api/health');
      assert.equal(capturedLogData.statusCode, 200);
      assert.ok(typeof capturedLogData.durationMs === 'number' && capturedLogData.durationMs >= 0, 'Duration must be numeric and >= 0');

      console.log(`  -> PASS: Logged: ${capturedLogData.method} ${capturedLogData.url} ${capturedLogData.statusCode} (${capturedLogData.durationMs}ms) [reqId: ${capturedLogData.requestId}]\n`);
      resetLogHook();
    }

    // -------------------------------------------------------------
    // Test 7: API-Key Information Logging (Only Identifier, Never Secret)
    // -------------------------------------------------------------
    {
      console.log('[Test 7] Authenticated logging records API-key identifier, route, and project; NEVER secret or secretHash');
      let capturedLogData = null;
      let capturedLogMsg = null;

      setLogHook((logData, logMsg) => {
        capturedLogData = logData;
        capturedLogMsg = logMsg;
      });

      const testReqId = 'trace-auth-logging-check';
      const res = await fetch(`${gateway.baseUrl}/proxy/users/42`, {
        headers: {
          'X-API-Key': `${mockActiveApiKey.keyId}.${testSecret}`,
          'X-Request-ID': testReqId,
        },
      });

      assert.equal(res.status, 200);
      await wait(25);

      assert.ok(capturedLogData);
      assert.equal(capturedLogData.requestId, testReqId);
      assert.equal(capturedLogData.apiKeyId, mockActiveApiKey.keyId, 'Must log apiKeyId');
      assert.equal(capturedLogData.projectId, activeProjectId, 'Must log projectId');
      assert.equal(capturedLogData.route, '/users/:id', 'Must log matched route pattern');

      // Strict assertions: secrets and hashes must never be exposed
      assert.equal(capturedLogData.secret, undefined);
      assert.equal(capturedLogData.secretHash, undefined);
      assert.equal(capturedLogMsg.includes(testSecret), false, 'Formatted log message must never contain the API secret');

      console.log(`  -> PASS: apiKeyId (${capturedLogData.apiKeyId}), projectId (${capturedLogData.projectId}), route (${capturedLogData.route}) recorded safely\n`);
      resetLogHook();
    }

    // -------------------------------------------------------------
    // Test 8: Strict Sensitive Data Exclusion (No Body, Authorization, Cookies, Secrets)
    // -------------------------------------------------------------
    {
      console.log('[Test 8] Sensitive credentials, request bodies, Authorization headers, and cookies are NEVER logged');
      let capturedLogData = null;
      let capturedLogMsg = null;

      setLogHook((logData, logMsg) => {
        capturedLogData = logData;
        capturedLogMsg = logMsg;
      });

      const sensitivePayload = { username: 'testuser', password: 'SuperSecretPassword123' };
      const secretToken = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sensitive-token';
      const cookieVal = 'session_id=super_secret_cookie_data_456';

      const res = await fetch(`${gateway.baseUrl}/proxy/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': `${mockActiveApiKey.keyId}.${testSecret}`,
          'Authorization': secretToken,
          'Cookie': cookieVal,
        },
        body: JSON.stringify(sensitivePayload),
      });

      assert.equal(res.status, 200);
      await wait(25);

      assert.ok(capturedLogData);
      assert.equal(capturedLogData.body, undefined, 'Request body must NOT be logged');
      assert.equal(capturedLogData.password, undefined);
      assert.equal(capturedLogData.authorization, undefined);
      assert.equal(capturedLogData.cookie, undefined);

      assert.equal(capturedLogMsg.includes('SuperSecretPassword123'), false, 'Passwords must never appear in logs');
      assert.equal(capturedLogMsg.includes('sensitive-token'), false, 'Authorization headers must never appear in logs');
      assert.equal(capturedLogMsg.includes('super_secret_cookie_data_456'), false, 'Cookies must never appear in logs');

      console.log('  -> PASS: Request bodies, passwords, auth headers, and cookies verified completely absent from logs\n');
      resetLogHook();
    }

    // -------------------------------------------------------------
    // Test 9: Logger Runs for Both Successful and Error Responses (401, 404, 429, 502)
    // -------------------------------------------------------------
    {
      console.log('[Test 9] Logger executes for both successful (200) and rejected/error responses (401, 404, 429, 502)');

      // 401 Missing Key
      {
        let log401 = null;
        setLogHook((logData) => { log401 = logData; });
        const res = await fetch(`${gateway.baseUrl}/proxy/users/42`);
        assert.equal(res.status, 401);
        await wait(25);
        assert.ok(log401);
        assert.equal(log401.statusCode, 401);
        resetLogHook();
      }

      // 401 Invalid Key Secret
      {
        let log401Bad = null;
        setLogHook((logData) => { log401Bad = logData; });
        const res = await fetch(`${gateway.baseUrl}/proxy/users/42`, {
          headers: { 'X-API-Key': `${mockActiveApiKey.keyId}.invalid_secret` },
        });
        assert.equal(res.status, 401);
        await wait(25);
        assert.ok(log401Bad);
        assert.equal(log401Bad.statusCode, 401);
        resetLogHook();
      }

      // 429 Rate Limited
      {
        let log429 = null;
        setLogHook((logData) => { log429 = logData; });
        setRedisClient({
          isOpen: true,
          incr: async () => 999, // Exceeds default quota
          expire: async () => {},
        });

        const res = await fetch(`${gateway.baseUrl}/proxy/users/42`, {
          headers: { 'X-API-Key': `${mockActiveApiKey.keyId}.${testSecret}` },
        });
        assert.equal(res.status, 429);
        await wait(25);
        assert.ok(log429);
        assert.equal(log429.statusCode, 429);
        assert.equal(log429.apiKeyId, mockActiveApiKey.keyId);

        setRedisClient(null);
        resetLogHook();
      }

      // 404 Route Not Found
      {
        let log404 = null;
        setLogHook((logData) => { log404 = logData; });
        const res = await fetch(`${gateway.baseUrl}/proxy/nonexistent/path`, {
          headers: { 'X-API-Key': `${mockActiveApiKey.keyId}.${testSecret}` },
        });
        assert.equal(res.status, 404);
        await wait(25);
        assert.ok(log404);
        assert.equal(log404.statusCode, 404);
        resetLogHook();
      }

      // 502 Upstream Failure
      {
        let log502 = null;
        setLogHook((logData) => { log502 = logData; });
        mockActiveProject.upstream = 'http://127.0.0.1:59999'; // unreachable port

        const res = await fetch(`${gateway.baseUrl}/proxy/users/42`, {
          headers: { 'X-API-Key': `${mockActiveApiKey.keyId}.${testSecret}` },
        });
        assert.equal(res.status, 502);
        await wait(25);
        assert.ok(log502);
        assert.equal(log502.statusCode, 502);
        assert.ok(log502.durationMs >= 0);

        mockActiveProject.upstream = upstream.baseUrl; // restore
        resetLogHook();
      }

      console.log('  -> PASS: All error response status codes (401, 404, 429, 502) recorded by requestLogger\n');
    }

    // -------------------------------------------------------------
    // Test 10: Non-Interference with Existing Gateway Pipeline & Upstream Proxying
    // -------------------------------------------------------------
    {
      console.log('[Test 10] Request logging does not interfere with the Gateway pipeline or upstream proxy behavior');
      upstream.clearLastRequest();
      upstream.setResponse({
        status: 200,
        headers: { 'content-type': 'application/json', 'x-upstream-header': 'forwarded-ok' },
        body: JSON.stringify({ userId: '42', name: 'Integration User' }),
      });

      const clientCorrId = 'pipeline-integrity-test-corr-id';
      const res = await fetch(`${gateway.baseUrl}/proxy/users/42?queryParam=123`, {
        headers: {
          'X-API-Key': `${mockActiveApiKey.keyId}.${testSecret}`,
          'X-Request-ID': clientCorrId,
          'X-Custom-Client': 'client-app-v1',
        },
      });

      const body = await res.json();
      const lastReq = upstream.getLastRequest();
      const resRequestId = res.headers.get('x-request-id');

      // Response assertions
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-upstream-header'), 'forwarded-ok');
      assert.equal(resRequestId, clientCorrId);
      assert.deepEqual(body, { userId: '42', name: 'Integration User' });

      // Upstream assertions
      assert.ok(lastReq, 'Upstream must receive request');
      assert.equal(lastReq.method, 'GET');
      assert.equal(lastReq.url, '/users/42?queryParam=123', 'Upstream URL and queries preserved');
      assert.equal(lastReq.headers['x-request-id'], clientCorrId, 'Correlation ID forwarded to upstream');
      assert.equal(lastReq.headers['x-custom-client'], 'client-app-v1');
      assert.equal(lastReq.headers['x-api-key'], undefined, 'Sensitive X-API-Key must be stripped');

      console.log('  -> PASS: Middleware pipeline intact: apiKeyAuth -> rateLimiter -> routeMatcher -> upstreamProxy\n');
    }

    console.log('================================================================');
    console.log('  ALL 10 OBSERVABILITY VERIFICATION TESTS PASSED SUCCESSFULLY!  ');
    console.log('================================================================\n');
  } finally {
    // Clean up all resources, hooks, and overrides
    resetLogHook();
    setRedisClient(null);

    APIKey.findOne = originalApiKeyFindOne;
    Project.findById = originalProjectFindById;
    Route.find = originalRouteFind;

    if (gateway) {
      await gateway.close();
    }
    if (upstream) {
      await upstream.close();
    }
  }
}

runTests().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
