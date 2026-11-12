import http from "node:http";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import app from "../apps/gateway/src/app.js";
import APIKey from "../apps/gateway/src/models/api-key.model.js";
import Project from "../apps/gateway/src/models/project.model.js";
import Route from "../apps/gateway/src/models/route.model.js";

// Start gateway server on an ephemeral port
function startGatewayServer() {
  const server = http.createServer(app);

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
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

// Start mock upstream server
function startMockUpstreamServer() {
  let lastReceivedRequest = null;
  let customResponseConfig = null;

  const server = http.createServer((req, res) => {
    let rawBody = "";

    req.on("data", (chunk) => {
      rawBody += chunk;
    });

    req.on("end", () => {
      lastReceivedRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: rawBody,
      };

      if (customResponseConfig) {
        res.writeHead(
          customResponseConfig.status || 200,
          customResponseConfig.headers || {
            "content-type": "application/json",
          },
        );

        res.end(customResponseConfig.body || "");
      } else {
        res.writeHead(200, {
          "content-type": "application/json",
          "x-upstream-service": "mock-backend-v1",
        });

        res.end(
          JSON.stringify({
            status: "upstream_ok",
            receivedUrl: req.url,
          }),
        );
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;

      resolve({
        server,
        baseUrl,
        getLastRequest: () => lastReceivedRequest,
        setResponse: (config) => {
          customResponseConfig = config;
        },
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

async function runTests() {
  console.log(
    "=== Gateway Application & Middleware Chain Verification Suite ===\n",
  );

  const upstream = await startMockUpstreamServer();
  const gateway = await startGatewayServer();

  const testSecret = "sec_live_gateway_integration_test_secret";
  const hashedSecret = await bcrypt.hash(testSecret, 10);

  const activeProjectId = "64abc1234567890123456789";
  const disabledProjectId = "64def9876543210987654321";

  const mockActiveProject = {
    _id: activeProjectId,
    id: activeProjectId,
    name: "Active Test Service",
    status: "active",
    upstream: upstream.baseUrl,
  };

  const mockDisabledProject = {
    _id: disabledProjectId,
    id: disabledProjectId,
    name: "Disabled Service",
    status: "inactive",
    upstream: upstream.baseUrl,
  };

  const mockActiveApiKey = {
    _id: "key_doc_active_1",
    keyId: "gw_key_valid_active",
    projectId: activeProjectId,
    secretHash: hashedSecret,
    status: "active",
  };

  const mockDisabledApiKey = {
    _id: "key_doc_disabled_1",
    keyId: "gw_key_disabled_proj",
    projectId: disabledProjectId,
    secretHash: hashedSecret,
    status: "active",
  };

  // IMPORTANT: Routes use route-level upstreamUrl
  const mockRoutes = [
    {
      _id: "route_users_detail",
      projectId: activeProjectId,
      path: "/users/:id",
      method: "GET",
      upstreamUrl: upstream.baseUrl,
      cache: {
        enabled: true,
        ttlSeconds: 60,
      },
    },
    {
      _id: "route_chat_completions",
      projectId: activeProjectId,
      path: "/v1/chat/completions",
      method: "POST",
      upstreamUrl: upstream.baseUrl,
      cache: {
        enabled: false,
        ttlSeconds: 60,
      },
    },
  ];

  // Mock database model methods
  const originalApiKeyFindOne = APIKey.findOne;
  const originalProjectFindById = Project.findById;
  const originalRouteFind = Route.find;

  APIKey.findOne = async (query) => {
    if (query?.keyId === mockActiveApiKey.keyId) {
      return mockActiveApiKey;
    }

    if (query?.keyId === mockDisabledApiKey.keyId) {
      return mockDisabledApiKey;
    }

    return null;
  };

  Project.findById = async (id) => {
    if (id === activeProjectId) {
      return mockActiveProject;
    }

    if (id === disabledProjectId) {
      return mockDisabledProject;
    }

    return null;
  };

  Route.find = async (query) => {
    const { projectId, method } = query;

    return mockRoutes.filter(
      (route) => route.projectId === projectId && route.method === method,
    );
  };

  try {
    // ---------------------------------------------------------
    // Test 1: Public Health Check
    // ---------------------------------------------------------
    {
      console.log("[Test 1] Public Health Check Route");

      const res = await fetch(`${gateway.baseUrl}/api/health`);
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.status, "ok");
      assert.equal(body.service, "gateway");

      console.log(
        "  -> PASS: Health check accessible without authentication\n",
      );
    }

    // ---------------------------------------------------------
    // Test 2: Missing API Key
    // ---------------------------------------------------------
    {
      console.log("[Test 2] Missing X-API-Key");

      const res = await fetch(`${gateway.baseUrl}/proxy/users/42`);
      const body = await res.json();

      assert.equal(res.status, 401);
      assert.equal(body.success, false);
      assert.equal(body.error?.code, "UNAUTHORIZED");
      assert.equal(upstream.getLastRequest(), null);

      console.log("  -> PASS: Missing API key rejected with 401\n");
    }

    // ---------------------------------------------------------
    // Test 3: Invalid API Key Secret
    // ---------------------------------------------------------
    {
      console.log("[Test 3] Invalid API Key Secret");

      const res = await fetch(`${gateway.baseUrl}/proxy/users/42`, {
        headers: {
          "X-API-Key": `${mockActiveApiKey.keyId}.wrong_secret`,
        },
      });

      const body = await res.json();

      assert.equal(res.status, 401);
      assert.equal(body.error?.code, "UNAUTHORIZED");
      assert.equal(upstream.getLastRequest(), null);

      console.log("  -> PASS: Invalid secret rejected with 401\n");
    }

    // ---------------------------------------------------------
    // Test 4: Disabled Project
    // ---------------------------------------------------------
    {
      console.log("[Test 4] Disabled Project");

      const res = await fetch(`${gateway.baseUrl}/proxy/users/42`, {
        headers: {
          "X-API-Key": `${mockDisabledApiKey.keyId}.${testSecret}`,
        },
      });

      const body = await res.json();

      assert.equal(res.status, 403);
      assert.equal(body.error?.code, "PROJECT_DISABLED");
      assert.equal(upstream.getLastRequest(), null);

      console.log("  -> PASS: Disabled project rejected with 403\n");
    }

    // ---------------------------------------------------------
    // Test 5: Unmatched Route
    // ---------------------------------------------------------
    {
      console.log("[Test 5] Unmatched Route");

      const res = await fetch(`${gateway.baseUrl}/proxy/nonexistent/endpoint`, {
        headers: {
          "X-API-Key": `${mockActiveApiKey.keyId}.${testSecret}`,
        },
      });

      const body = await res.json();

      assert.equal(res.status, 404);
      assert.equal(body.error?.code, "ROUTE_NOT_FOUND");
      assert.equal(upstream.getLastRequest(), null);

      console.log("  -> PASS: Unmatched route rejected with 404\n");
    }

    // ---------------------------------------------------------
    // Test 6: Method Mismatch
    // ---------------------------------------------------------
    {
      console.log("[Test 6] Method Mismatch");

      const res = await fetch(`${gateway.baseUrl}/proxy/users/42`, {
        method: "DELETE",
        headers: {
          "X-API-Key": `${mockActiveApiKey.keyId}.${testSecret}`,
        },
      });

      const body = await res.json();

      assert.equal(res.status, 404);
      assert.equal(body.error?.code, "ROUTE_NOT_FOUND");
      assert.equal(upstream.getLastRequest(), null);

      console.log("  -> PASS: Method mismatch rejected with 404\n");
    }

    // ---------------------------------------------------------
    // Test 7: GET Proxy Forwarding
    // ---------------------------------------------------------
    {
      console.log("[Test 7] GET Proxy Forwarding");

      upstream.setResponse({
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-upstream-custom": "header-ok",
        },
        body: JSON.stringify({
          userId: "42",
          name: "Alice Developer",
        }),
      });

      const res = await fetch(
        `${gateway.baseUrl}/proxy/users/42?queryParam=active&sort=desc`,
        {
          headers: {
            "X-API-Key": `${mockActiveApiKey.keyId}.${testSecret}`,
            "X-Client-App": "web-client-v2",
          },
        },
      );

      const body = await res.json();
      const lastReq = upstream.getLastRequest();

      assert.equal(res.status, 200);
      assert.equal(res.headers.get("x-upstream-custom"), "header-ok");

      assert.equal(body.userId, "42");
      assert.equal(body.name, "Alice Developer");

      assert.equal(lastReq.method, "GET");
      assert.equal(lastReq.url, "/users/42?queryParam=active&sort=desc");

      assert.equal(lastReq.headers["x-client-app"], "web-client-v2");

      assert.equal(lastReq.headers["x-api-key"], undefined);

      console.log("  -> PASS: GET forwarded correctly\n");
    }

    // ---------------------------------------------------------
    // Test 8: POST Root Ingress
    // ---------------------------------------------------------
    {
      console.log("[Test 8] POST Root Ingress");

      upstream.setResponse({
        status: 201,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "chat_resp_1",
          choices: [
            {
              message: {
                content: "Hello!",
              },
            },
          ],
        }),
      });

      const payload = {
        model: "gemini-pro",
        messages: [
          {
            role: "user",
            content: "Say hello",
          },
        ],
      };

      const res = await fetch(`${gateway.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": `${mockActiveApiKey.keyId}.${testSecret}`,
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      const lastReq = upstream.getLastRequest();

      assert.equal(res.status, 201);
      assert.equal(body.id, "chat_resp_1");
      assert.equal(lastReq.method, "POST");
      assert.equal(lastReq.url, "/v1/chat/completions");

      assert.deepEqual(JSON.parse(lastReq.body), payload);

      console.log("  -> PASS: POST body forwarded correctly\n");
    }

    // ---------------------------------------------------------
    // Test 9: Upstream Failure
    // ---------------------------------------------------------
    {
      console.log("[Test 9] Upstream Failure");

      const usersRoute = mockRoutes.find(
        (route) => route._id === "route_users_detail",
      );

      const originalUsersUpstreamUrl = usersRoute.upstreamUrl;

      try {
        usersRoute.upstreamUrl = "http://127.0.0.1:59999";

        const res = await fetch(`${gateway.baseUrl}/proxy/users/42`, {
          headers: {
            "X-API-Key": `${mockActiveApiKey.keyId}.${testSecret}`,
          },
        });

        const body = await res.json();

        assert.equal(res.status, 502);
        assert.equal(body.success, false);
        assert.equal(body.error?.code, "BAD_GATEWAY");
      } finally {
        usersRoute.upstreamUrl = originalUsersUpstreamUrl;
      }

      console.log("  -> PASS: Upstream failure handled as 502 BAD_GATEWAY\n");
    }

    console.log("=== ALL 9 GATEWAY PIPELINE VERIFICATION TESTS PASSED! ===\n");
  } finally {
    // Restore original database methods
    APIKey.findOne = originalApiKeyFindOne;
    Project.findById = originalProjectFindById;
    Route.find = originalRouteFind;

    // Close servers
    await gateway.close();
    await upstream.close();
  }
}

runTests().catch((err) => {
  console.error("\n❌ Verification Failed:", err);
  process.exit(1);
});
