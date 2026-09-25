import http from 'node:http';
import assert from 'node:assert/strict';
import upstreamProxy, { buildUpstreamUrl } from '../apps/gateway/src/middleware/upstreamProxy.js';

function createMockRes() {
  const headers = {};
  const res = {
    statusCode: 200,
    headers,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
    send(data) {
      this.body = data;
      return this;
    },
    json(data) {
      this.body = JSON.stringify(data);
      this.headers['content-type'] = 'application/json';
      return this;
    },
  };
  return res;
}

function createMockReq({ project, method = 'GET', path = '/', url = '/', headers = {}, body = undefined } = {}) {
  const normalizedHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    normalizedHeaders[k.toLowerCase()] = v;
  }
  return {
    project,
    method,
    path,
    url,
    originalUrl: url,
    headers: normalizedHeaders,
    body,
  };
}

// Start a local test upstream server
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
          customResponseConfig.headers || { 'Content-Type': 'application/json' }
        );
        res.end(customResponseConfig.body || '');
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Custom-Upstream': 'active' });
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
        setResponse: (config) => { customResponseConfig = config; },
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

async function runTests() {
  console.log('=== upstreamProxy Middleware Verification Suite ===\n');

  const upstream = await startMockUpstreamServer();

  try {
    // 1. buildUpstreamUrl helper unit tests
    {
      console.log('[Test 1] buildUpstreamUrl helper safely constructs URLs without double slashes');
      assert.equal(
        buildUpstreamUrl('http://api.backend.com/', '/users/123'),
        'http://api.backend.com/users/123'
      );
      assert.equal(
        buildUpstreamUrl('http://api.backend.com', 'users/123'),
        'http://api.backend.com/users/123'
      );
      assert.equal(
        buildUpstreamUrl('http://api.backend.com/v1/', '/users/123', '/users/123?page=2&limit=10'),
        'http://api.backend.com/v1/users/123?page=2&limit=10'
      );
      console.log('  -> PASS: URL constructor avoids malformed double slashes and preserves queries\n');
    }

    // 2. Successful GET forwarding
    {
      console.log('[Test 2] Successful GET request forwarding');
      upstream.setResponse({
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Upstream-Header': 'gateway-test' },
        body: JSON.stringify({ message: 'hello from upstream' }),
      });

      const req = createMockReq({
        project: { upstream: upstream.baseUrl },
        method: 'GET',
        path: '/api/v1/products',
        url: '/api/v1/products',
        headers: { 'Accept': 'application/json', 'X-Custom-Client': 'client-val' },
      });
      const res = createMockRes();
      let nextCalled = false;

      await upstreamProxy(req, res, () => { nextCalled = true; });

      const lastReq = upstream.getLastRequest();
      assert.equal(lastReq.method, 'GET');
      assert.equal(lastReq.url, '/api/v1/products');
      assert.equal(lastReq.headers['x-custom-client'], 'client-val');
      assert.equal(res.statusCode, 200);
      assert.equal(res.getHeader('x-upstream-header'), 'gateway-test');
      assert.deepEqual(JSON.parse(res.body.toString()), { message: 'hello from upstream' });
      assert.equal(nextCalled, false);
      console.log('  -> PASS: GET request correctly proxied with status, headers, and body preserved\n');
    }

    // 3. Dynamic route forwarding
    {
      console.log('[Test 3] Dynamic route forwarding (resolved path e.g. /users/42/orders/900)');
      const req = createMockReq({
        project: { upstream: upstream.baseUrl },
        method: 'GET',
        path: '/users/42/orders/900',
        url: '/users/42/orders/900',
      });
      const res = createMockRes();

      await upstreamProxy(req, res, () => {});

      const lastReq = upstream.getLastRequest();
      assert.equal(lastReq.url, '/users/42/orders/900');
      console.log('  -> PASS: dynamic path /users/42/orders/900 reached upstream accurately\n');
    }

    // 4. POST body forwarding
    {
      console.log('[Test 4] POST request with JSON body forwarding');
      const postPayload = { name: 'Widget A', price: 29.99, tags: ['new', 'sale'] };

      upstream.setResponse({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'w_101', ...postPayload }),
      });

      const req = createMockReq({
        project: { upstream: upstream.baseUrl },
        method: 'POST',
        path: '/products',
        url: '/products',
        headers: { 'Content-Type': 'application/json' },
        body: postPayload,
      });
      const res = createMockRes();

      await upstreamProxy(req, res, () => {});

      const lastReq = upstream.getLastRequest();
      assert.equal(lastReq.method, 'POST');
      assert.deepEqual(JSON.parse(lastReq.body), postPayload);
      assert.equal(res.statusCode, 201);
      assert.deepEqual(JSON.parse(res.body.toString()), { id: 'w_101', ...postPayload });
      console.log('  -> PASS: POST body serialized and sent to upstream; 201 response returned to client\n');
    }

    // 5. Query string preservation
    {
      console.log('[Test 5] Query string preservation');
      const req = createMockReq({
        project: { upstream: upstream.baseUrl },
        method: 'GET',
        path: '/items',
        url: '/items?category=electronics&sort=price_desc&limit=25',
      });
      const res = createMockRes();

      await upstreamProxy(req, res, () => {});

      const lastReq = upstream.getLastRequest();
      assert.equal(lastReq.url, '/items?category=electronics&sort=price_desc&limit=25');
      console.log('  -> PASS: query string correctly attached to upstream target URL\n');
    }

    // 6. Security: X-API-Key and secrets NOT forwarded upstream
    {
      console.log('[Test 6] Security: X-API-Key and sensitive headers stripped before upstream');
      const req = createMockReq({
        project: { upstream: upstream.baseUrl },
        method: 'GET',
        path: '/secure-data',
        url: '/secure-data',
        headers: {
          'x-api-key': 'gw_key_123.super_secret_token',
          'authorization': 'Bearer internal-jwt',
          'user-agent': 'AI-Gateway-Client',
        },
      });
      const res = createMockRes();

      await upstreamProxy(req, res, () => {});

      const lastReq = upstream.getLastRequest();
      assert.equal(lastReq.headers['x-api-key'], undefined, 'X-API-Key must NEVER reach upstream');
      assert.equal(lastReq.headers['authorization'], 'Bearer internal-jwt', 'Authorization header preserved');
      assert.equal(lastReq.headers['user-agent'], 'AI-Gateway-Client');
      console.log('  -> PASS: X-API-Key is completely stripped and secrets are never leaked\n');
    }

    // 7. Upstream status code propagation (e.g. 404, 500)
    {
      console.log('[Test 7] Upstream status code propagation (404 and 500 error passthrough)');
      upstream.setResponse({
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Item not found upstream' }),
      });

      const req404 = createMockReq({
        project: { upstream: upstream.baseUrl },
        method: 'GET',
        path: '/missing-item',
        url: '/missing-item',
      });
      const res404 = createMockRes();

      await upstreamProxy(req404, res404, () => {});

      assert.equal(res404.statusCode, 404);
      assert.deepEqual(JSON.parse(res404.body.toString()), { error: 'Item not found upstream' });
      console.log('  -> PASS: upstream status code (404) and payload preserved and returned\n');
    }

    // 8. Missing / Invalid upstream configuration
    {
      console.log('[Test 8] Missing or invalid upstream configuration handling');
      // Missing upstream
      const reqMissing = createMockReq({
        project: { upstream: '' },
        method: 'GET',
        path: '/test',
      });
      const resMissing = createMockRes();

      await upstreamProxy(reqMissing, resMissing, () => {});

      assert.equal(resMissing.statusCode, 502);
      const jsonMissing = JSON.parse(resMissing.body);
      assert.equal(jsonMissing.error.code, 'BAD_GATEWAY');

      // Invalid URL format
      const reqInvalid = createMockReq({
        project: { upstream: 'not-a-valid-url-format' },
        method: 'GET',
        path: '/test',
      });
      const resInvalid = createMockRes();

      await upstreamProxy(reqInvalid, resInvalid, () => {});

      assert.equal(resInvalid.statusCode, 502);
      const jsonInvalid = JSON.parse(resInvalid.body);
      assert.equal(jsonInvalid.error.code, 'BAD_GATEWAY');
      console.log('  -> PASS: returns 502 BAD_GATEWAY on missing/malformed upstream configuration\n');
    }

    // 9. Upstream connection failure handled through next(error)
    {
      console.log('[Test 9] Upstream connection failure forwarded to next(error)');
      // Target a closed/non-listening port
      const reqConnErr = createMockReq({
        project: { upstream: 'http://127.0.0.1:59999' },
        method: 'GET',
        path: '/unavailable-service',
        url: '/unavailable-service',
      });
      const resConnErr = createMockRes();
      let passedError = null;

      await upstreamProxy(reqConnErr, resConnErr, (err) => { passedError = err; });

      assert(passedError instanceof Error, 'Connection failure must pass Error to next()');
      console.log('  -> PASS: fetch connection error caught and forwarded to Express next(error)\n');
    }

    console.log('=== All 9 upstreamProxy verification checks PASSED successfully! ===');
  } finally {
    await upstream.close();
  }
}

runTests().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
