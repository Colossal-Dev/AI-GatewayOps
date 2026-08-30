import * as authService from '../services/auth.service.js';
import env from '../config/env.js';
import { parseDurationToMs } from '../utils/token.utils.js';

/**
 * Returns cookie options for the refresh token cookie.
 * In development, secure: false allows HTTP local testing.
 * In production, secure: true is strictly enforced.
 */
function getCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? 'strict' : 'lax',
    path: env.REFRESH_COOKIE_PATH,
    maxAge: parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN),
  };
}

/**
 * Options used when clearing the refresh cookie.
 */
function getClearCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? 'strict' : 'lax',
    path: env.REFRESH_COOKIE_PATH,
  };
}

/**
 * Handler for user registration.
 * POST /api/auth/register
 */
export async function register(req, res, next) {
  try {
    const { email, password, fullName } = req.body;
    const user = await authService.register({ email, password, fullName });

    return res.status(201).json({
      success: true,
      data: {
        user,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Handler for user login.
 * POST /api/auth/login
 */
export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const userAgent = req.headers['user-agent'] || null;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    const { user, accessToken, rawRefreshToken } = await authService.login({
      email,
      password,
      userAgent,
      ipAddress,
    });

    res.cookie(env.REFRESH_COOKIE_NAME, rawRefreshToken, getCookieOptions());

    return res.status(200).json({
      success: true,
      data: {
        user,
        accessToken,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Handler for refreshing access tokens with refresh token rotation.
 * POST /api/auth/refresh
 */
export async function refresh(req, res, next) {
  try {
    const rawRefreshToken = req.cookies?.[env.REFRESH_COOKIE_NAME];
    const userAgent = req.headers['user-agent'] || null;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    const { user, accessToken, rawRefreshToken: newRawRefreshToken } = await authService.refreshSession({
      rawRefreshToken,
      userAgent,
      ipAddress,
    });

    res.cookie(env.REFRESH_COOKIE_NAME, newRawRefreshToken, getCookieOptions());

    return res.status(200).json({
      success: true,
      data: {
        user,
        accessToken,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Handler for user logout.
 * POST /api/auth/logout
 */
export async function logout(req, res, next) {
  try {
    const rawRefreshToken = req.cookies?.[env.REFRESH_COOKIE_NAME];

    await authService.logout({ rawRefreshToken });

    res.clearCookie(env.REFRESH_COOKIE_NAME, getClearCookieOptions());

    return res.status(200).json({
      success: true,
      message: 'Successfully logged out.',
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Handler for retrieving the authenticated user's profile.
 * GET /api/auth/me
 */
export async function getMe(req, res, next) {
  try {
    return res.status(200).json({
      success: true,
      data: {
        user: req.user,
      },
    });
  } catch (error) {
    return next(error);
  }
}
