const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = Router();

// Public authentication routes
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

// Protected routes
router.get('/me', authenticate, authController.getMe);
router.get('/admin-check', authenticate, authorize('admin'), (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Admin authorization granted.',
    user: req.user,
  });
});

module.exports = router;
