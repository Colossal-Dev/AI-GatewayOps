const path = require('path');
const dotenv = require('dotenv');

// Load environment configuration predictably from the repository root .env
const rootEnvPath = path.resolve(__dirname, '../../../../.env');
dotenv.config({ path: rootEnvPath });

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PLATFORM_PORT || process.env.PORT, 10) || 5000,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/ai_gatewayops',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
  isDevelopment: (process.env.NODE_ENV || 'development') === 'development',
  isTest: (process.env.NODE_ENV || 'development') === 'test',
};

module.exports = env;
