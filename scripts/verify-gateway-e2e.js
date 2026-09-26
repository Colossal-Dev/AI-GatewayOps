import 'dotenv/config';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import APIKey from '../apps/gateway/src/models/api-key.model.js';
import Project from '../apps/gateway/src/models/project.model.js';
import Route from '../apps/gateway/src/models/route.model.js';
import { connectDB, disconnectDB } from '../apps/gateway/src/config/database.js';
import { startMockUpstream } from './mock-upstream.js';

const GATEWAY_PORT = parseInt(process.env.PORT || '5001', 10);
const GATEWAY_URL = `http://localhost:${GATEWAY_PORT}`;

// Helper to check if Gateway server is already running on GATEWAY_PORT
async function isGatewayRunning() {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function runGatewayE2EVerification() {
  console.log('=== Gateway E2E Verification ===\n');

  // Ensure Gateway server is running
  const running = await isGatewayRunning();
  if (!running) {
    console.error(`❌ Gateway is not running on port ${GATEWAY_PORT}.`);
    console.error('Please start the Gateway server before running this verification:');
    console.error('  node apps/gateway/src/server.js\n');
    process.exit(1);
  }

  // Connect to MongoDB using Gateway configuration
  await connectDB();

  let mockUpstream = null;
  const createdProjectIds = [];
  const createdApiKeyIds = [];
  const createdRouteIds = [];

  try {
    // 1. Start local mock upstream
    mockUpstream = await startMockUpstream();
    const upstreamUrl = `http://localhost:${mockUpstream.port}`;

    // 2. Create isolated test data using existing schemas
    const testId = Date.now();
    const testSecret = `sec_e2e_${testId}_${Math.random().toString(36).substring(2, 10)}`;
    const hashedSecret = await bcrypt.hash(testSecret, 10);

    // Active Project
    const activeProject = await Project.create({
      name: `Gateway E2E Test Project ${testId}`,
      description: 'Temporary test project for Gateway E2E verification',
      status: 'active',
      upstream: upstreamUrl,
    });
    createdProjectIds.push(activeProject._id);

    // Inactive / Disabled Project
    const inactiveProject = await Project.create({
      name: `Gateway E2E Inactive Project ${testId}`,
      description: 'Temporary inactive test project',
      status: 'disabled',
      upstream: upstreamUrl,
    });
    createdProjectIds.push(inactiveProject._id);

    // Active APIKey for Active Project
    const activeKeyId = `gw_key_active_${testId}`;
    const activeApiKey = await APIKey.create({
      keyId: activeKeyId,
      projectId: activeProject._id,
      secretHash: hashedSecret,
      status: 'active',
    });
    createdApiKeyIds.push(activeApiKey._id);

    // Active APIKey for Inactive Project
    const inactiveProjKeyId = `gw_key_inactproj_${testId}`;
    const inactiveProjApiKey = await APIKey.create({
      keyId: inactiveProjKeyId,
      projectId: inactiveProject._id,
      secretHash: hashedSecret,
      status: 'active',
    });
    createdApiKeyIds.push(inactiveProjApiKey._id);

    // Route for Active Project: GET /users/123
    const route = await Route.create({
      projectId: activeProject._id,
      path: '/users/123',
      method: 'GET',
    });
    createdRouteIds.push(route._id);

    const validAuthHeader = `${activeKeyId}.${testSecret}`;
    const invalidSecretHeader = `${activeKeyId}.wrong_secret`;
    const inactiveProjAuthHeader = `${inactiveProjKeyId}.${testSecret}`;

    // -----------------------------------------------------------------
    // Test 1: Valid API key + active project + matched route
    // -----------------------------------------------------------------
    {
      console.log('[Test 1] Valid API key + active project + matched route');
      mockUpstream.clearRequests();

      const res = await fetch(`${GATEWAY_URL}/users/123`, {
        headers: { 'X-API-Key': validAuthHeader },
      });
      const body = await res.json();
      const requestCount = mockUpstream.getRequestCount();
      const lastReq = mockUpstream.getLastRequest();

      assert.equal(res.status, 200, 'Expected HTTP 200');
      assert.equal(body.source, 'mock-upstream', 'Response must come from mock upstream');
      assert.equal(body.success, true, 'Expected success: true');
      assert.equal(body.message, 'Request reached upstream', 'Expected matching message');
      assert.equal(requestCount, 1, 'Mock upstream must receive exactly 1 request');
      assert.equal(lastReq?.url, '/users/123', 'Upstream must receive /users/123');
      assert.equal(lastReq?.headers['x-api-key'], undefined, 'Sensitive X-API-Key must not be forwarded');

      console.log('PASS: 200');
      console.log('PASS: response came from mock upstream');
      console.log('PASS: upstream received exactly one request\n');
    }

    // -----------------------------------------------------------------
    // Test 2: Valid API key + unmatched route
    // -----------------------------------------------------------------
    {
      console.log('[Test 2] Valid API key + unmatched route');
      mockUpstream.clearRequests();

      const res = await fetch(`${GATEWAY_URL}/users/does-not-exist`, {
        headers: { 'X-API-Key': validAuthHeader },
      });
      const body = await res.json();
      const requestCount = mockUpstream.getRequestCount();

      assert.equal(res.status, 404, 'Expected HTTP 404 for unmatched route');
      assert.equal(body.error?.code, 'ROUTE_NOT_FOUND', 'Expected ROUTE_NOT_FOUND code');
      assert.equal(requestCount, 0, 'Upstream must not receive request on unmatched route');

      console.log('PASS: 404 ROUTE_NOT_FOUND');
      console.log('PASS: upstream was not reached\n');
    }

    // -----------------------------------------------------------------
    // Test 3: Invalid API secret
    // -----------------------------------------------------------------
    {
      console.log('[Test 3] Invalid API secret');
      mockUpstream.clearRequests();

      const res = await fetch(`${GATEWAY_URL}/users/123`, {
        headers: { 'X-API-Key': invalidSecretHeader },
      });
      const body = await res.json();
      const requestCount = mockUpstream.getRequestCount();

      assert.equal(res.status, 401, 'Expected HTTP 401 for invalid secret');
      assert.equal(body.error?.code, 'UNAUTHORIZED', 'Expected UNAUTHORIZED code');
      assert.equal(requestCount, 0, 'Upstream must not receive request on invalid secret');

      console.log('PASS: 401');
      console.log('PASS: upstream was not reached\n');
    }

    // -----------------------------------------------------------------
    // Test 4: Inactive project
    // -----------------------------------------------------------------
    {
      console.log('[Test 4] Inactive project');
      mockUpstream.clearRequests();

      const res = await fetch(`${GATEWAY_URL}/users/123`, {
        headers: { 'X-API-Key': inactiveProjAuthHeader },
      });
      const body = await res.json();
      const requestCount = mockUpstream.getRequestCount();

      assert.equal(res.status, 403, 'Expected HTTP 403 for inactive project');
      assert.equal(body.error?.code, 'PROJECT_DISABLED', 'Expected PROJECT_DISABLED code');
      assert.equal(requestCount, 0, 'Upstream must not receive request on inactive project');

      console.log('PASS: 403 PROJECT_DISABLED');
      console.log('PASS: upstream was not reached\n');
    }

    console.log('=== Gateway E2E Verification PASSED ===\n');
  } finally {
    // Clean up temporary test data
    console.log('[Cleanup] Removing test documents from MongoDB...');
    try {
      if (createdApiKeyIds.length > 0) {
        await APIKey.deleteMany({ _id: { $in: createdApiKeyIds } });
      }
      if (createdRouteIds.length > 0) {
        await Route.deleteMany({ _id: { $in: createdRouteIds } });
      }
      if (createdProjectIds.length > 0) {
        await Project.deleteMany({ _id: { $in: createdProjectIds } });
      }
      console.log('[Cleanup] Test data successfully removed.');
    } catch (cleanupErr) {
      console.error('[Cleanup] Error removing test data:', cleanupErr.message);
    }

    // Close mock upstream
    if (mockUpstream) {
      console.log('[Cleanup] Closing mock upstream server...');
      await mockUpstream.close();
    }

    // Disconnect MongoDB connection
    console.log('[Cleanup] Disconnecting from MongoDB...');
    await disconnectDB();
  }
}

// Execute verification
runGatewayE2EVerification().catch((err) => {
  console.error('\n❌ E2E Verification Failed:', err);
  process.exit(1);
});
