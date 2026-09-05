import { Router } from 'express';
import { list, getById, listMine, create, update, remove } from '../controllers/orders.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';

const router = Router();

router.use(requireAuth);

router.get('/', list);
router.get('/mine', listMine);
router.get('/:id', getById);
router.post('/', requirePermission('ORDERS', 'modify'), create);
router.put('/:id', requirePermission('ORDERS', 'modify'), update);
router.delete('/:id', requirePermission('ORDERS', 'modify'), remove);

export default router;
