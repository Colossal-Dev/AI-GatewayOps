import * as apiKeyService from '../services/apiKey.service.js';

/**
 * Controller to create / issue a new API key for a project.
 * POST /api/projects/:projectId/api-keys
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function createApiKey(req, res, next) {
  try {
    const { projectId } = req.params;

    const { apiKey, secret, apiKeyHeader } = await apiKeyService.createApiKey({ projectId });

    return res.status(201).json({
      success: true,
      data: {
        apiKey,
        secret,
        apiKeyHeader,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Controller to list all API keys for a project.
 * GET /api/projects/:projectId/api-keys
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function listApiKeys(req, res, next) {
  try {
    const { projectId } = req.params;

    const apiKeys = await apiKeyService.listApiKeys(projectId);

    return res.status(200).json({
      success: true,
      data: {
        apiKeys,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Controller to delete / revoke an API key.
 * DELETE /api/projects/:projectId/api-keys/:keyId
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function deleteApiKey(req, res, next) {
  try {
    const { projectId, keyId } = req.params;

    const result = await apiKeyService.deleteApiKey({ projectId, keyId });

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    return next(error);
  }
}
