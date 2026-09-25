import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import apiKeyAuth from '../apps/gateway/src/middleware/apiKeyAuth.js';
import APIKey from '../apps/gateway/src/models/api-key.model.js';
import Project from '../apps/gateway/src/models/project.model.js';

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

function createMockReq(headers = {}) {
  const normalizedHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    normalizedHeaders[k.toLowerCase()] = v;
  }
  return {
    headers: normalizedHeaders,
    get(name) {
      return this.headers[name.toLowerCase()];
    },
  };
}

async function runTests() {
  console.log('=== apiKeyAuth Middleware Verification Suite ===\n');

  const testSecret = 'sec_live_test_secret_999';
  const hashedSecret = await bcrypt.hash(testSecret, 10);
  const testProjectId = '64abc1234567890123456789';

  const mockApiKeyDoc = {
    _id: 'key_doc_id_1',
    keyId: 'gw_key_valid123',
    projectId: testProjectId,
    secretHash: hashedSecret,
    status: 'active',
  };

  const mockProjectDoc = {
    _id: testProjectId,
    name: 'Production Service',
    status: 'active',
    upstream: 'https://api.internal.service',
  };

  // Test 1: Missing X-API-Key header
  {
    console.log('[Test 1] Missing X-API-Key header');
    const req = createMockReq({});
    const res = createMockRes();
    let nextCalled = false;

    await apiKeyAuth(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401, 'Should return HTTP 401');
    assert.equal(res.jsonData?.error?.code, 'UNAUTHORIZED');
    assert.equal(nextCalled, false, 'next() should not be called');
    console.log('  -> PASS: returns 401 UNAUTHORIZED on missing header\n');
  }

  // Test 2: Malformed X-API-Key header variations
  {
    console.log('[Test 2] Malformed X-API-Key headers');
    const malformedHeaders = [
      'nokeydot',
      '.onlysecret',
      'onlykeyid.',
      '   .   ',
      '',
    ];

    for (const badHeader of malformedHeaders) {
      const req = createMockReq({ 'x-api-key': badHeader });
      const res = createMockRes();
      let nextCalled = false;

      await apiKeyAuth(req, res, () => { nextCalled = true; });

      assert.equal(res.statusCode, 401, `Should return 401 for header: "${badHeader}"`);
      assert.equal(res.jsonData?.error?.code, 'UNAUTHORIZED');
      assert.equal(nextCalled, false);
    }
    console.log('  -> PASS: all malformed variations return 401 UNAUTHORIZED\n');
  }

  // Test 3: APIKey not found in DB
  {
    console.log('[Test 3] Non-existent keyId (APIKey.findOne returns null)');
    const originalFindOne = APIKey.findOne;
    let queryUsed = null;
    APIKey.findOne = async (query) => {
      queryUsed = query;
      return null;
    };

    const req = createMockReq({ 'x-api-key': 'gw_key_nonexistent.some_secret' });
    const res = createMockRes();
    let nextCalled = false;

    await apiKeyAuth(req, res, () => { nextCalled = true; });

    assert.deepEqual(queryUsed, { keyId: 'gw_key_nonexistent' }, 'Must query by keyId only');
    assert.equal(res.statusCode, 401, 'Should return HTTP 401');
    assert.equal(res.jsonData?.error?.code, 'UNAUTHORIZED');
    assert.equal(nextCalled, false);

    APIKey.findOne = originalFindOne;
    console.log('  -> PASS: queries DB using { keyId } and returns 401 when not found\n');
  }

  // Test 4: Revoked API key
  {
    console.log('[Test 4] Revoked API key (apiKey.status !== "active")');
    const originalFindOne = APIKey.findOne;
    APIKey.findOne = async () => ({ ...mockApiKeyDoc, status: 'revoked' });

    const req = createMockReq({ 'x-api-key': 'gw_key_valid123.sec_live_test_secret_999' });
    const res = createMockRes();
    let nextCalled = false;

    await apiKeyAuth(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401, 'Should return HTTP 401');
    assert.equal(res.jsonData?.error?.code, 'UNAUTHORIZED');
    assert.equal(res.jsonData?.error?.message, 'Invalid API key');
    assert.equal(nextCalled, false);

    APIKey.findOne = originalFindOne;
    console.log('  -> PASS: returns 401 when apiKey.status is revoked\n');
  }

  // Test 5: Invalid secret (bcrypt comparison mismatch)
  {
    console.log('[Test 5] Invalid secret against secretHash (bcrypt compare fails)');
    const originalFindOne = APIKey.findOne;
    APIKey.findOne = async () => ({ ...mockApiKeyDoc });

    const req = createMockReq({ 'x-api-key': 'gw_key_valid123.wrong_secret' });
    const res = createMockRes();
    let nextCalled = false;

    await apiKeyAuth(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401, 'Should return HTTP 401');
    assert.equal(res.jsonData?.error?.code, 'UNAUTHORIZED');
    assert.equal(nextCalled, false);

    APIKey.findOne = originalFindOne;
    console.log('  -> PASS: returns 401 when bcrypt verification fails\n');
  }

  // Test 6: Non-existent associated Project
  {
    console.log('[Test 6] Non-existent associated Project (Project.findById returns null)');
    const originalFindOne = APIKey.findOne;
    const originalFindById = Project.findById;

    APIKey.findOne = async () => ({ ...mockApiKeyDoc });
    let queriedProjectId = null;
    Project.findById = async (id) => {
      queriedProjectId = id;
      return null;
    };

    const req = createMockReq({ 'x-api-key': `gw_key_valid123.${testSecret}` });
    const res = createMockRes();
    let nextCalled = false;

    await apiKeyAuth(req, res, () => { nextCalled = true; });

    assert.equal(queriedProjectId, testProjectId, 'Must query Project by apiKey.projectId');
    assert.equal(res.statusCode, 403, 'Should return HTTP 403 (or 401 safe generic error)');
    assert.equal(res.jsonData?.error?.code, 'FORBIDDEN');
    assert.equal(nextCalled, false);

    APIKey.findOne = originalFindOne;
    Project.findById = originalFindById;
    console.log('  -> PASS: returns safe generic 403 error when project does not exist\n');
  }

  // Test 7: Disabled Project
  {
    console.log('[Test 7] Disabled Project (project.status !== "active")');
    const originalFindOne = APIKey.findOne;
    const originalFindById = Project.findById;

    APIKey.findOne = async () => ({ ...mockApiKeyDoc });
    Project.findById = async () => ({ ...mockProjectDoc, status: 'disabled' });

    const req = createMockReq({ 'x-api-key': `gw_key_valid123.${testSecret}` });
    const res = createMockRes();
    let nextCalled = false;

    await apiKeyAuth(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 403, 'Should return HTTP 403');
    assert.equal(res.jsonData?.error?.code, 'PROJECT_DISABLED');
    assert.equal(nextCalled, false);

    APIKey.findOne = originalFindOne;
    Project.findById = originalFindById;
    console.log('  -> PASS: returns 403 PROJECT_DISABLED when project is disabled\n');
  }

  // Test 8: Successful Authentication
  {
    console.log('[Test 8] Successful Authentication (Valid key, secret, and active project)');
    const originalFindOne = APIKey.findOne;
    const originalFindById = Project.findById;

    APIKey.findOne = async () => ({ ...mockApiKeyDoc });
    Project.findById = async () => ({ ...mockProjectDoc });

    // Test case-insensitive header extraction (X-API-Key)
    const req = createMockReq({ 'X-API-Key': `gw_key_valid123.${testSecret}` });
    const res = createMockRes();
    let nextCalled = false;

    await apiKeyAuth(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true, 'next() must be called on successful authentication');
    assert.deepEqual(req.apiKey, mockApiKeyDoc, 'req.apiKey must be attached');
    assert.deepEqual(req.project, mockProjectDoc, 'req.project must be attached');
    assert.equal(res.statusCode, null, 'res.status should not be modified on success');

    APIKey.findOne = originalFindOne;
    Project.findById = originalFindById;
    console.log('  -> PASS: attached req.apiKey and req.project and invoked next()\n');
  }

  console.log('=== All 8 validation checks PASSED successfully! ===');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
