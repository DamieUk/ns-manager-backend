const { Router } = require('express');

const healthRoutes = require('./health.routes');
const usersRoutes = require('./users.routes');
const authRoutes = require('./auth.routes');

const router = Router();

router.use('/health', healthRoutes);
router.use('/users', usersRoutes);
router.use('/auth', authRoutes);

module.exports = router;
