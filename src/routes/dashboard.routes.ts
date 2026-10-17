import { Router } from 'express';
import { getDashboard } from '../controllers/dashboard.controller';
import { getOverview } from '../controllers/overview.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';

const router = Router();

router.get('/', requireAuth, requireRole('executive'), getDashboard);
router.get('/overview', requireAuth, requireRole('executive'), getOverview);

export default router;
