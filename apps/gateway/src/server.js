import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/database.js';
import { connectRedis } from './config/redis.js';

const PORT = process.env.PORT || 5001;

async function startServer() {
  try {
    // MongoDB is a mandatory dependency - failure prevents server startup
    await connectDB();

    // Redis is a non-blocking cache dependency - failure must not prevent server startup
    try {
      await connectRedis();
    } catch {
      console.warn(`[Redis] Warning: Redis is unavailable. Gateway will continue without Redis cache.`);
    }

    app.listen(PORT, () => {
      console.log(`Gateway server running on port ${PORT}`);
    });
  } catch (error) {
    console.error(`Failed to start Gateway server: ${error.message}`);
    process.exit(1);
  }
}

startServer();
