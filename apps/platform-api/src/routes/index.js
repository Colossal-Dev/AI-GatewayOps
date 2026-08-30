import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';

const router = Router();

// Liveness health endpoint -> /api/health
router.use('/health', healthRoutes);

// Authentication endpoints -> /api/auth/*
router.use('/auth', authRoutes);

export default router;
