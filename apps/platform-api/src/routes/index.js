import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import projectRoutes from './project.routes.js';

const router = Router();

// Liveness health endpoint -> /api/health
router.use('/health', healthRoutes);

// Authentication endpoints -> /api/auth/*
router.use('/auth', authRoutes);

// Project management endpoints -> /api/projects/*
router.use('/projects', projectRoutes);

export default router;
