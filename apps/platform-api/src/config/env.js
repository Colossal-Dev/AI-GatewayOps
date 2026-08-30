import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment configuration predictably from the repository root .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../../../../.env');
dotenv.config({ path: rootEnvPath });

const isProduction = (process.env.NODE_ENV || 'development') === 'production';
const isDevelopment = (process.env.NODE_ENV || 'development') === 'development';
const isTest = (process.env.NODE_ENV || 'development') === 'test';

// Enforce strong secrets in production environments
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET || (isProduction ? null : 'dev_jwt_access_secret_do_not_use_in_prod_min_32_chars');
if (isProduction && (!jwtAccessSecret || jwtAccessSecret.includes('dev_jwt_access_secret'))) {
  throw new Error('FATAL CONFIGURATION ERROR: JWT_ACCESS_SECRET must be explicitly provided with a strong secret in production.');
}

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PLATFORM_PORT || process.env.PORT, 10) || 5000,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/ai_gatewayops',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
  JWT_ACCESS_SECRET: jwtAccessSecret,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  REFRESH_COOKIE_NAME: process.env.REFRESH_COOKIE_NAME || 'refreshToken',
  REFRESH_COOKIE_PATH: process.env.REFRESH_COOKIE_PATH || '/api/auth',
  isProduction,
  isDevelopment,
  isTest,
};

export default env;
