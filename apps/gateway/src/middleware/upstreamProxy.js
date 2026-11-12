import { createHash } from "node:crypto";
import {
  getCache,
  setCache,
  invalidateProjectResponseCache,
} from "../utils/cache.js";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "x-api-key",
]);

const CACHE_VARY_HEADERS = [
  "authorization",
  "cookie",
  "accept",
  "accept-language",
];

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const CACHEABLE_STATUS_CODES = new Set([200, 203, 204, 206]);

/**
 * Generate a project-specific response cache key.
 */
function createCacheKey(req, targetUrl) {
  const identity = {};

  for (const header of CACHE_VARY_HEADERS) {
    identity[header] = req.headers[header] || "";
  }

  const identityHash = createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex");

  const projectId = req.project._id.toString();
  const routeId = req.routeConfig._id.toString();

  const rawKey = [routeId, targetUrl, identityHash].join(":");

  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  return `gateway:response:${projectId}:${keyHash}`;
}

/**
 * Construct the upstream URL.
 *
 * routeConfig.upstreamUrl should contain the upstream base URL.
 * Example: https://jsonplaceholder.typicode.com
 */
function buildUpstreamUrl(req) {
  const upstreamBase = req.routeConfig.upstreamUrl;

  if (!upstreamBase) {
    throw new Error("Upstream URL is not configured for this route");
  }

  const baseUrl = new URL(upstreamBase);

  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error("Only HTTP and HTTPS upstream URLs are supported");
  }

  const incomingPath = req.originalUrl.split("?")[0];

  const upstreamPath = incomingPath.replace(/^\/proxy/, "");

  const normalizedBasePath = baseUrl.pathname.replace(/\/+$/, "");
  const normalizedIncomingPath = upstreamPath.startsWith("/")
    ? upstreamPath
    : `/${upstreamPath}`;

  baseUrl.pathname = `${normalizedBasePath}${normalizedIncomingPath}`;

  // Preserve the original query string.
  baseUrl.search = req.originalUrl.includes("?")
    ? req.originalUrl.substring(req.originalUrl.indexOf("?"))
    : "";

  return baseUrl.toString();
}

/**
 * Filter headers that must not be forwarded.
 */
function filterHeaders(headers, additionalExcluded = []) {
  const excluded = new Set([...HOP_BY_HOP_HEADERS, ...additionalExcluded]);

  const result = {};

  for (const [name, value] of Object.entries(headers)) {
    if (!excluded.has(name.toLowerCase())) {
      result[name] = value;
    }
  }

  return result;
}

/**
 * Prepare headers to forward to the upstream service.
 */
function buildUpstreamHeaders(req) {
  return filterHeaders(req.headers, ["x-api-key", "x-request-id"]);
}

/**
 * Prepare upstream response headers for the client.
 */
function buildClientHeaders(upstreamHeaders) {
  const headers = {};

  upstreamHeaders.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      headers[name] = value;
    }
  });

  return headers;
}

/**
 * Determine whether the response can be cached.
 */
function isCacheableResponse(response, req) {
  if (req.method !== "GET") {
    return false;
  }

  if (!req.routeConfig.cache?.enabled) {
    return false;
  }

  if (!CACHEABLE_STATUS_CODES.has(response.status)) {
    return false;
  }

  // Never cache responses containing Set-Cookie.
  if (response.headers.has("set-cookie")) {
    return false;
  }

  // Avoid caching explicitly private/no-store responses.
  const cacheControl = response.headers.get("cache-control") || "";

  if (/private|no-store/i.test(cacheControl)) {
    return false;
  }

  return true;
}

/**
 * Send a cached response.
 */
function sendCachedResponse(res, cached) {
  res.set("X-Gateway-Cache", "HIT");

  if (cached.headers && typeof cached.headers === "object") {
    res.set(cached.headers);
  }

  res.status(cached.status);

  if (cached.body === "") {
    return res.end();
  }

  return res.send(Buffer.from(cached.body, "base64"));
}

/**
 * Gateway upstream proxy middleware.
 */
export async function upstreamProxy(req, res, next) {
  try {
    const method = req.method.toUpperCase();
    const targetUrl = buildUpstreamUrl(req);

    const cacheEnabled =
      method === "GET" && req.routeConfig.cache?.enabled === true;

    let cacheKey = null;

    // ---------------------------------------------
    // 1. RESPONSE CACHE LOOKUP
    // ---------------------------------------------
    if (cacheEnabled) {
      cacheKey = createCacheKey(req, targetUrl);

      const cached = await getCache(cacheKey);

      if (
        cached &&
        typeof cached === "object" &&
        typeof cached.body === "string" &&
        Number.isInteger(cached.status)
      ) {
        return sendCachedResponse(res, cached);
      }

      res.set("X-Gateway-Cache", "MISS");
    } else {
      res.set("X-Gateway-Cache", "BYPASS");
    }

    // ---------------------------------------------
    // 2. PREPARE UPSTREAM REQUEST
    // ---------------------------------------------
    const headers = buildUpstreamHeaders(req);

    const fetchOptions = {
      method,
      headers,
      redirect: "manual",
    };

    // GET and HEAD should not contain a request body.
    if (!["GET", "HEAD"].includes(method) && req.body !== undefined) {
      const contentType = req.headers["content-type"] || "";

      if (
        contentType.includes("application/json") &&
        typeof req.body === "object"
      ) {
        fetchOptions.body = JSON.stringify(req.body);
      } else if (Buffer.isBuffer(req.body)) {
        fetchOptions.body = req.body;
      } else if (typeof req.body === "string") {
        fetchOptions.body = req.body;
      }
    }

    // ---------------------------------------------
    // 3. CALL UPSTREAM
    // ---------------------------------------------
    const upstreamResponse = await fetch(targetUrl, fetchOptions);

    const responseHeaders = buildClientHeaders(upstreamResponse.headers);

    const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());

    const statusCode = upstreamResponse.status;

    // ---------------------------------------------
    // 4. INVALIDATE PROJECT CACHE AFTER MUTATIONS
    // ---------------------------------------------
    const isMutation = MUTATION_METHODS.has(method);

    const mutationSucceeded = statusCode >= 200 && statusCode < 300;

    if (isMutation && mutationSucceeded) {
      const projectId = req.project._id.toString();

      await invalidateProjectResponseCache(projectId);
    }

    // ---------------------------------------------
    // 5. STORE CACHEABLE RESPONSE
    // ---------------------------------------------
    if (cacheEnabled && isCacheableResponse(upstreamResponse, req)) {
      const ttlSeconds = req.routeConfig.cache.ttlSeconds ?? 300;

      const cachePayload = {
        status: statusCode,
        headers: responseHeaders,
        body: responseBody.toString("base64"),
      };

      await setCache(cacheKey, cachePayload, ttlSeconds);
    }

    // ---------------------------------------------
    // 6. RETURN UPSTREAM RESPONSE
    // ---------------------------------------------
    res.status(statusCode);

    res.set(responseHeaders);

    return res.send(responseBody);
  } catch (err) {
    return next(err);
  }
}

export default upstreamProxy;
