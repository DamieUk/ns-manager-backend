import { Router } from 'express';
import { get, update } from '../controllers/company.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';

const router = Router();

router.use(requireAuth, requireRole('executive'));

router.get('/', get);
router.put('/', update);

export default router;
