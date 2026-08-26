import { Router } from 'express';

import healthRoutes from './health.routes';
import authRoutes from './auth.routes';
import usersRoutes from './users.routes';
import clientsRoutes from './clients.routes';
import contractsRoutes from './contracts.routes';
import productsRoutes from './products.routes';
import ordersRoutes from './orders.routes';
import documentsRoutes from './documents.routes';
import dailyProgressRoutes from './dailyProgress.routes';
import dashboardRoutes from './dashboard.routes';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/clients', clientsRoutes);
router.use('/contracts', contractsRoutes);
router.use('/products', productsRoutes);
router.use('/orders', ordersRoutes);
router.use('/documents', documentsRoutes);
router.use('/daily-progress', dailyProgressRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
