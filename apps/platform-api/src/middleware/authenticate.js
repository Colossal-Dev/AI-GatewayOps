import { verifyAccessToken } from '../utils/token.utils.js';
import ApiError from '../utils/ApiError.js';

/**
 * Middleware to authenticate requests using a JWT Bearer access token.
 * Reads token from the Authorization header, verifies signature & expiration,
 * and attaches { id, email, role } to req.user.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || typeof authHeader !== 'string') {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Authorization header is missing'));
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1].trim()) {
    return next(new ApiError(401, 'INVALID_TOKEN_FORMAT', 'Authorization header must follow "Bearer <token>" format'));
  }

  const token = parts[1].trim();

  try {
    const decoded = verifyAccessToken(token);

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    return next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return next(new ApiError(401, 'TOKEN_EXPIRED', 'Access token has expired'));
    }
    return next(new ApiError(401, 'INVALID_TOKEN', 'Access token is invalid'));
  }
}

export default authenticate;
