const ApiError = require('../utils/ApiError');

/**
 * Middleware factory for role-based authorization.
 * Must be executed after the `authenticate` middleware.
 *
 * @param {string|string[]} roles - Allowed role(s), e.g. 'admin' or ['admin', 'developer']
 * @returns {import('express').RequestHandler}
 */
function authorize(roles = []) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'UNAUTHORIZED', 'Authentication required prior to authorization'));
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, 'FORBIDDEN', 'Access denied: insufficient permissions for this resource'));
    }

    return next();
  };
}

module.exports = authorize;
