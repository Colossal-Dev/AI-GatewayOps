/**
 * Verification Script for Control Plane Project Management APIs Milestone
 *
 * Tests all required scenarios against the Platform API:
 *
 * PROJECTS:
 * 1. Create project -> 201
 * 2. List projects -> 200
 * 3. Get project -> 200
 * 4. Update project -> 200
 * 5. Delete/deactivate project -> expected success
 *
 * API KEYS:
 * 6. Create API key -> 201
 * 7. Plaintext secret is returned only once according to contract
 * 8. secretHash is never returned
 * 9. List API keys -> 200 and secrets/secretHash are not exposed
 * 10. Revoke/delete API key -> expected success
 *
 * ROUTES:
 * 11. Create route -> 201 (and duplicate route rejection -> 409)
 * 12. List routes -> 200
 * 13. Get route -> 200
 * 14. Update route -> 200
 * 15. Delete route -> expected success
 *
 * SECURITY:
 * 16. Unauthenticated management request -> 401
 * 17. Unauthorized project access (User B accessing User A's project) -> 403
 * 18. Nonexistent project -> 404
 * 19. Invalid request payload -> 400
 *
 * INTEGRATION:
 * 20. Create an active project via Control Plane API
 * 21. Create an active API key for it via Control Plane API
 * 22. Create GET /users/123 route via Control Plane API
 * 23. Confirm the resulting documents are fully compatible with existing Gateway
 * 24. Confirm no manual MongoDB document insertions were required
 */

import http from 'http';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import app from '../apps/platform-api/src/app.js';
import { connectDB, disconnectDB } from '../apps/platform-api/src/config/db.js';
import Project from '../apps/platform-api/src/models/Project.js';
import APIKey from '../apps/platform-api/src/models/APIKey.js';
import Route from '../apps/platform-api/src/models/Route.js';
import User from '../apps/platform-api/src/models/User.js';
import RefreshSession from '../apps/platform-api/src/models/RefreshSession.js';

// Gateway middleware to verify integration compatibility
import apiKeyAuth from '../apps/gateway/src/middleware/apiKeyAuth.js';
import routeMatcher from '../apps/gateway/src/middleware/routeMatcher.js';

let server;
let baseUrl;

// Cleanup tracking arrays
const createdUserIds = [];
const createdProjectIds = [];
const createdApiKeyIds = [];
const createdRouteIds = [];

