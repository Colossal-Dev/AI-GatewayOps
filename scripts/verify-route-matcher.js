import assert from 'node:assert/strict';
import routeMatcher, { matchPath } from '../apps/gateway/src/middleware/routeMatcher.js';
import Route from '../apps/gateway/src/models/route.model.js';

function createMockRes() {
  const res = {
    statusCode: null,
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
  };
  return res;
}

function createMockReq({ project, method = 'GET', path = '/' } = {}) {
  return {
    project,
    method,
    path,
  };
}

async function runTests() {
  console.log('=== routeMatcher Middleware Verification Suite ===\n');

  const projectAId = '64abc1234567890123456789';
  const projectBId = '64def9876543210987654321';

  const mockDbRoutes = [
    {
      _id: 'route_1',
      projectId: projectAId,
      path: '/api/v1/health',
      method: 'GET',
    },
    {
      _id: 'route_2',
      projectId: projectAId,
      path: '/users/me',
      method: 'GET',
    },
    {
      _id: 'route_3',
      projectId: projectAId,
      path: '/users/:id',
      method: 'GET',
    },
    {
      _id: 'route_4',
      projectId: projectAId,
      path: '/users/:userId/orders/:orderId',
      method: 'GET',
    },
    {
      _id: 'route_5',
      projectId: projectAId,
      path: '/users',
      method: 'POST',
    },
    {
      _id: 'route_6',
      projectId: projectBId,
      path: '/secret-b-route',
      method: 'GET',
    },
  ];

  // Helper to mock Route.find
  const setupMockDb = () => {
    const originalFind = Route.find;
    Route.find = async (filter) => {
      return mockDbRoutes.filter((r) => {
        const matchProject = String(r.projectId) === String(filter.projectId);
        const matchMethod = r.method === filter.method;
        return matchProject && matchMethod;
      });
    };
    return () => { Route.find = originalFind; };
  };

  const restoreDb = setupMockDb();

  try {
    // 1. matchPath unit helper validation
    {
      console.log('[Test 1] matchPath helper unit checks');
      assert.deepEqual(matchPath('/users/:id', '/users/123'), { matches: true, params: { id: '123' } });
      assert.deepEqual(matchPath('/users/:userId/orders/:orderId', '/users/42/orders/900'), {
        matches: true,
        params: { userId: '42', orderId: '900' },
      });
      assert.deepEqual(matchPath('/api/v1/health', '/api/v1/health'), { matches: true, params: {} });
      assert.equal(matchPath('/users/:id', '/users/123/extra'), null);
      assert.equal(matchPath('/users/:id', '/items/123'), null);
      console.log('  -> PASS: matchPath correctly matches patterns and extracts params\n');
    }

    // 2. Matching static route
    {
      console.log('[Test 2] Matching static route');
      const req = createMockReq({
        project: { _id: projectAId },
        method: 'GET',
        path: '/api/v1/health',
      });
      const res = createMockRes();
      let nextCalled = false;

      await routeMatcher(req, res, () => { nextCalled = true; });

      assert.equal(nextCalled, true, 'next() should be called on match');
      assert.equal(req.routeConfig._id, 'route_1');
      assert.equal(req.routeConfig.path, '/api/v1/health');
      assert.deepEqual(req.routeParams, {});
      assert.equal(res.statusCode, null);
      console.log('  -> PASS: static route matched and attached to req.routeConfig\n');
    }

    // 3. Matching dynamic route with single parameter
    {
      console.log('[Test 3] Matching dynamic route (/users/:id)');
      const req = createMockReq({
        project: { _id: projectAId },
        method: 'GET',
        path: '/users/123',
      });
      const res = createMockRes();
      let nextCalled = false;

      await routeMatcher(req, res, () => { nextCalled = true; });

      assert.equal(nextCalled, true);
      assert.equal(req.routeConfig._id, 'route_3');
      assert.equal(req.routeConfig.path, '/users/:id');
      assert.deepEqual(req.routeParams, { id: '123' });
      console.log('  -> PASS: dynamic route matched with req.routeParams = { id: "123" }\n');
    }

    // 4. Multiple dynamic parameters
    {
      console.log('[Test 4] Multiple dynamic parameters (/users/:userId/orders/:orderId)');
      const req = createMockReq({
        project: { _id: projectAId },
        method: 'GET',
        path: '/users/42/orders/900',
      });
      const res = createMockRes();
      let nextCalled = false;

      await routeMatcher(req, res, () => { nextCalled = true; });

      assert.equal(nextCalled, true);
      assert.equal(req.routeConfig._id, 'route_4');
      assert.deepEqual(req.routeParams, { userId: '42', orderId: '900' });
      console.log('  -> PASS: multiple dynamic parameters extracted accurately\n');
    }

    // 5. Specific static route prioritized over wildcard dynamic route
    {
      console.log('[Test 5] Static route priority over dynamic route (/users/me vs /users/:id)');
      const req = createMockReq({
        project: { _id: projectAId },
        method: 'GET',
        path: '/users/me',
      });
      const res = createMockRes();
      let nextCalled = false;

      await routeMatcher(req, res, () => { nextCalled = true; });

      assert.equal(nextCalled, true);
      assert.equal(req.routeConfig._id, 'route_2', 'Should match /users/me specifically');
      assert.deepEqual(req.routeParams, {});
      console.log('  -> PASS: /users/me correctly preferred over /users/:id\n');
    }

    // 6. Wrong HTTP method
    {
      console.log('[Test 6] Wrong HTTP method (POST /users/123 when only GET exists)');
      const req = createMockReq({
        project: { _id: projectAId },
        method: 'POST',
        path: '/users/123',
      });
      const res = createMockRes();
      let nextCalled = false;

      await routeMatcher(req, res, () => { nextCalled = true; });

      assert.equal(res.statusCode, 404);
      assert.equal(res.jsonData?.error?.code, 'ROUTE_NOT_FOUND');
      assert.equal(nextCalled, false);
      console.log('  -> PASS: returns 404 ROUTE_NOT_FOUND on method mismatch\n');
    }

    // 7. Wrong projectId isolation
    {
      console.log('[Test 7] Project isolation (Project A requesting Project B route)');
      const req = createMockReq({
        project: { _id: projectAId },
        method: 'GET',
        path: '/secret-b-route',
      });
      const res = createMockRes();
      let nextCalled = false;

      await routeMatcher(req, res, () => { nextCalled = true; });

      assert.equal(res.statusCode, 404);
      assert.equal(res.jsonData?.error?.code, 'ROUTE_NOT_FOUND');
      assert.equal(nextCalled, false);
      console.log('  -> PASS: returns 404 when route belongs to a different project\n');
    }

    // 8. Unmatched path
    {
      console.log('[Test 8] Unmatched path');
      const req = createMockReq({
        project: { _id: projectAId },
        method: 'GET',
        path: '/nonexistent/path',
      });
      const res = createMockRes();
      let nextCalled = false;

      await routeMatcher(req, res, () => { nextCalled = true; });

      assert.equal(res.statusCode, 404);
      assert.equal(res.jsonData?.error?.code, 'ROUTE_NOT_FOUND');
      assert.equal(res.jsonData?.error?.message, 'Route not found');
      assert.equal(nextCalled, false);
      console.log('  -> PASS: returns 404 ROUTE_NOT_FOUND on non-existent path\n');
    }

    // 9. Unexpected error propagation
    {
      console.log('[Test 9] Unexpected database error propagated to next(error)');
      const errorFind = Route.find;
      Route.find = async () => { throw new Error('DB connection dropped'); };

      const req = createMockReq({
        project: { _id: projectAId },
        method: 'GET',
        path: '/users/123',
      });
      const res = createMockRes();
      let passedError = null;

      await routeMatcher(req, res, (err) => { passedError = err; });

      assert(passedError instanceof Error);
      assert.equal(passedError.message, 'DB connection dropped');
      Route.find = errorFind;
      console.log('  -> PASS: unexpected runtime/DB errors forwarded to next(error)\n');
    }

    console.log('=== All 9 routeMatcher verification checks PASSED! ===');
  } finally {
    restoreDb();
  }
}

runTests().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
