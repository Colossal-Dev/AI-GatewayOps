import express from 'express';
import healthRoutes from './routes/health.routes.js';
import apiKeyAuth from './middleware/apiKeyAuth.js';
import routeMatcher from './middleware/routeMatcher.js';
import upstreamProxy from './middleware/upstreamProxy.js';

const app = express();

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check routes (public, unauthenticated)
app.use('/api/health', healthRoutes);
app.use('/health', healthRoutes);

// Gateway Proxy Middleware Pipeline
// Strict execution order: apiKeyAuth -> routeMatcher -> upstreamProxy
const proxyMiddleware = [apiKeyAuth, routeMatcher, upstreamProxy];

// Mount proxy pipeline on /proxy prefix and root wildcard
app.use('/proxy', proxyMiddleware);
app.use(proxyMiddleware);

// Centralized error handler
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const isUpstreamNetworkError =
    err.name === 'FetchError' ||
    err.code === 'ECONNREFUSED' ||
    err.code === 'ENOTFOUND' ||
    err.cause?.code === 'ECONNREFUSED' ||
    err.cause?.code === 'ENOTFOUND' ||
    (err instanceof TypeError && err.message === 'fetch failed');

  const statusCode = Number.isInteger(err.statusCode || err.status)
    ? err.statusCode || err.status
    : (isUpstreamNetworkError ? 502 : 500);

  const errorCode = err.code && typeof err.code === 'string' && isNaN(Number(err.code))
    ? err.code
    : (statusCode === 502 ? 'BAD_GATEWAY' : 'INTERNAL_SERVER_ERROR');

  console.error(`[Gateway Error] [${req.method} ${req.originalUrl || req.url}]: ${err.stack || err.message}`);

  return res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: isUpstreamNetworkError ? 'Upstream service is unreachable or unavailable' : (err.message || 'An unexpected error occurred'),
    },
  });
});

export default app;
