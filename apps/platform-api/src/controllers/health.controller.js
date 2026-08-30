/**
 * Health check controller for Platform API.
 * Acts as a simple application liveness check.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getHealth = (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'AI GatewayOps Platform API is running',
  });
};

export default getHealth;
