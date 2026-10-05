import crypto from 'crypto';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import APIKey from '../models/APIKey.js';
import ApiError from '../utils/ApiError.js';

const BCRYPT_SALT_ROUNDS = 10;

/**
 * Generates a cryptographically secure random API key ID and secret,
 * stores the secretHash in the database, and returns the plaintext secret exactly once.
 *
 * @param {Object} params
 * @param {string} params.projectId - Target Project ID
 * @returns {Promise<{ apiKey: Object, secret: string, apiKeyHeader: string }>}
 */
export async function createApiKey({ projectId }) {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid project ID format');
  }

  // Generate cryptographically secure random keyId and secret (without '.' characters)
  const keyId = `gw_key_${crypto.randomBytes(12).toString('hex')}`;
  const secret = `sec_${crypto.randomBytes(24).toString('hex')}`;

  // Hash secret with bcrypt for storage
  const secretHash = await bcrypt.hash(secret, BCRYPT_SALT_ROUNDS);

  const apiKeyDoc = await APIKey.create({
    keyId,
    projectId,
    secretHash,
    status: 'active',
  });

  const apiKeyJson = apiKeyDoc.toJSON();

  return {
    apiKey: apiKeyJson,
    secret,
    apiKeyHeader: `${keyId}.${secret}`,
  };
}

/**
 * Lists all API keys belonging to a specific project.
 * Never includes secretHash or secrets.
 *
 * @param {string} projectId
 * @returns {Promise<import('mongoose').Document[]>}
 */
export async function listApiKeys(projectId) {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid project ID format');
  }

  return await APIKey.find({ projectId }).select('-secretHash').sort({ createdAt: -1 });
}

/**
 * Deletes / revokes an API key for a project.
 *
 * @param {Object} params
 * @param {string} params.projectId
 * @param {string} params.keyId - The keyId string or document _id
 * @returns {Promise<{ message: string }>}
 */
export async function deleteApiKey({ projectId, keyId }) {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid project ID format');
  }

  if (!keyId || typeof keyId !== 'string' || !keyId.trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'A valid keyId is required');
  }

  const query = mongoose.Types.ObjectId.isValid(keyId)
    ? { $or: [{ _id: keyId }, { keyId }], projectId }
    : { keyId, projectId };

  const deletedKey = await APIKey.findOneAndDelete(query);
  if (!deletedKey) {
    throw new ApiError(404, 'API_KEY_NOT_FOUND', 'API key not found');
  }

  return { message: 'API key successfully deleted' };
}
