const mongoose = require('mongoose');
const env = require('./env');

/**
 * Sanitizes MongoDB connection URI for safe logging (masks credentials).
 * @param {string} uri - Raw connection URI
 * @returns {string} Sanitized URI
 */
function sanitizeMongoUri(uri) {
  if (!uri) return 'undefined';
  try {
    const parsed = new URL(uri);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    // If not a standard URL, mask using regex
    return uri.replace(/:\/\/[^@]+@/, '://****:****@');
  }
}

/**
 * Connects to MongoDB database using Mongoose.
 * Configured with serverSelectionTimeoutMS to fail fast if MongoDB is unreachable.
 * @returns {Promise<typeof mongoose>}
 */
async function connectDB() {
  const sanitizedUri = sanitizeMongoUri(env.MONGODB_URI);

  const options = {
    serverSelectionTimeoutMS: 5000, // Timeout after 5s if server unreachable
    autoIndex: !env.isProduction,    // Build indexes in development, skip in production for performance
  };

  try {
    mongoose.connection.on('connected', () => {
      console.log(`[MongoDB] Connection established: ${sanitizedUri}`);
    });

    mongoose.connection.on('error', (err) => {
      console.error(`[MongoDB] Connection error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('[MongoDB] Connection disconnected');
    });

    await mongoose.connect(env.MONGODB_URI, options);
    console.log(`[MongoDB] Successfully connected to database: ${mongoose.connection.name}`);
    return mongoose;
  } catch (error) {
    console.error(`[MongoDB] Failed to connect to ${sanitizedUri}: ${error.message}`);
    throw error;
  }
}

/**
 * Disconnects from MongoDB database cleanly.
 * @returns {Promise<void>}
 */
async function disconnectDB() {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('[MongoDB] Successfully disconnected from database');
    }
  } catch (error) {
    console.error(`[MongoDB] Error during disconnect: ${error.message}`);
    throw error;
  }
}

module.exports = {
  connectDB,
  disconnectDB,
  sanitizeMongoUri,
};
