import { Router } from 'express';
import { list, getById, create, update, remove } from '../controllers/dailyProgress.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';

const router = Router();

router.use(requireAuth);

router.get('/', list);
router.get('/:id', getById);
router.post('/', requireRole('employee'), create);
router.put('/:id', requireRole('employee'), update);
router.delete('/:id', requireRole('employee'), remove);

export default router;
