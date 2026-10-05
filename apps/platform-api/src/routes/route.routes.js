import { Router } from 'express';
import * as routeController from '../controllers/route.controller.js';

const router = Router({ mergeParams: true });

// POST   /api/projects/:projectId/routes
router.post('/', routeController.createRoute);

// GET    /api/projects/:projectId/routes
router.get('/', routeController.listRoutes);

// GET    /api/projects/:projectId/routes/:routeId
router.get('/:routeId', routeController.getRoute);

// PATCH  /api/projects/:projectId/routes/:routeId
router.patch('/:routeId', routeController.updateRoute);

// DELETE /api/projects/:projectId/routes/:routeId
router.delete('/:routeId', routeController.deleteRoute);

export default router;
