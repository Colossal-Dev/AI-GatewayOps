const bcrypt = require('bcrypt');
const User = require('../models/User');
const RefreshSession = require('../models/RefreshSession');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const {
  generateAccessToken,
  generateRefreshToken,
  generateFamilyId,
  hashRefreshToken,
  parseDurationToMs,
} = require('../utils/token.utils');

const BCRYPT_SALT_ROUNDS = 10;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Registers a new user with normalized email and bcrypt-hashed password.
 * Public registrations are strictly assigned the 'developer' role.
 *
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.password
 * @param {string} [params.fullName]
 * @returns {Promise<object>} Sanitized User object
 */
async function register({ email, password, fullName = '' }) {
  if (!email || typeof email !== 'string' || !email.trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Email is required and must be a string');
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!EMAIL_REGEX.test(normalizedEmail)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Please provide a valid email address');
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Password must be a string and at least 8 characters long');
  }

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'Email is already registered');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  try {
    const user = await User.create({
      email: normalizedEmail,
      passwordHash,
      fullName: typeof fullName === 'string' ? fullName.trim() : '',
      role: 'developer', // Strictly enforce 'developer' role for all public registrations
    });

    return user.toJSON();
  } catch (error) {
    // Handle duplicate key race conditions in MongoDB
    if (error.code === 11000) {
      throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'Email is already registered');
    }
    throw error;
  }
}

/**
 * Authenticates user credentials and generates access token and refresh session.
 *
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.password
 * @param {string} [params.userAgent]
 * @param {string} [params.ipAddress]
 * @returns {Promise<{ user: object, accessToken: string, rawRefreshToken: string }>}
 */
async function login({ email, password, userAgent = null, ipAddress = null }) {
  if (!email || typeof email !== 'string' || !email.trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Email is required and must be a string');
  }

  if (!password || typeof password !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Password is required and must be a string');
  }

  const normalizedEmail = email.trim().toLowerCase();

  const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
  if (!user || !user.isActive) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const accessToken = generateAccessToken(user);
  const rawRefreshToken = generateRefreshToken();
  const familyId = generateFamilyId();
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN));

  await RefreshSession.create({
    userId: user._id,
    familyId,
    tokenHash,
    expiresAt,
    userAgent,
    ipAddress,
  });

  return {
    user: user.toJSON(),
    accessToken,
    rawRefreshToken,
  };
}

/**
 * Validates a refresh token atomically, performs token rotation, and detects reuse breaches.
 * Uses atomic conditional updates to prevent concurrent rotation race conditions.
 *
 * @param {object} params
 * @param {string} params.rawRefreshToken
 * @param {string} [params.userAgent]
 * @param {string} [params.ipAddress]
 * @returns {Promise<{ user: object, accessToken: string, rawRefreshToken: string }>}
 */
async function refreshSession({ rawRefreshToken, userAgent = null, ipAddress = null }) {
  if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
    throw new ApiError(401, 'UNAUTHORIZED', 'Refresh token is required');
  }

  const tokenHash = hashRefreshToken(rawRefreshToken);

  // Atomically claim the active session (only one concurrent request can claim an unrevoked token)
  const session = await RefreshSession.findOneAndUpdate(
    { tokenHash, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: false }
  );

  if (!session) {
    // If not found as active, check if it was previously revoked (Reuse / Race Breach Detection)
    const revokedSession = await RefreshSession.findOne({ tokenHash });
    if (revokedSession) {
      // Token reuse detected! Revoke all sessions in the entire family chain
      await RefreshSession.updateMany(
        { familyId: revokedSession.familyId, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
      throw new ApiError(
        401,
        'REVOKED_TOKEN_REUSED',
        'Security alert: Attempted use of revoked refresh token. All active sessions in this family have been terminated.'
      );
    }

    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or does not exist');
  }

  // Expiration Check
  if (session.expiresAt <= new Date()) {
    throw new ApiError(401, 'REFRESH_TOKEN_EXPIRED', 'Refresh token has expired');
  }

  const user = await User.findById(session.userId);
  if (!user || !user.isActive) {
    throw new ApiError(401, 'USER_NOT_FOUND', 'User account is disabled or does not exist');
  }

  // Create new session maintaining the same familyId
  const newRawRefreshToken = generateRefreshToken();
  const newTokenHash = hashRefreshToken(newRawRefreshToken);
  const newExpiresAt = new Date(Date.now() + parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN));

  await RefreshSession.create({
    userId: user._id,
    familyId: session.familyId,
    tokenHash: newTokenHash,
    expiresAt: newExpiresAt,
    userAgent: userAgent || session.userAgent,
    ipAddress: ipAddress || session.ipAddress,
  });

  const newAccessToken = generateAccessToken(user);

  return {
    user: user.toJSON(),
    accessToken: newAccessToken,
    rawRefreshToken: newRawRefreshToken,
  };
}

/**
 * Revokes a single refresh token session on logout.
 *
 * @param {object} params
 * @param {string} params.rawRefreshToken
 * @returns {Promise<{ success: boolean }>}
 */
async function logout({ rawRefreshToken }) {
  if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
    return { success: true };
  }

  const tokenHash = hashRefreshToken(rawRefreshToken);
  await RefreshSession.updateOne(
    { tokenHash, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );

  return { success: true };
}

module.exports = {
  register,
  login,
  refreshSession,
  logout,
};
