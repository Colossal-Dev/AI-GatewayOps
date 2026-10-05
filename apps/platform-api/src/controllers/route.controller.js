import * as routeService from '../services/route.service.js';

/**
 * Controller to create a new route in a project.
 * POST /api/projects/:projectId/routes
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function createRoute(req, res, next) {
  try {
    const { projectId } = req.params;
    const { path, method } = req.body || {};

    const route = await routeService.createRoute({
      projectId,
      path,
      method,
    });

    return res.status(201).json({
      success: true,
      data: {
        route,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Controller to list all routes for a project.
 * GET /api/projects/:projectId/routes
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function listRoutes(req, res, next) {
  try {
    const { projectId } = req.params;

    const routes = await routeService.listRoutes(projectId);

    return res.status(200).json({
      success: true,
      data: {
        routes,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Controller to get a specific route config.
 * GET /api/projects/:projectId/routes/:routeId
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function getRoute(req, res, next) {
  try {
    const { projectId, routeId } = req.params;

    const route = await routeService.getRouteById({
      projectId,
      routeId,
    });

    return res.status(200).json({
      success: true,
      data: {
        route,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Controller to update a route config.
 * PATCH /api/projects/:projectId/routes/:routeId
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function updateRoute(req, res, next) {
  try {
    const { projectId, routeId } = req.params;

    const updatedRoute = await routeService.updateRoute({
      projectId,
      routeId,
      updates: req.body,
    });

    return res.status(200).json({
      success: true,
      data: {
        route: updatedRoute,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Controller to delete a route config.
 * DELETE /api/projects/:projectId/routes/:routeId
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function deleteRoute(req, res, next) {
  try {
    const { projectId, routeId } = req.params;

    const result = await routeService.deleteRoute({
      projectId,
      routeId,
    });

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    return next(error);
  }
}
