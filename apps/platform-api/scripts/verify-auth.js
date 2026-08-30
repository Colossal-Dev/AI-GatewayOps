/**
 * Verification Script for Sprint 1B — Authentication Foundation — Phase 1
 *
 * Tests all required verification scenarios against the Platform API:
 * 1. Register new user (ensures role is strictly 'developer', ignoring caller role)
 * 2. Role escalation prevention (public register with role: 'admin' must still create role: 'developer')
 * 3. Strict login input validation (non-string email/password returns 400 VALIDATION_ERROR)
 * 4. Duplicate registration rejection (409)
 * 5. Login with correct password
 * 6. Login with wrong password (401)
 * 7. Protected route without token (401)
 * 8. Protected route with invalid JWT (401)
 * 9. Refresh with valid refresh session (token rotation)
 * 10. Atomic refresh rotation concurrency test (concurrent claims on same token)
 * 11. Old refresh token cannot be reused (reuse detection -> family revocation)
 * 12. Logout revokes current refresh session
 * 13. Logout does not revoke other sessions (multi-device isolation)
 * 14. Authorization failure (403 for insufficient role)
 * 15. Health endpoint (/api/health) still works
 */

import http from 'http';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import RefreshSession from '../src/models/RefreshSession.js';

let server;
let baseUrl;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

function parseCookie(setCookieHeader, cookieName) {
  if (!setCookieHeader) return null;
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const c of cookies) {
    const parts = c.split(';')[0].split('=');
    if (parts[0].trim() === cookieName) {
      return parts.slice(1).join('=').trim();
    }
  }
  return null;
}

