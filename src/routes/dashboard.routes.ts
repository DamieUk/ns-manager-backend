import { Router } from 'express';
import { getDashboard } from '../controllers/dashboard.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';

const router = Router();

router.get('/', requireAuth, requireRole('executive', 'manager'), getDashboard);

export default router;
