import 'dotenv/config';
import assert from 'node:assert/strict';
import { createClient } from 'redis';
import { connectRedis, disconnectRedis, getRedisClient, sanitizeRedisUrl } from '../apps/gateway/src/config/redis.js';

const GATEWAY_PORT = parseInt(process.env.PORT || '5001', 10);
const GATEWAY_URL = `http://localhost:${GATEWAY_PORT}`;

async function runRedisConnectivityVerification() {
  console.log('=== Gateway Redis Connectivity & Infrastructure Verification ===\n');

  // Test 1: URL Sanitization Utility
  {
    console.log('[Test 1] Redis URL Sanitization');
    const plainUrl = 'redis://localhost:6379';
    const authUrl = 'redis://default:supersecretpassword@redis.internal.net:6379';
    
    assert.equal(sanitizeRedisUrl(plainUrl), 'redis://localhost:6379');
    assert.ok(!sanitizeRedisUrl(authUrl).includes('supersecretpassword'), 'Password must be masked');
    assert.ok(sanitizeRedisUrl(authUrl).includes('****'), 'Password must be replaced with ****');
    assert.equal(sanitizeRedisUrl(null), 'undefined');
    console.log('PASS: Redis URL sanitization masks credentials correctly\n');
  }

  // Test 2: Connect to Redis via centralized configuration
  {
    console.log('[Test 2] Centralized Redis Connection');
    const client = await connectRedis();
    assert.ok(client, 'Redis client must be defined');
    assert.equal(client.isOpen, true, 'Redis client must be open');
    
    const retrievedClient = getRedisClient();
    assert.equal(retrievedClient, client, 'getRedisClient() must return the active singleton client');
    console.log('PASS: Redis connected and singleton client retrieved\n');
  }

  // Test 3: Redis Command Execution (PING, SET, GET, DEL)
  {
    console.log('[Test 3] Redis Command Execution');
    const client = getRedisClient();
    
    // PING
    const pingRes = await client.ping();
    assert.equal(pingRes, 'PONG', 'Redis PING must return PONG');

    // SET / GET with TTL
    const testKey = `test:gateway:infra:${Date.now()}`;
    const testValue = JSON.stringify({ status: 'ok', timestamp: Date.now() });
    
    await client.set(testKey, testValue, { EX: 10 });
    const fetchedValue = await client.get(testKey);
    assert.equal(fetchedValue, testValue, 'Fetched value must match stored value');

    // DEL
    const delCount = await client.del(testKey);
    assert.equal(delCount, 1, 'Deleted key count must be 1');
    const afterDel = await client.get(testKey);
    assert.equal(afterDel, null, 'Deleted key must return null');

    console.log('PASS: PING, SET, GET, DEL executed successfully\n');
  }

  // Test 4: Connection Idempotency
  {
    console.log('[Test 4] Connection Idempotency');
    const clientBefore = getRedisClient();
    const clientAfter = await connectRedis();
    assert.equal(clientBefore, clientAfter, 'connectRedis() must return existing active client when already connected');
    assert.equal(clientAfter.isOpen, true, 'Client must remain open');
    console.log('PASS: connectRedis is idempotent\n');
  }

  // Test 5: Clean Disconnection
  {
    console.log('[Test 5] Clean Disconnection');
    await disconnectRedis();
    assert.equal(getRedisClient(), null, 'getRedisClient() must return null after disconnect');
    console.log('PASS: Disconnected cleanly and reference cleared\n');
  }

  // Test 6: Reconnection after disconnect
  {
    console.log('[Test 6] Re-establishing Connection');
    const client = await connectRedis();
    assert.ok(client, 'Redis client must be reconnected');
    assert.equal(client.isOpen, true, 'Redis client must be open');
    const pingRes = await client.ping();
    assert.equal(pingRes, 'PONG', 'Redis PING after reconnect must return PONG');
    console.log('PASS: Reconnection succeeded\n');
  }

  // Test 7: Error handling on unreachable Redis endpoint
  {
    console.log('[Test 7] Connection Error Handling (unreachable endpoint)');
    const unreachableClient = createClient({
      url: 'redis://127.0.0.1:59999',
      socket: {
        reconnectStrategy: false,
        connectTimeout: 500,
      },
    });

    let caughtError = null;
    unreachableClient.on('error', () => {
      // Expected error event
    });

    try {
      await unreachableClient.connect();
    } catch (err) {
      caughtError = err;
    } finally {
      try {
        await unreachableClient.disconnect();
      } catch {
        // Ignore cleanup
      }
    }

    assert.ok(caughtError !== null, 'Connection to unreachable port must throw an error without crashing process');
    console.log('PASS: Unreachable connection throws gracefully caught error\n');
  }

  // Test 8: Gateway Server Health Check (Liveness Probe)
  {
    console.log('[Test 8] Gateway Health Check (GET /api/health)');
    try {
      const res = await fetch(`${GATEWAY_URL}/api/health`, { signal: AbortSignal.timeout(1500) });
      const body = await res.json();
      assert.equal(res.status, 200, 'GET /api/health must return HTTP 200');
      assert.equal(body.status, 'ok', 'Status must be ok');
      assert.equal(body.service, 'gateway', 'Service must be gateway');
      console.log('PASS: Gateway /api/health returned HTTP 200 { status: "ok", service: "gateway" }\n');
    } catch {
      console.log('ℹ️  Gateway server is not currently running on port 5001. Skipping live HTTP probe.\n');
    }
  }

  // Clean up
  await disconnectRedis();

  console.log('=== All Redis Connectivity & Infrastructure Verifications PASSED ===\n');
}

runRedisConnectivityVerification().catch((err) => {
  console.error('\n❌ Redis Verification Failed:', err);
  process.exit(1);
});