async function runTests() {
  console.log('====================================================');
  console.log('  STARTING SPRINT 1B AUTHENTICATION VERIFICATION   ');
  console.log('====================================================\n');

  // 1. Connect to Database & Start Server on ephemeral port
  await connectDB();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[Test Server] Running at ${baseUrl}\n`);

  // Clean test artifacts
  const testEmail = `test.dev.${Date.now()}@gatewayops.local`;
  const testAdminEmail = `test.admin.${Date.now()}@gatewayops.local`;
  const testPassword = 'StrongTestPassword123!';
  const wrongPassword = 'IncorrectPassword999!';

  try {
    // -----------------------------------------------------------
    // TEST 1: Health Endpoint
    // -----------------------------------------------------------
    console.log('[TEST 1/15] Verifying /api/health still works...');
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthJson = await healthRes.json();
    assert(healthRes.status === 200, `Health status code must be 200, got ${healthRes.status}`);
    assert(healthJson.success === true, 'Health response success must be true');
    console.log('  ✓ /api/health is operational (200 OK)\n');

    // -----------------------------------------------------------
    // TEST 2: Register New User & Role Escalation Prevention
    // -----------------------------------------------------------
    console.log('[TEST 2/15] Registering new user with attempted role escalation (role: "admin")...');
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        fullName: 'Test Developer',
        role: 'admin', // Attempted role escalation
      }),
    });
    const regJson = await regRes.json();
    assert(regRes.status === 201, `Register status should be 201, got ${regRes.status}`);
    assert(regJson.success === true, 'Register success should be true');
    assert(regJson.data?.user?.email === testEmail.toLowerCase(), 'Registered email should match');
    assert(regJson.data?.user?.role === 'developer', 'Public registration MUST always assign role "developer"');
    assert(regJson.data?.user?.passwordHash === undefined, 'passwordHash must NEVER be exposed in response');
    assert(regJson.data?.user?.id !== undefined, 'User id should be present');
    console.log('  ✓ User registered as "developer"; attempted role escalation ignored\n');

    // -----------------------------------------------------------
    // TEST 3: Duplicate Registration
    // -----------------------------------------------------------
    console.log('[TEST 3/15] Testing duplicate email registration rejection...');
    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail.toUpperCase(), // Test case normalization & duplicate check
        password: testPassword,
      }),
    });
    const dupJson = await dupRes.json();
    assert(dupRes.status === 409, `Duplicate register status should be 409, got ${dupRes.status}`);
    assert(dupJson.success === false, 'Duplicate register success must be false');
    assert(dupJson.error?.code === 'EMAIL_ALREADY_EXISTS', 'Error code must be EMAIL_ALREADY_EXISTS');
    console.log('  ✓ Duplicate registration successfully rejected with 409 Conflict\n');

    // -----------------------------------------------------------
    // TEST 4: Strict Login Input Validation (Non-String Protection)
    // -----------------------------------------------------------
    console.log('[TEST 4/15] Testing login with non-string and invalid input types...');
    const invalidInputs = [
      { email: 12345, password: 'somepassword' },
      { email: testEmail, password: 12345 },
      { email: null, password: testPassword },
      { email: testEmail, password: null },
      { email: {}, password: 'somepassword' },
      { email: '', password: testPassword },
    ];

    for (const invalidBody of invalidInputs) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidBody),
      });
      const json = await res.json();
      assert(res.status === 400, `Expected 400 for input ${JSON.stringify(invalidBody)}, got ${res.status}`);
      assert(json.error?.code === 'VALIDATION_ERROR', 'Error code must be VALIDATION_ERROR');
    }
    console.log('  ✓ Strict login validation rejected all non-string/invalid inputs with 400 VALIDATION_ERROR\n');

    // -----------------------------------------------------------
    // TEST 5: Login with Wrong Password
    // -----------------------------------------------------------
    console.log('[TEST 5/15] Testing login with wrong password...');
    const wrongLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: wrongPassword,
      }),
    });
    const wrongLoginJson = await wrongLoginRes.json();
    assert(wrongLoginRes.status === 401, `Wrong password status must be 401, got ${wrongLoginRes.status}`);
    assert(wrongLoginJson.success === false, 'Wrong password login success must be false');
    assert(wrongLoginJson.error?.code === 'INVALID_CREDENTIALS', 'Error code must be INVALID_CREDENTIALS');
    console.log('  ✓ Login with invalid credentials rejected with 401 Unauthorized\n');

    // -----------------------------------------------------------
    // TEST 6: Login with Correct Password
    // -----------------------------------------------------------
    console.log('[TEST 6/15] Testing login with correct password...');
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Device-1-Browser',
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    const loginJson = await loginRes.json();
    assert(loginRes.status === 200, `Login status must be 200, got ${loginRes.status}`);
    assert(loginJson.success === true, 'Login success must be true');
    assert(typeof loginJson.data?.accessToken === 'string', 'Login must return access JWT');
    assert(loginJson.data?.user?.passwordHash === undefined, 'No passwordHash in login response');

    // Check HttpOnly Cookie
    const rawSetCookie = loginRes.headers.get('set-cookie');
    const device1RefreshToken1 = parseCookie(rawSetCookie, 'refreshToken');
    assert(device1RefreshToken1 !== null, 'Login must set refreshToken cookie');
    assert(rawSetCookie.includes('HttpOnly'), 'Refresh cookie must be HttpOnly');
    console.log('  ✓ Login successful: access JWT returned, HttpOnly refresh cookie set\n');

    const accessToken1 = loginJson.data.accessToken;

    // -----------------------------------------------------------
    // TEST 7: Protected Route Without Token
    // -----------------------------------------------------------
    console.log('[TEST 7/15] Testing protected route without token...');
    const noTokenRes = await fetch(`${baseUrl}/api/auth/me`);
    const noTokenJson = await noTokenRes.json();
    assert(noTokenRes.status === 401, `Status must be 401, got ${noTokenRes.status}`);
    assert(noTokenJson.success === false, 'Success must be false');
    assert(noTokenJson.error?.code === 'UNAUTHORIZED', 'Error code must be UNAUTHORIZED');
    console.log('  ✓ Request without token rejected with 401 Unauthorized\n');

    // -----------------------------------------------------------
    // TEST 8: Protected Route With Invalid JWT
    // -----------------------------------------------------------
    console.log('[TEST 8/15] Testing protected route with invalid JWT...');
    const invalidTokenRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: 'Bearer invalid.jwt.signature' },
    });
    const invalidTokenJson = await invalidTokenRes.json();
    assert(invalidTokenRes.status === 401, `Status must be 401, got ${invalidTokenRes.status}`);
    assert(invalidTokenJson.success === false, 'Success must be false');
    assert(invalidTokenJson.error?.code === 'INVALID_TOKEN', 'Error code must be INVALID_TOKEN');
    console.log('  ✓ Request with invalid token rejected with 401 Unauthorized\n');

    // Verify valid access token access
    const validMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken1}` },
    });
    const validMeJson = await validMeRes.json();
    assert(validMeRes.status === 200, 'Valid access token should return 200');
    assert(validMeJson.data?.user?.email === testEmail.toLowerCase(), 'Profile email should match');
    console.log('  ✓ Authenticated request succeeded (GET /api/auth/me -> 200 OK)\n');

    // Verify refresh rejected if sent in body instead of cookie
    const bodyOnlyRefreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: device1RefreshToken1 }),
    });
    const bodyOnlyJson = await bodyOnlyRefreshRes.json();
    assert(bodyOnlyRefreshRes.status === 401, 'Refresh without cookie must return 401 even if body contains token');
    assert(bodyOnlyJson.error?.code === 'UNAUTHORIZED', 'Error code must be UNAUTHORIZED');
    console.log('  ✓ Refresh request without cookie rejected (body fallback strictly removed)');

    // -----------------------------------------------------------
    // TEST 9: Refresh Token Rotation
    // -----------------------------------------------------------
    console.log('[TEST 9/15] Testing refresh token rotation...');
    const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        Cookie: `refreshToken=${device1RefreshToken1}`,
        'User-Agent': 'Device-1-Browser',
      },
    });
    const refreshJson = await refreshRes.json();
    assert(refreshRes.status === 200, `Refresh status must be 200, got ${refreshRes.status}`);
    assert(refreshJson.success === true, 'Refresh success must be true');
    assert(typeof refreshJson.data?.accessToken === 'string', 'Refresh must return new accessToken');

    const rotatedSetCookie = refreshRes.headers.get('set-cookie');
    const device1RefreshToken2 = parseCookie(rotatedSetCookie, 'refreshToken');
    assert(device1RefreshToken2 !== null, 'Refresh must set rotated refreshToken cookie');
    assert(device1RefreshToken2 !== device1RefreshToken1, 'Rotated refresh token must be different from previous token');

    // Verify database state: old session is revoked, new session exists
    const oldHash = crypto.createHash('sha256').update(device1RefreshToken1).digest('hex');
    const newHash = crypto.createHash('sha256').update(device1RefreshToken2).digest('hex');

    const oldSession = await RefreshSession.findOne({ tokenHash: oldHash });
    const newSession = await RefreshSession.findOne({ tokenHash: newHash });

    assert(oldSession !== null && oldSession.revokedAt !== null, 'Old session must be marked revoked');
    assert(newSession !== null && newSession.revokedAt === null, 'New session must be active and not revoked');
    assert(oldSession.familyId === newSession.familyId, 'Rotated session must belong to the same familyId');
    console.log('  ✓ Refresh token successfully rotated, old session marked revoked in MongoDB\n');

    // -----------------------------------------------------------
    // TEST 10: Refresh Concurrency Test (Atomic Conditional Update)
    // -----------------------------------------------------------
    console.log('[TEST 10/15] Testing concurrent refresh token claims using the same token...');
    // Create a fresh session to test simultaneous concurrent rotation
    const concLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const concToken = parseCookie(concLoginRes.headers.get('set-cookie'), 'refreshToken');

    // Launch two simultaneous refresh requests with the EXACT SAME token
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { Cookie: `refreshToken=${concToken}` },
      }),
      fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { Cookie: `refreshToken=${concToken}` },
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // Exactly one must succeed (200) and the second must be rejected (401) due to atomic claim
    assert(
      (statuses[0] === 200 && statuses[1] === 401) || (statuses[0] === 401 && statuses[1] === 401),
      `Expected one 200 and one 401 on concurrent claim, got statuses: ${statuses.join(', ')}`
    );
    console.log(`  ✓ Concurrency handled atomically: statuses = [${statuses.join(', ')}]\n`);

    // -----------------------------------------------------------
    // TEST 11: Old Refresh Token Reuse Detection
    // -----------------------------------------------------------
    console.log('[TEST 11/15] Testing reuse detection of old revoked refresh token...');
    const reuseRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        Cookie: `refreshToken=${device1RefreshToken1}`, // Attempting to reuse old rotated token!
      },
    });
    const reuseJson = await reuseRes.json();
    assert(reuseRes.status === 401, `Token reuse must return 401, got ${reuseRes.status}`);
    assert(reuseJson.error?.code === 'REVOKED_TOKEN_REUSED', 'Error code must be REVOKED_TOKEN_REUSED');

    // Verify that the ENTIRE token family (including device1RefreshToken2) is now revoked
    const breachedActiveSession = await RefreshSession.findOne({
      familyId: oldSession.familyId,
      revokedAt: null,
    });
    assert(breachedActiveSession === null, 'All sessions in the family must be revoked after reuse breach');
    console.log('  ✓ Token reuse detected: Entire token family revoked, 401 returned\n');

    // -----------------------------------------------------------
    // TEST 12 & 13: Multi-Device Login & Isolated Logout
    // -----------------------------------------------------------
    console.log('[TEST 12/15 & 13/15] Testing multi-device session isolation and logout...');

    // Device A Login
    const devALoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Device-A' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const tokenA = parseCookie(devALoginRes.headers.get('set-cookie'), 'refreshToken');

    // Device B Login
    const devBLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Device-B' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const tokenB = parseCookie(devBLoginRes.headers.get('set-cookie'), 'refreshToken');

    assert(tokenA !== tokenB, 'Device A and Device B should have different refresh tokens');

    // Logout from Device A
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `refreshToken=${tokenA}` },
    });
    const logoutJson = await logoutRes.json();
    assert(logoutRes.status === 200, `Logout status should be 200, got ${logoutRes.status}`);
    assert(logoutJson.success === true, 'Logout success should be true');

    // Device A session should now be revoked
    const hashA = crypto.createHash('sha256').update(tokenA).digest('hex');
    const sessionA = await RefreshSession.findOne({ tokenHash: hashA });
    assert(sessionA.revokedAt !== null, 'Device A session must be revoked');

    // Device B session should STILL BE VALID and able to refresh
    const devBRefreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `refreshToken=${tokenB}` },
    });
    const devBRefreshJson = await devBRefreshRes.json();
    assert(devBRefreshRes.status === 200, `Device B refresh should succeed with 200, got ${devBRefreshRes.status}`);
    assert(devBRefreshJson.success === true, 'Device B refresh success must be true');
    console.log('  ✓ Logout revokes current session without affecting other device sessions\n');

    // -----------------------------------------------------------
    // TEST 14: Authorization (403 for insufficient role)
    // -----------------------------------------------------------
    console.log('[TEST 14/15] Testing role-based authorization (403 check)...');

    // 14a. Developer role accessing admin-check -> 403 Forbidden
    const devAccessAdminRes = await fetch(`${baseUrl}/api/auth/admin-check`, {
      headers: { Authorization: `Bearer ${accessToken1}` },
    });
    const devAccessAdminJson = await devAccessAdminRes.json();
    assert(devAccessAdminRes.status === 403, `Developer access to admin route must return 403, got ${devAccessAdminRes.status}`);
    assert(devAccessAdminJson.error?.code === 'FORBIDDEN', 'Error code must be FORBIDDEN');
    console.log('  ✓ Non-admin user blocked with 403 Forbidden on admin endpoint');

    // 14b. Direct internal seeding of Admin (simulating internal provisioning) -> 200 OK on admin-check
    const adminPasswordHash = await bcrypt.hash(testPassword, 10);
    await User.create({
      email: testAdminEmail,
      passwordHash: adminPasswordHash,
      fullName: 'System Admin',
      role: 'admin',
    });

    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testAdminEmail, password: testPassword }),
    });
    const adminLoginJson = await adminLoginRes.json();
    const adminToken = adminLoginJson.data.accessToken;

    const adminAccessRes = await fetch(`${baseUrl}/api/auth/admin-check`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminAccessRes.status === 200, `Admin access must return 200, got ${adminAccessRes.status}`);
    console.log('  ✓ Admin user granted access to admin endpoint (200 OK)\n');

    // -----------------------------------------------------------
    // ALL TESTS PASSED
    // -----------------------------------------------------------
    console.log('====================================================');
    console.log('  ALL 15 VERIFICATION TESTS PASSED SUCCESSFULLY!    ');
    console.log('====================================================');
  } finally {
    // Cleanup database & stop server
    try {
      await User.deleteMany({ email: { $in: [testEmail.toLowerCase(), testAdminEmail.toLowerCase()] } });
      await RefreshSession.deleteMany({ userId: { $in: await User.find({ email: { $in: [testEmail, testAdminEmail] } }).distinct('_id') } });
    } catch (_) {}

    if (server) {
      server.close();
    }
    await disconnectDB();
  }
}

runTests().catch((err) => {
  console.error('\n❌ VERIFICATION TEST FAILED:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
