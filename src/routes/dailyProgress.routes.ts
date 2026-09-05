import { Router } from 'express';
import { list, getById, create, update, remove } from '../controllers/dailyProgress.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { upload } from '../middleware/upload';

const router = Router();

router.use(requireAuth);

router.get('/', list);
router.get('/:id', getById);
router.post('/', requireRole('employee'), upload.single('photo'), create);
router.put('/:id', requireRole('employee'), upload.single('photo'), update);
router.delete('/:id', requireRole('employee'), remove);

export default router;
