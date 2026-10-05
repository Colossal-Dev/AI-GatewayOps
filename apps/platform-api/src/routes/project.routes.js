import { Router } from 'express';
import authenticate from '../middleware/authenticate.js';
import validateProjectAccess from '../middleware/validateProjectAccess.js';
import * as projectController from '../controllers/project.controller.js';
import apiKeyRoutes from './apiKey.routes.js';
import routeRoutes from './route.routes.js';

const router = Router();

// Enforce authentication for all project management routes
router.use(authenticate);

// Top-level Project Management Endpoints
router.post('/', projectController.createProject);
router.get('/', projectController.listProjects);
router.get('/:projectId', validateProjectAccess, projectController.getProject);
router.patch('/:projectId', validateProjectAccess, projectController.updateProject);
router.delete('/:projectId', validateProjectAccess, projectController.deleteProject);

// Nested API Key Management Endpoints -> /api/projects/:projectId/api-keys
router.use('/:projectId/api-keys', validateProjectAccess, apiKeyRoutes);

// Nested Route Management Endpoints -> /api/projects/:projectId/routes
router.use('/:projectId/routes', validateProjectAccess, routeRoutes);

export default router;
