import app from './app.js';
import env from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';

let server = null;
let isShuttingDown = false;

/**
 * Gracefully shuts down the application (HTTP server and Database connection).
 * @param {string} signal - The signal that triggered the shutdown
 */
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);

  // Force close after 10s if graceful shutdown hangs
  const forceExitTimer = setTimeout(() => {
    console.error('[Server] Graceful shutdown timed out. Forcing termination.');
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  try {
    if (server) {
      await new Promise((resolve) => {
        server.close((err) => {
          if (err) {
            console.error('[Server] Error closing HTTP server:', err.message);
          } else {
            console.log('[Server] HTTP server closed successfully');
          }
          resolve();
        });
      });
    }

    await disconnectDB();
    console.log('[Server] Graceful shutdown completed cleanly.');
    process.exit(0);
  } catch (error) {
    console.error('[Server] Error during graceful shutdown:', error.message);
    process.exit(1);
  }
}

/**
 * Starts the Platform API application and connects to MongoDB.
 */
async function startServer() {
  try {
    // Connect to MongoDB
    console.log('[Server] Connecting to MongoDB...');
    await connectDB();

    // Start HTTP server
    server = app.listen(env.PORT, () => {
      console.log(`===================================================`);
      console.log(`🚀 AI GatewayOps Platform API (Control Plane)`);
      console.log(`📡 Environment: ${env.NODE_ENV}`);
      console.log(`🌐 Server running at: http://localhost:${env.PORT}`);
      console.log(`🩺 Health check: http://localhost:${env.PORT}/api/health`);
      console.log(`===================================================`);
    });

    server.on('error', (error) => {
      console.error('[Server] HTTP Server error:', error.message);
    });

    // Register shutdown hooks
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    // Handle unexpected errors
    process.on('unhandledRejection', (reason) => {
      console.error('[Server] Unhandled Promise Rejection:', reason);
    });

    process.on('uncaughtException', (error) => {
      console.error('[Server] Uncaught Exception:', error);
      gracefulShutdown('uncaughtException');
    });
  } catch (error) {
    console.error('[Server] Failed to start Platform API:', error.message);
    process.exit(1);
  }
}

startServer();
