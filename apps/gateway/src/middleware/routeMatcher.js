import Route from '../models/route.model.js';

/**
 * Matches a request path against a route pattern supporting Express-style dynamic parameters (:param).
 *
 * @param {string} pattern - Stored route pattern, e.g. '/users/:id' or '/users/:userId/orders/:orderId'
 * @param {string} pathname - Incoming request path, e.g. '/users/123'
 * @returns {{ matches: boolean, params: Record<string, string> } | null}
 */
export function matchPath(pattern, pathname) {
  if (typeof pattern !== 'string' || typeof pathname !== 'string') {
    return null;
  }

  // Normalize by stripping query strings (if any) and trimming leading/trailing slashes
  const cleanPattern = pattern.split('?')[0].replace(/^\/+|\/+$/g, '');
  const cleanPath = pathname.split('?')[0].replace(/^\/+|\/+$/g, '');

  if (cleanPattern === cleanPath) {
    return { matches: true, params: {} };
  }

  const patternSegments = cleanPattern ? cleanPattern.split('/') : [];
  const pathSegments = cleanPath ? cleanPath.split('/') : [];

  if (patternSegments.length !== pathSegments.length) {
    return null;
  }

  const params = {};

  for (let i = 0; i < patternSegments.length; i++) {
    const pSeg = patternSegments[i];
    const rSeg = pathSegments[i];

    if (pSeg.startsWith(':')) {
      const paramName = pSeg.slice(1);
      if (!paramName) {
        return null;
      }
      try {
        params[paramName] = decodeURIComponent(rSeg);
      } catch {
        params[paramName] = rSeg;
      }
    } else if (pSeg !== rSeg) {
      return null;
    }
  }

  return { matches: true, params };
}

/**
 * Counts the number of dynamic parameter segments in a route path.
 *
 * @param {string} path
 * @returns {number}
 */
function countDynamicParams(path) {
  return (path.match(/:[a-zA-Z0-9_]+/g) || []).length;
}

/**
 * Middleware for dynamic Gateway route matching.
 *
 * Runs after apiKeyAuth.
 * Resolves incoming HTTP requests against configured Route documents for req.project._id.
 *
 * On match:
 *   - Attaches matched Route document to req.routeConfig
 *   - Attaches extracted route parameters to req.routeParams
 *   - Calls next()
 *
 * On no match:
 *   - Returns HTTP 404 ROUTE_NOT_FOUND
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function routeMatcher(req, res, next) {
  try {
    const projectId = req.project?._id || req.project?.id;
    const method = req.method ? req.method.toUpperCase() : '';
    const requestPath = req.path || req.url || '/';

    if (!projectId || !method) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ROUTE_NOT_FOUND',
          message: 'Route not found',
        },
      });
    }

    // Query all candidate routes for this project and HTTP method
    const routes = await Route.find({ projectId, method });

    if (!routes || routes.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ROUTE_NOT_FOUND',
          message: 'Route not found',
        },
      });
    }

    // Sort candidate routes so more specific (static) routes are evaluated before dynamic routes
    const sortedRoutes = [...routes].sort(
      (a, b) => countDynamicParams(a.path) - countDynamicParams(b.path)
    );

    let matchedRoute = null;
    let extractedParams = {};

    for (const route of sortedRoutes) {
      const result = matchPath(route.path, requestPath);
      if (result && result.matches) {
        matchedRoute = route;
        extractedParams = result.params;
        break;
      }
    }

    if (!matchedRoute) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ROUTE_NOT_FOUND',
          message: 'Route not found',
        },
      });
    }

    // Attach matched route and extracted parameters to request
    req.routeConfig = matchedRoute;
    req.routeParams = extractedParams;

    return next();
  } catch (error) {
    console.error(`[routeMatcher] Route resolution error: ${error.message}`);
    return next(error);
  }
}

export { routeMatcher };
export default routeMatcher;
