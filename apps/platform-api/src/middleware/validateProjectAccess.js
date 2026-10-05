import mongoose from 'mongoose';
import Project from '../models/Project.js';
import ApiError from '../utils/ApiError.js';

/**
 * Middleware to validate project existence and authorize caller access.
 * Must be mounted after `authenticate` middleware.
 * Verifies that req.params.projectId is a valid ObjectId, fetches the project,
 * verifies ownership (or admin role), and attaches req.project to request.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function validateProjectAccess(req, res, next) {
  try {
    const { projectId } = req.params;

    if (!projectId || typeof projectId !== 'string' || !mongoose.Types.ObjectId.isValid(projectId)) {
      return next(new ApiError(400, 'INVALID_ID', 'Invalid project ID format'));
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return next(new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found'));
    }

    // Authorization check: developer role can only access projects they own
    if (req.user && req.user.role !== 'admin') {
      if (project.ownerId && project.ownerId.toString() !== req.user.id.toString()) {
        return next(
          new ApiError(403, 'FORBIDDEN', 'Access denied: you do not have permission to access this project')
        );
      }
    }

    req.project = project;
    return next();
  } catch (error) {
    return next(error);
  }
}

export { validateProjectAccess };
export default validateProjectAccess;
