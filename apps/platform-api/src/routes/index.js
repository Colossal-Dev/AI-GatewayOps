const { Router } = require('express');
const healthRoutes = require('./health.routes');

const router = Router();

// Liveness health endpoint -> /api/health
router.use('/health', healthRoutes);

module.exports = router;
