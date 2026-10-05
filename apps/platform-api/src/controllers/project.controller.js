import * as projectService from '../services/project.service.js';

/**
 * Controller to create a new project.
 * POST /api/projects
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function createProject(req, res, next) {
  try {
    const { name, upstream, description, status } = req.body || {};
    const ownerId = req.user.id;

    const project = await projectService.createProject({
      name,
      upstream,
      description,
      status,
      ownerId,
    });

    return res.status(201).json({
      success: true,
      data: {
        project,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Controller to list all projects accessible by caller.
 * GET /api/projects
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function listProjects(req, res, next) {
  try {
    const projects = await projectService.listProjects({
      userId: req.user.id,
      role: req.user.role,
    });

    return res.status(200).json({
      success: true,
      data: {
        projects,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Controller to get a single project by ID.
 * GET /api/projects/:projectId
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function getProject(req, res, next) {
  try {
    // req.project is already validated and authorized by validateProjectAccess middleware
    return res.status(200).json({
      success: true,
      data: {
        project: req.project,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Controller to update a project.
 * PATCH /api/projects/:projectId
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function updateProject(req, res, next) {
  try {
    const updated = await projectService.updateProject(req.project, req.body);

    return res.status(200).json({
      success: true,
      data: {
        project: updated,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Controller to delete a project.
 * DELETE /api/projects/:projectId
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function deleteProject(req, res, next) {
  try {
    const result = await projectService.deleteProject(req.params.projectId);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    return next(error);
  }
}
