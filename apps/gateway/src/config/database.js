import mongoose from 'mongoose';

/**
 * Sanitizes MongoDB connection URI for safe logging (masks credentials).
 * @param {string} uri - Raw connection URI
 * @returns {string} Sanitized URI
 */
export function sanitizeMongoUri(uri) {
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
export async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    const errorMsg = 'MONGODB_URI is not defined in environment variables';
    console.error(`[MongoDB] Configuration error: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  const sanitizedUri = sanitizeMongoUri(uri);

  const options = {
    serverSelectionTimeoutMS: 5000,
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

    await mongoose.connect(uri, options);
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
export async function disconnectDB() {
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
