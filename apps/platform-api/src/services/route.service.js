import mongoose from 'mongoose';
import Route from '../models/Route.js';
import ApiError from '../utils/ApiError.js';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Validates a route path pattern.
 * Must be a non-empty string starting with '/'.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function validateRoutePath(path) {
  if (typeof path !== 'string') return false;
  const trimmed = path.trim();
  return trimmed.length > 0 && trimmed.startsWith('/');
}

/**
 * Validates an HTTP method string.
 *
 * @param {string} method
 * @returns {boolean}
 */
export function validateRouteMethod(method) {
  if (typeof method !== 'string') return false;
  return ALLOWED_METHODS.includes(method.trim().toUpperCase());
}

/**
 * Creates a new route for a project.
 *
 * @param {Object} params
 * @param {string} params.projectId
 * @param {string} params.path - Route path pattern (e.g., '/users/:id')
 * @param {string} params.method - HTTP Method (e.g., 'GET')
 * @returns {Promise<import('mongoose').Document>}
 */
export async function createRoute({ projectId, path, method }) {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid project ID format');
  }

  if (!validateRoutePath(path)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Route path is required and must be a non-empty string starting with "/" (e.g. /users or /users/:id)'
    );
  }

  if (!validateRouteMethod(method)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `HTTP method is invalid. Allowed methods: ${ALLOWED_METHODS.join(', ')}`
    );
  }

  const normalizedPath = path.trim();
  const normalizedMethod = method.trim().toUpperCase();

  // Check for duplicate route definition in this project
  const existingRoute = await Route.findOne({
    projectId,
    method: normalizedMethod,
    path: normalizedPath,
  });

  if (existingRoute) {
    throw new ApiError(
      409,
      'ROUTE_ALREADY_EXISTS',
      `A route with method "${normalizedMethod}" and path "${normalizedPath}" already exists for this project`
    );
  }

  const route = await Route.create({
    projectId,
    path: normalizedPath,
    method: normalizedMethod,
  });

  return route;
}

/**
 * Lists all configured routes for a project.
 *
 * @param {string} projectId
 * @returns {Promise<import('mongoose').Document[]>}
 */
export async function listRoutes(projectId) {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid project ID format');
  }

  return await Route.find({ projectId }).sort({ createdAt: -1 });
}

/**
 * Retrieves a single route by ID for a project.
 *
 * @param {Object} params
 * @param {string} params.projectId
 * @param {string} params.routeId
 * @returns {Promise<import('mongoose').Document>}
 */
export async function getRouteById({ projectId, routeId }) {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid project ID format');
  }

  if (!routeId || !mongoose.Types.ObjectId.isValid(routeId)) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid route ID format');
  }

  const route = await Route.findOne({ _id: routeId, projectId });
  if (!route) {
    throw new ApiError(404, 'ROUTE_NOT_FOUND', 'Route not found');
  }

  return route;
}

/**
 * Updates a route definition.
 *
 * @param {Object} params
 * @param {string} params.projectId
 * @param {string} params.routeId
 * @param {Object} params.updates - { path, method }
 * @returns {Promise<import('mongoose').Document>}
 */
export async function updateRoute({ projectId, routeId, updates = {} }) {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid project ID format');
  }

  if (!routeId || !mongoose.Types.ObjectId.isValid(routeId)) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid route ID format');
  }

  const route = await Route.findOne({ _id: routeId, projectId });
  if (!route) {
    throw new ApiError(404, 'ROUTE_NOT_FOUND', 'Route not found');
  }

  let newPath = route.path;
  let newMethod = route.method;

  if (updates.path !== undefined) {
    if (!validateRoutePath(updates.path)) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Route path must be a non-empty string starting with "/"'
      );
    }
    newPath = updates.path.trim();
  }

  if (updates.method !== undefined) {
    if (!validateRouteMethod(updates.method)) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `HTTP method is invalid. Allowed methods: ${ALLOWED_METHODS.join(', ')}`
      );
    }
    newMethod = updates.method.trim().toUpperCase();
  }

  // Check duplicate conflict if path or method is changing
  if (newPath !== route.path || newMethod !== route.method) {
    const duplicate = await Route.findOne({
      projectId,
      method: newMethod,
      path: newPath,
      _id: { $ne: route._id },
    });

    if (duplicate) {
      throw new ApiError(
        409,
        'ROUTE_ALREADY_EXISTS',
        `A route with method "${newMethod}" and path "${newPath}" already exists for this project`
      );
    }
  }

  route.path = newPath;
  route.method = newMethod;

  await route.save();
  return route;
}

/**
 * Deletes a route definition.
 *
 * @param {Object} params
 * @param {string} params.projectId
 * @param {string} params.routeId
 * @returns {Promise<{ message: string }>}
 */
export async function deleteRoute({ projectId, routeId }) {
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid project ID format');
  }

  if (!routeId || !mongoose.Types.ObjectId.isValid(routeId)) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid route ID format');
  }

  const deletedRoute = await Route.findOneAndDelete({ _id: routeId, projectId });
  if (!deletedRoute) {
    throw new ApiError(404, 'ROUTE_NOT_FOUND', 'Route not found');
  }

  return { message: 'Route successfully deleted' };
}
