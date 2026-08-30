import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';

/**
 * Parses a duration string (e.g. '15m', '7d', '24h', '30s') or numeric string into milliseconds.
 *
 * @param {string|number} duration
 * @returns {number} Duration in milliseconds
 */
export function parseDurationToMs(duration) {
  if (typeof duration === 'number') {
    return duration;
  }
  if (!duration || typeof duration !== 'string') {
    return 7 * 24 * 60 * 60 * 1000; // default to 7 days
  }

  const match = duration.match(/^(\d+)([smhd]?)$/);
  if (!match) {
    const parsed = parseInt(duration, 10);
    return isNaN(parsed) ? 7 * 24 * 60 * 60 * 1000 : parsed;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return value;
  }
}

/**
 * Generates a signed JWT access token.
 *
 * @param {object} payload - Identity payload { id, email, role }
 * @returns {string} Signed JWT string
 */
export function generateAccessToken(payload) {
  return jwt.sign(
    {
      id: payload.id || payload._id,
      email: payload.email,
      role: payload.role,
    },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    }
  );
}

/**
 * Verifies a JWT access token against the configured JWT_ACCESS_SECRET.
 * Throws JsonWebTokenError or TokenExpiredError on failure.
 *
 * @param {string} token - Raw JWT string
 * @returns {object} Decoded JWT payload
 */
export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

/**
 * Generates a cryptographically secure opaque refresh token.
 *
 * @returns {string} 80-character hex string
 */
export function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

/**
 * Generates a unique Token Family UUID.
 *
 * @returns {string} UUID string
 */
export function generateFamilyId() {
  return crypto.randomUUID();
}

/**
 * Computes SHA-256 hash of a raw refresh token.
 * Only the hash is persisted in the database.
 *
 * @param {string} token - Raw refresh token string
 * @returns {string} 64-character SHA-256 hex string
 */
export function hashRefreshToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token is required for hashing');
  }
  return crypto.createHash('sha256').update(token).digest('hex');
}