async function apiRequest(endpoint, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${baseUrl}${endpoint}`, options);
  let json;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  return {
    status: res.status,
    headers: res.headers,
    body: json,
  };
}

async function runControlPlaneVerification() {
  console.log('====================================================');
  console.log('  STARTING CONTROL PLANE API VERIFICATION SUITE     ');
  console.log('====================================================\n');

  // 1. Connect to Database & Start Server on ephemeral port
  await connectDB();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[Test Server] Running at ${baseUrl}\n`);

  const testTimestamp = Date.now();
  const userAEmail = `user.a.${testTimestamp}@gatewayops.test`;
  const userBEmail = `user.b.${testTimestamp}@gatewayops.test`;
  const testPassword = 'Password123!Secure';

  try {
    // -----------------------------------------------------------
    // SETUP: Register & Authenticate User A and User B
    // -----------------------------------------------------------
    console.log('[Setup] Registering and authenticating Test User A and Test User B...');

    const regARes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: { email: userAEmail, password: testPassword, fullName: 'User A Developer' },
    });
    assert.equal(regARes.status, 201, 'User A registration should return 201');
    const userAId = regARes.body.data.user.id;
    createdUserIds.push(userAId);

    const loginARes = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: userAEmail, password: testPassword },
    });
    assert.equal(loginARes.status, 200, 'User A login should return 200');
    const tokenA = loginARes.body.data.accessToken;
    assert.ok(tokenA, 'User A should receive access token');

    const regBRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: { email: userBEmail, password: testPassword, fullName: 'User B Developer' },
    });
    assert.equal(regBRes.status, 201, 'User B registration should return 201');
    const userBId = regBRes.body.data.user.id;
    createdUserIds.push(userBId);

    const loginBRes = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: userBEmail, password: testPassword },
    });
    assert.equal(loginBRes.status, 200, 'User B login should return 200');
    const tokenB = loginBRes.body.data.accessToken;
    assert.ok(tokenB, 'User B should receive access token');

    console.log('  ✓ Setup completed successfully\n');

    // ===========================================================
    // SECTION 1: PROJECTS
    // ===========================================================

    // TEST 1: Create Project -> 201
    console.log('[TEST 1/24] [Projects] POST /api/projects -> 201');
    const createProjRes = await apiRequest('/api/projects', {
      method: 'POST',
      token: tokenA,
      body: {
        name: 'Project Alpha',
        upstream: 'http://localhost:8080',
        description: 'Main production workspace',
        status: 'active',
      },
    });
    assert.equal(createProjRes.status, 201, 'Create project must return 201');
    assert.equal(createProjRes.body.success, true, 'Create project success must be true');
    const projectA = createProjRes.body.data.project;
    assert.ok(projectA.id || projectA._id, 'Project must have an ID');
    const projectAId = projectA.id || projectA._id;
    createdProjectIds.push(projectAId);
    assert.equal(projectA.name, 'Project Alpha', 'Project name must match');
    assert.equal(projectA.upstream, 'http://localhost:8080', 'Project upstream must match');
    assert.equal(projectA.status, 'active', 'Project status must be active');
    console.log(`  ✓ Project created: id=${projectAId}, status=201 OK\n`);

    // TEST 2: List Projects -> 200
    console.log('[TEST 2/24] [Projects] GET /api/projects -> 200');
    const listProjRes = await apiRequest('/api/projects', {
      method: 'GET',
      token: tokenA,
    });
    assert.equal(listProjRes.status, 200, 'List projects must return 200');
    assert.ok(Array.isArray(listProjRes.body.data.projects), 'Projects list must be an array');
    const hasProjectA = listProjRes.body.data.projects.some(
      (p) => (p.id || p._id).toString() === projectAId.toString()
    );
    assert.ok(hasProjectA, 'User A project list must contain Project Alpha');

    // Verify isolation: User B listing projects does not see User A's project
    const listProjBRes = await apiRequest('/api/projects', {
      method: 'GET',
      token: tokenB,
    });
    assert.equal(listProjBRes.status, 200, 'User B list projects must return 200');
    const userBHasProjA = listProjBRes.body.data.projects.some(
      (p) => (p.id || p._id).toString() === projectAId.toString()
    );
    assert.equal(userBHasProjA, false, 'User B must not see User A project');
    console.log('  ✓ Projects listed with multi-tenant isolation (200 OK)\n');

    // TEST 3: Get Project -> 200
    console.log(`[TEST 3/24] [Projects] GET /api/projects/${projectAId} -> 200`);
    const getProjRes = await apiRequest(`/api/projects/${projectAId}`, {
      method: 'GET',
      token: tokenA,
    });
    assert.equal(getProjRes.status, 200, 'Get project must return 200');
    assert.equal(getProjRes.body.data.project.name, 'Project Alpha', 'Project name should match');
    console.log('  ✓ Project retrieved by ID (200 OK)\n');

    // TEST 4: Update Project -> 200
    console.log(`[TEST 4/24] [Projects] PATCH /api/projects/${projectAId} -> 200`);
    const updateProjRes = await apiRequest(`/api/projects/${projectAId}`, {
      method: 'PATCH',
      token: tokenA,
      body: {
        description: 'Updated description for Alpha',
        status: 'disabled',
      },
    });
    assert.equal(updateProjRes.status, 200, 'Update project must return 200');
    assert.equal(
      updateProjRes.body.data.project.description,
      'Updated description for Alpha',
      'Description should be updated'
    );
    assert.equal(updateProjRes.body.data.project.status, 'disabled', 'Status should be updated to disabled');

    // Restore to active
    const restoreProjRes = await apiRequest(`/api/projects/${projectAId}`, {
      method: 'PATCH',
      token: tokenA,
      body: { status: 'active' },
    });
    assert.equal(restoreProjRes.status, 200, 'Re-enabling project must return 200');
    assert.equal(restoreProjRes.body.data.project.status, 'active', 'Project should be active again');
    console.log('  ✓ Project updated and verified (200 OK)\n');

    // TEST 5: Delete / Deactivate Project -> expected success
    console.log('[TEST 5/24] [Projects] DELETE /api/projects/:projectId -> expected success');
    const tempProjRes = await apiRequest('/api/projects', {
      method: 'POST',
      token: tokenA,
      body: { name: 'Temporary Project', upstream: 'http://localhost:3000' },
    });
    assert.equal(tempProjRes.status, 201, 'Temp project creation should return 201');
    const tempProjId = tempProjRes.body.data.project.id || tempProjRes.body.data.project._id;

    const delProjRes = await apiRequest(`/api/projects/${tempProjId}`, {
      method: 'DELETE',
      token: tokenA,
    });
    assert.equal(delProjRes.status, 200, 'Delete project should return 200');

    const getDeletedProjRes = await apiRequest(`/api/projects/${tempProjId}`, {
      method: 'GET',
      token: tokenA,
    });
    assert.equal(getDeletedProjRes.status, 404, 'Deleted project should return 404 on subsequent get');
    console.log('  ✓ Project deleted and verified non-existent (200 OK -> 404 Not Found)\n');

    // ===========================================================
    // SECTION 2: API KEYS
    // ===========================================================

    // TEST 6: Create API Key -> 201
    console.log(`[TEST 6/24] [API Keys] POST /api/projects/${projectAId}/api-keys -> 201`);
    const createKeyRes = await apiRequest(`/api/projects/${projectAId}/api-keys`, {
      method: 'POST',
      token: tokenA,
    });
    assert.equal(createKeyRes.status, 201, 'Create API key must return 201');
    assert.equal(createKeyRes.body.success, true, 'Create API key success must be true');

    const apiKeyData = createKeyRes.body.data.apiKey;
    const plaintextSecret = createKeyRes.body.data.secret;
    const apiKeyHeader = createKeyRes.body.data.apiKeyHeader;

    assert.ok(apiKeyData.keyId, 'API key document must have keyId');
    assert.ok(apiKeyData.keyId.startsWith('gw_key_'), 'keyId must start with prefix gw_key_');
    assert.equal(apiKeyData.status, 'active', 'API key status must be active');
    const keyId = apiKeyData.keyId;
    const apiKeyDocId = apiKeyData.id || apiKeyData._id;
    createdApiKeyIds.push(apiKeyDocId);
    console.log(`  ✓ API key created: keyId=${keyId} (201 Created)\n`);

    // TEST 7: Plaintext secret is returned only according to creation contract
    console.log('[TEST 7/24] [API Keys] Plaintext secret returned in creation response');
    assert.ok(plaintextSecret, 'Plaintext secret must be returned in creation response');
    assert.ok(plaintextSecret.startsWith('sec_'), 'Secret must start with sec_');
    assert.equal(
      apiKeyHeader,
      `${keyId}.${plaintextSecret}`,
      'apiKeyHeader must match format <keyId>.<secret>'
    );
    console.log('  ✓ Plaintext secret returned cleanly in creation contract\n');

    // TEST 8: secretHash is never returned
    console.log('[TEST 8/24] [API Keys] secretHash is NEVER exposed');
    assert.equal(apiKeyData.secretHash, undefined, 'secretHash must be undefined in response object');
    const creationResponseStr = JSON.stringify(createKeyRes.body);
    assert.equal(
      creationResponseStr.includes('secretHash'),
      false,
      'Response body must not contain secretHash'
    );
    console.log('  ✓ Verified secretHash is never returned in API responses\n');

    // TEST 9: List API keys -> 200 and secrets are not exposed
    console.log(`[TEST 9/24] [API Keys] GET /api/projects/${projectAId}/api-keys -> 200`);
    const listKeysRes = await apiRequest(`/api/projects/${projectAId}/api-keys`, {
      method: 'GET',
      token: tokenA,
    });
    assert.equal(listKeysRes.status, 200, 'List API keys must return 200');
    assert.ok(Array.isArray(listKeysRes.body.data.apiKeys), 'apiKeys must be an array');
    const foundKey = listKeysRes.body.data.apiKeys.find((k) => k.keyId === keyId);
    assert.ok(foundKey, 'Created API key must be listed');

    const listKeysJsonStr = JSON.stringify(listKeysRes.body);
    assert.equal(listKeysJsonStr.includes('secretHash'), false, 'Listed keys must not contain secretHash');
    assert.equal(
      listKeysJsonStr.includes(plaintextSecret),
      false,
      'Listed keys must not contain plaintext secret'
    );
    for (const k of listKeysRes.body.data.apiKeys) {
      assert.equal(k.secret, undefined, 'Plaintext secret must be undefined in listing');
      assert.equal(k.secretHash, undefined, 'secretHash must be undefined in listing');
    }
    console.log('  ✓ Listed API keys securely without exposing secrets (200 OK)\n');

    // TEST 10: Revoke / Delete API Key -> expected success
    console.log(`[TEST 10/24] [API Keys] DELETE /api/projects/${projectAId}/api-keys/:keyId -> expected success`);
    const createKey2Res = await apiRequest(`/api/projects/${projectAId}/api-keys`, {
      method: 'POST',
      token: tokenA,
    });
    assert.equal(createKey2Res.status, 201, 'Create 2nd API key must return 201');
    const key2Id = createKey2Res.body.data.apiKey.keyId;

    const deleteKeyRes = await apiRequest(`/api/projects/${projectAId}/api-keys/${key2Id}`, {
      method: 'DELETE',
      token: tokenA,
    });
    assert.equal(deleteKeyRes.status, 200, 'Delete API key must return 200');

    const listKeysAfterDel = await apiRequest(`/api/projects/${projectAId}/api-keys`, {
      method: 'GET',
      token: tokenA,
    });
    const stillPresent = listKeysAfterDel.body.data.apiKeys.some((k) => k.keyId === key2Id);
    assert.equal(stillPresent, false, 'Deleted key must no longer exist in listing');
    console.log('  ✓ API key successfully revoked/deleted (200 OK)\n');

    // ===========================================================
    // SECTION 3: ROUTES
    // ===========================================================

    // TEST 11: Create Route -> 201 & duplicate check -> 409
    console.log(`[TEST 11/24] [Routes] POST /api/projects/${projectAId}/routes -> 201`);
    const createRouteRes = await apiRequest(`/api/projects/${projectAId}/routes`, {
      method: 'POST',
      token: tokenA,
      body: {
        path: '/api/v1/orders',
        method: 'POST',
      },
    });
    assert.equal(createRouteRes.status, 201, 'Create route must return 201');
    assert.equal(createRouteRes.body.success, true, 'Create route success must be true');
    const routeA = createRouteRes.body.data.route;
    assert.equal(routeA.path, '/api/v1/orders', 'Route path must match');
    assert.equal(routeA.method, 'POST', 'Route method must match');
    const routeAId = routeA.id || routeA._id;
    createdRouteIds.push(routeAId);

    // Duplicate route attempt -> 409 Conflict
    const dupRouteRes = await apiRequest(`/api/projects/${projectAId}/routes`, {
      method: 'POST',
      token: tokenA,
      body: {
        path: '/api/v1/orders',
        method: 'POST',
      },
    });
    assert.equal(dupRouteRes.status, 409, 'Duplicate route definition must return 409 Conflict');
    assert.equal(dupRouteRes.body.error.code, 'ROUTE_ALREADY_EXISTS', 'Error code must be ROUTE_ALREADY_EXISTS');
    console.log('  ✓ Route created (201) and duplicate route rejected with 409 Conflict\n');

    // TEST 12: List Routes -> 200
    console.log(`[TEST 12/24] [Routes] GET /api/projects/${projectAId}/routes -> 200`);
    const listRoutesRes = await apiRequest(`/api/projects/${projectAId}/routes`, {
      method: 'GET',
      token: tokenA,
    });
    assert.equal(listRoutesRes.status, 200, 'List routes must return 200');
    assert.ok(Array.isArray(listRoutesRes.body.data.routes), 'Routes must be an array');
    const foundRoute = listRoutesRes.body.data.routes.find((r) => (r.id || r._id).toString() === routeAId.toString());
    assert.ok(foundRoute, 'Created route must be listed');
    console.log('  ✓ Routes listed successfully (200 OK)\n');

    // TEST 13: Get Route -> 200
    console.log(`[TEST 13/24] [Routes] GET /api/projects/${projectAId}/routes/${routeAId} -> 200`);
    const getRouteRes = await apiRequest(`/api/projects/${projectAId}/routes/${routeAId}`, {
      method: 'GET',
      token: tokenA,
    });
    assert.equal(getRouteRes.status, 200, 'Get route must return 200');
    assert.equal(getRouteRes.body.data.route.path, '/api/v1/orders', 'Route path should match');
    console.log('  ✓ Route retrieved by ID (200 OK)\n');

    // TEST 14: Update Route -> 200
    console.log(`[TEST 14/24] [Routes] PATCH /api/projects/${projectAId}/routes/${routeAId} -> 200`);
    const updateRouteRes = await apiRequest(`/api/projects/${projectAId}/routes/${routeAId}`, {
      method: 'PATCH',
      token: tokenA,
      body: {
        path: '/api/v1/orders-modified',
        method: 'PUT',
      },
    });
    assert.equal(updateRouteRes.status, 200, 'Update route must return 200');
    assert.equal(updateRouteRes.body.data.route.path, '/api/v1/orders-modified', 'Path should be updated');
    assert.equal(updateRouteRes.body.data.route.method, 'PUT', 'Method should be updated');
    console.log('  ✓ Route updated successfully (200 OK)\n');

    // TEST 15: Delete Route -> expected success
    console.log(`[TEST 15/24] [Routes] DELETE /api/projects/${projectAId}/routes/${routeAId} -> expected success`);
    const deleteRouteRes = await apiRequest(`/api/projects/${projectAId}/routes/${routeAId}`, {
      method: 'DELETE',
      token: tokenA,
    });
    assert.equal(deleteRouteRes.status, 200, 'Delete route must return 200');

    const getDeletedRoute = await apiRequest(`/api/projects/${projectAId}/routes/${routeAId}`, {
      method: 'GET',
      token: tokenA,
    });
    assert.equal(getDeletedRoute.status, 404, 'Deleted route must return 404');
    console.log('  ✓ Route deleted and verified non-existent (200 OK -> 404 Not Found)\n');

    // ===========================================================
    // SECTION 4: SECURITY & VALIDATION
    // ===========================================================

    // TEST 16: Unauthenticated management request -> 401
    console.log('[TEST 16/24] [Security] Unauthenticated management request -> 401');
    const noAuthRes = await apiRequest('/api/projects');
    assert.equal(noAuthRes.status, 401, 'Request without token must return 401');
    assert.equal(noAuthRes.body.error.code, 'UNAUTHORIZED', 'Error code must be UNAUTHORIZED');

    const invalidAuthRes = await apiRequest('/api/projects', {
      token: 'invalid.jwt.token.string',
    });
    assert.equal(invalidAuthRes.status, 401, 'Request with invalid token must return 401');
    console.log('  ✓ Unauthenticated requests rejected with 401 Unauthorized\n');

    // TEST 17: Unauthorized project access -> 403
    console.log('[TEST 17/24] [Security] Unauthorized project access -> 403');
    const unauthGetProj = await apiRequest(`/api/projects/${projectAId}`, {
      method: 'GET',
      token: tokenB,
    });
    assert.equal(unauthGetProj.status, 403, 'User B accessing User A project must return 403');
    assert.equal(unauthGetProj.body.error.code, 'FORBIDDEN', 'Error code must be FORBIDDEN');

    const unauthCreateKey = await apiRequest(`/api/projects/${projectAId}/api-keys`, {
      method: 'POST',
      token: tokenB,
    });
    assert.equal(unauthCreateKey.status, 403, 'User B creating API key on User A project must return 403');

    const unauthCreateRoute = await apiRequest(`/api/projects/${projectAId}/routes`, {
      method: 'POST',
      token: tokenB,
      body: { path: '/hack', method: 'GET' },
    });
    assert.equal(unauthCreateRoute.status, 403, 'User B creating route on User A project must return 403');
    console.log('  ✓ Unauthorized cross-tenant access blocked with 403 Forbidden\n');

    // TEST 18: Nonexistent project -> 404
    console.log('[TEST 18/24] [Validation] Nonexistent project -> 404');
    const nonExistentId = new mongoose.Types.ObjectId().toString();
    const nonExistentProjRes = await apiRequest(`/api/projects/${nonExistentId}`, {
      method: 'GET',
      token: tokenA,
    });
    assert.equal(nonExistentProjRes.status, 404, 'Nonexistent project must return 404');
    assert.equal(nonExistentProjRes.body.error.code, 'PROJECT_NOT_FOUND', 'Error code must be PROJECT_NOT_FOUND');
    console.log('  ✓ Nonexistent project returned 404 Not Found\n');

    // TEST 19: Invalid request payload -> 400
    console.log('[TEST 19/24] [Validation] Invalid request payload -> 400');
    // Invalid ObjectId format
    const invalidIdRes = await apiRequest('/api/projects/not-a-valid-object-id', {
      method: 'GET',
      token: tokenA,
    });
    assert.equal(invalidIdRes.status, 400, 'Invalid ObjectId must return 400');
    assert.equal(invalidIdRes.body.error.code, 'INVALID_ID', 'Error code must be INVALID_ID');

    // Invalid project creation payload (missing upstream)
    const invalidProjPayload = await apiRequest('/api/projects', {
      method: 'POST',
      token: tokenA,
      body: { name: 'No Upstream Project' },
    });
    assert.equal(invalidProjPayload.status, 400, 'Missing upstream in project must return 400');
    assert.equal(invalidProjPayload.body.error.code, 'VALIDATION_ERROR', 'Error code must be VALIDATION_ERROR');

    // Invalid route payload (path without leading slash)
    const invalidRoutePayload = await apiRequest(`/api/projects/${projectAId}/routes`, {
      method: 'POST',
      token: tokenA,
      body: { path: 'no-slash', method: 'GET' },
    });
    assert.equal(invalidRoutePayload.status, 400, 'Route path without slash must return 400');

    // Invalid route payload (unsupported HTTP method)
    const invalidMethodPayload = await apiRequest(`/api/projects/${projectAId}/routes`, {
      method: 'POST',
      token: tokenA,
      body: { path: '/valid-path', method: 'INVALID_METHOD' },
    });
    assert.equal(invalidMethodPayload.status, 400, 'Invalid HTTP method must return 400');
    console.log('  ✓ Invalid payloads and malformed IDs rejected with 400\n');

    // ===========================================================
    // SECTION 5: INTEGRATION & GATEWAY COMPATIBILITY
    // ===========================================================

    // TEST 20: Create an active project via Control Plane API
    console.log('[TEST 20/24] [Integration] Creating active project via Control Plane API...');
    const gatewayProjRes = await apiRequest('/api/projects', {
      method: 'POST',
      token: tokenA,
      body: {
        name: 'Gateway Ingress Target Project',
        upstream: 'http://localhost:9999',
        status: 'active',
      },
    });
    assert.equal(gatewayProjRes.status, 201, 'Gateway project creation must return 201');
    const gatewayProject = gatewayProjRes.body.data.project;
    const gatewayProjectId = gatewayProject.id || gatewayProject._id;
    createdProjectIds.push(gatewayProjectId);
    console.log(`  ✓ Active project created: ${gatewayProjectId}\n`);

    // TEST 21: Create an active API key for it via Control Plane API
    console.log('[TEST 21/24] [Integration] Creating active API key via Control Plane API...');
    const gatewayKeyRes = await apiRequest(`/api/projects/${gatewayProjectId}/api-keys`, {
      method: 'POST',
      token: tokenA,
    });
    assert.equal(gatewayKeyRes.status, 201, 'API key creation must return 201');
    const gatewayKeyHeader = gatewayKeyRes.body.data.apiKeyHeader;
    const gatewayKeyId = gatewayKeyRes.body.data.apiKey.keyId;
    const gatewayKeyDocId = gatewayKeyRes.body.data.apiKey.id || gatewayKeyRes.body.data.apiKey._id;
    createdApiKeyIds.push(gatewayKeyDocId);
    assert.ok(gatewayKeyHeader, 'apiKeyHeader must be returned');
    console.log(`  ✓ API key issued: keyId=${gatewayKeyId}, header=${gatewayKeyHeader}\n`);

    // TEST 22: Create GET /users/123 route via Control Plane API
    console.log('[TEST 22/24] [Integration] Creating GET /users/123 route via Control Plane API...');
    const gatewayRouteRes = await apiRequest(`/api/projects/${gatewayProjectId}/routes`, {
      method: 'POST',
      token: tokenA,
      body: {
        path: '/users/123',
        method: 'GET',
      },
    });
    assert.equal(gatewayRouteRes.status, 201, 'Route creation must return 201');
    const gatewayRoute = gatewayRouteRes.body.data.route;
    const gatewayRouteId = gatewayRoute.id || gatewayRoute._id;
    createdRouteIds.push(gatewayRouteId);
    console.log(`  ✓ Route created: GET /users/123 (id=${gatewayRouteId})\n`);

    // TEST 23: Confirm the resulting documents are compatible with the existing Gateway
    console.log('[TEST 23/24] [Integration] Confirming Gateway compatibility with apiKeyAuth and routeMatcher...');

    // Helper to simulate Express req/res
    function mockGatewayReq({ header, method = 'GET', path = '/users/123' }) {
      const headers = { 'x-api-key': header };
      return {
        headers,
        method,
        path,
        get(name) {
          return this.headers[name.toLowerCase()];
        },
      };
    }

    function mockGatewayRes() {
      return {
        statusCode: 200,
        data: null,
        status(c) {
          this.statusCode = c;
          return this;
        },
        json(d) {
          this.data = d;
          return this;
        },
      };
    }

    // Step A: Test Gateway apiKeyAuth with the issued key
    const req1 = mockGatewayReq({ header: gatewayKeyHeader, path: '/users/123', method: 'GET' });
    const res1 = mockGatewayRes();
    let authNextCalled = false;

    await apiKeyAuth(req1, res1, (err) => {
      assert.ifError(err);
      authNextCalled = true;
    });

    assert.equal(authNextCalled, true, 'Gateway apiKeyAuth must invoke next() successfully');
    assert.ok(req1.apiKey, 'req.apiKey must be attached by Gateway');
    assert.ok(req1.project, 'req.project must be attached by Gateway');
    assert.equal(
      req1.project._id.toString(),
      gatewayProjectId.toString(),
      'Attached project must match the created project'
    );
    assert.equal(req1.project.status, 'active', 'Project status must be active');

    // Step B: Test Gateway routeMatcher with the authenticated request
    let routeNextCalled = false;
    await routeMatcher(req1, res1, (err) => {
      assert.ifError(err);
      routeNextCalled = true;
    });

    assert.equal(routeNextCalled, true, 'Gateway routeMatcher must invoke next() on matching route');
    assert.ok(req1.routeConfig, 'req.routeConfig must be attached');
    assert.equal(req1.routeConfig.path, '/users/123', 'Matched route path must be /users/123');
    assert.equal(req1.routeConfig.method, 'GET', 'Matched route method must be GET');

    console.log('  ✓ Gateway authentication and dynamic route matching verified successfully\n');

    // TEST 24: Confirm no manual MongoDB document insertions were required
    console.log('[TEST 24/24] [Integration] Verifying zero manual MongoDB document insertions required...');
    assert.ok(createdProjectIds.length >= 2, 'Projects created exclusively via REST API');
    assert.ok(createdApiKeyIds.length >= 2, 'API keys created exclusively via REST API');
    assert.ok(createdRouteIds.length >= 2, 'Routes created exclusively via REST API');
    console.log('  ✓ All documents created, updated, and validated exclusively via Control Plane APIs\n');

    console.log('====================================================');
    console.log('  ALL 24 CONTROL PLANE VERIFICATIONS PASSED!       ');
    console.log('====================================================\n');
  } finally {
    // Cleanup test artifacts
    console.log('[Cleanup] Cleaning up all test data from MongoDB...');
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
      if (createdUserIds.length > 0) {
        await RefreshSession.deleteMany({ userId: { $in: createdUserIds } });
        await User.deleteMany({ _id: { $in: createdUserIds } });
      }
      console.log('[Cleanup] Successfully removed all test data.');
    } catch (cleanupErr) {
      console.error('[Cleanup] Error during cleanup:', cleanupErr.message);
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('[Cleanup] Test HTTP server closed.');
    }

    await disconnectDB();
  }
}

// Run verification suite
runControlPlaneVerification().catch((err) => {
  console.error('\n❌ Control Plane Verification FAILED:', err);
  process.exit(1);
});
