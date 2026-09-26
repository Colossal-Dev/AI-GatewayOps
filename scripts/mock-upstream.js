import http from 'node:http';
import { fileURLToPath } from 'node:url';

// Default to port 6001 (Port 6000 is blocked by WHATWG Fetch / Undici X11 security rule)
const PORT = parseInt(process.env.MOCK_UPSTREAM_PORT || '6001', 10);
let requestLog = [];

/**
 * Creates the mock upstream HTTP server.
 * Handles GET /users/123 with the required JSON payload.
 *
 * @returns {http.Server}
 */
export function createMockUpstreamServer() {
  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });

    req.on('end', () => {
      const entry = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: rawBody,
        timestamp: new Date().toISOString(),
      };
      requestLog.push(entry);

      if (req.method === 'GET' && req.url === '/users/123') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            success: true,
            source: 'mock-upstream',
            message: 'Request reached upstream',
          })
        );
      }

      // Default response for other test paths
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          success: true,
          source: 'mock-upstream',
          path: req.url,
          method: req.method,
        })
      );
    });
  });

  return server;
}

/**
 * Starts the mock upstream server on the specified port.
 *
 * @param {number} [port=PORT]
 * @returns {Promise<{ server: http.Server, port: number, getRequestCount: Function, getLastRequest: Function, getRequests: Function, clearRequests: Function, close: Function }>}
 */
export function startMockUpstream(port = PORT) {
  const server = createMockUpstreamServer();
  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      console.log(`[Mock Upstream] Listening on http://localhost:${port}`);
      resolve({
        server,
        port,
        getRequestCount: () => requestLog.length,
        getLastRequest: () => (requestLog.length > 0 ? requestLog[requestLog.length - 1] : null),
        getRequests: () => [...requestLog],
        clearRequests: () => {
          requestLog = [];
        },
        close: () =>
          new Promise((res, rej) =>
            server.close((err) => (err ? rej(err) : res()))
          ),
      });
    });
    server.on('error', reject);
  });
}

// Auto-start if executed directly from CLI
const isDirectExecution =
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();

if (isDirectExecution) {
  startMockUpstream(PORT).catch((err) => {
    console.error('[Mock Upstream] Startup error:', err);
    process.exit(1);
  });
}
