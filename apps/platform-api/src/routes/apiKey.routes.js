import { Router } from 'express';
import * as apiKeyController from '../controllers/apiKey.controller.js';

const router = Router({ mergeParams: true });

// POST   /api/projects/:projectId/api-keys
router.post('/', apiKeyController.createApiKey);

// GET    /api/projects/:projectId/api-keys
router.get('/', apiKeyController.listApiKeys);

// DELETE /api/projects/:projectId/api-keys/:keyId
router.delete('/:keyId', apiKeyController.deleteApiKey);

export default router;
