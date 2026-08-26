import { Router } from 'express';
import { list, getById, create, update, remove } from '../controllers/contracts.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermission('ORDERS', 'view'), list);
router.get('/:id', requirePermission('ORDERS', 'view'), getById);
router.post('/', requirePermission('ORDERS', 'modify'), create);
router.put('/:id', requirePermission('ORDERS', 'modify'), update);
router.delete('/:id', requirePermission('ORDERS', 'modify'), remove);

export default router;
