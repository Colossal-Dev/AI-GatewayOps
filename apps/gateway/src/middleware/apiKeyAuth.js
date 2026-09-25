import bcrypt from 'bcrypt';
import APIKey from '../models/api-key.model.js';
import Project from '../models/project.model.js';

/**
 * Middleware to authenticate Gateway requests via the X-API-Key header.
 *
 * Expected Header Format:
 *   X-API-Key: <keyId>.<secret>
 *
 * Authentication Flow:
 * 1. Reads and validates the X-API-Key header format.
 * 2. Parses header into keyId and secret.
 * 3. Finds the APIKey document by keyId (APIKey.findOne({ keyId })).
 * 4. Ensures the API key status is 'active'.
 * 5. Securely compares the provided secret against apiKey.secretHash using bcrypt.
 * 6. Finds the associated Project document by apiKey.projectId.
 * 7. Ensures the project exists and its status is 'active'.
 * 8. Attaches apiKey and project to req and invokes next().
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function apiKeyAuth(req, res, next) {
  try {
    const rawHeader = req.get('X-API-Key');

    if (!rawHeader || typeof rawHeader !== 'string') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'API key header is missing or malformed',
        },
      });
    }

    const trimmedHeader = rawHeader.trim();
    const dotIndex = trimmedHeader.indexOf('.');

    if (dotIndex <= 0 || dotIndex === trimmedHeader.length - 1) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key format. Expected format: <keyId>.<secret>',
        },
      });
    }

    const keyId = trimmedHeader.substring(0, dotIndex).trim();
    const secret = trimmedHeader.substring(dotIndex + 1).trim();

    if (!keyId || !secret) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key format. Expected format: <keyId>.<secret>',
        },
      });
    }

    // Step 4: Lookup APIKey document using keyId only
    const apiKey = await APIKey.findOne({ keyId });

    // Step 5: If API key does not exist, return 401
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key',
        },
      });
    }

    // Step 6: Check apiKey.status === 'active'
    if (apiKey.status !== 'active') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key',
        },
      });
    }

    // Step 7 & 8: Verify secret against apiKey.secretHash using bcrypt
    const isSecretValid = await bcrypt.compare(secret, apiKey.secretHash);

    if (!isSecretValid) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key',
        },
      });
    }

    // Step 9: Lookup associated Project using apiKey.projectId
    const project = await Project.findById(apiKey.projectId);

    // Step 10: If Project does not exist, return 403 with safe generic message
    if (!project) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Associated project not found or inaccessible',
        },
      });
    }

    // Step 11: Check project.status === 'active'
    if (project.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PROJECT_DISABLED',
          message: 'Project is disabled',
        },
      });
    }

    // Step 12: Attach authenticated objects to request
    req.apiKey = apiKey;
    req.project = project;

    // Step 13: Proceed to next middleware
    return next();
  } catch (error) {
    console.error(`[apiKeyAuth] Authentication error: ${error.message}`);
    return next(error);
  }
}

export { apiKeyAuth };
export default apiKeyAuth;
