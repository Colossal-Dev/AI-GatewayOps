const { Router } = require('express');
const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');

const router = Router();

// Liveness health endpoint -> /api/health
router.use('/health', healthRoutes);

// Authentication endpoints -> /api/auth/*
router.use('/auth', authRoutes);
module.exports = router;
