import { Router } from 'express';

const router = Router();

/**
 * Health check handler for Gateway service.
 * Acts as a minimal liveness probe.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getHealth = (req, res) => {
  return res.status(200).json({
    status: 'ok',
    service: 'gateway',
  });
};

// GET /api/health
router.get('/', getHealth);

export default router;

