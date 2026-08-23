/**
 * 404 Not Found middleware for unmatched routes.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const notFoundHandler = (req, res) => {
  return res.status(404).json({
    success: false,
    error: {
      "code": "ROUTE_NOT_FOUND",
      "message": `Route ${req.method} ${req.originalUrl} not found.`,
      "details": [],
    },
  });
};

module.exports = notFoundHandler;
