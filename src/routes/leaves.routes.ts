import { Router } from 'express';
import { list, create, cancel, decide } from '../controllers/leaves.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';

const router = Router();

router.use(requireAuth);

router.get('/', list);
router.post('/', create);
router.post('/:id/cancel', cancel);
router.post('/:id/decision', requireRole('executive'), decide);

export default router;
