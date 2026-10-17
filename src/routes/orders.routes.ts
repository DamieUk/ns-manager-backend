import { Router } from 'express';
import { list, getById, listMine, create, update, changeStage, updatePrep, remove } from '../controllers/orders.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { requireRole } from '../middleware/requireRole';
import { upload } from '../middleware/upload';

const router = Router();

router.use(requireAuth);

router.get('/', list);
router.get('/mine', listMine);
router.get('/:id', getById);
router.post('/', requirePermission('ORDERS', 'modify'), create);
router.put('/:id', requirePermission('ORDERS', 'modify'), update);
router.post('/:id/stage', requireRole('executive'), changeStage);
router.put('/:id/prep/:item', upload.single('file'), updatePrep);
router.delete('/:id', requirePermission('ORDERS', 'modify'), remove);

export default router;
