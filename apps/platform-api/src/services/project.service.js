import mongoose from 'mongoose';
import Project from '../models/Project.js';
import APIKey from '../models/APIKey.js';
import Route from '../models/Route.js';
import ApiError from '../utils/ApiError.js';

/**
 * Validates whether an upstream string is a valid HTTP or HTTPS URL.
 * @param {string} url
 * @returns {boolean}
 */
export function validateUpstreamUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Creates a new project in the control plane.
 *
 * @param {Object} params
 * @param {string} params.name - Project name
 * @param {string} params.upstream - Upstream target URL
 * @param {string} [params.description=''] - Optional description
 * @param {string} [params.status='active'] - Status ('active' | 'disabled')
 * @param {string} params.ownerId - Owner user ID
 * @returns {Promise<import('mongoose').Document>}
 */
export async function createProject({ name, upstream, description, status, ownerId }) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Project name is required and must be a non-empty string');
  }

  if (!upstream || typeof upstream !== 'string' || !upstream.trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Upstream URL is required and must be a non-empty string');
  }

  if (!validateUpstreamUrl(upstream)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Invalid upstream URL format. Must be a valid http or https URL (e.g., http://localhost:8080 or https://api.example.com)'
    );
  }

  if (status && !['active', 'disabled'].includes(status)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Project status must be either "active" or "disabled"');
  }

  if (!ownerId || !mongoose.Types.ObjectId.isValid(ownerId)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'A valid ownerId is required');
  }

  const project = await Project.create({
    name: name.trim(),
    upstream: upstream.trim(),
    description: typeof description === 'string' ? description.trim() : '',
    status: status || 'active',
    ownerId,
  });

  return project;
}

/**
 * Lists projects owned by a user (or all projects if admin).
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.role
 * @returns {Promise<import('mongoose').Document[]>}
 */
export async function listProjects({ userId, role }) {
  const filter = role === 'admin' ? {} : { ownerId: userId };
  return await Project.find(filter).sort({ createdAt: -1 });
}

/**
 * Retrieves a single project by ID.
 *
 * @param {string} projectId
 * @returns {Promise<import('mongoose').Document>}
 */
export async function getProjectById(projectId) {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid project ID format');
  }

  const project = await Project.findById(projectId);
  if (!project) {
    throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
}

/**
 * Updates an existing project.
 *
 * @param {import('mongoose').Document} project - Mongoose Project document
 * @param {Object} updates - Properties to update
 * @returns {Promise<import('mongoose').Document>}
 */
export async function updateProject(project, updates = {}) {
  if (!updates || typeof updates !== 'object') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Update payload must be an object');
  }

  if (updates.name !== undefined) {
    if (typeof updates.name !== 'string' || !updates.name.trim()) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Project name cannot be empty');
    }
    project.name = updates.name.trim();
  }

  if (updates.description !== undefined) {
    if (typeof updates.description !== 'string') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Project description must be a string');
    }
    project.description = updates.description.trim();
  }

  if (updates.upstream !== undefined) {
    if (!validateUpstreamUrl(updates.upstream)) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Invalid upstream URL format. Must be a valid http or https URL'
      );
    }
    project.upstream = updates.upstream.trim();
  }

  if (updates.status !== undefined) {
    if (!['active', 'disabled'].includes(updates.status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Status must be either "active" or "disabled"');
    }
    project.status = updates.status;
  }

  await project.save();
  return project;
}

/**
 * Deletes a project and all associated API keys and routes.
 *
 * @param {string} projectId
 * @returns {Promise<{ message: string }>}
 */
export async function deleteProject(projectId) {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid project ID format');
  }

  await Promise.all([
    APIKey.deleteMany({ projectId }),
    Route.deleteMany({ projectId }),
    Project.findByIdAndDelete(projectId),
  ]);

  return { message: 'Project and associated resources successfully deleted' };
}
