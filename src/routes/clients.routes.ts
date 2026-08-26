import { Router } from 'express';
import { list, getById, create, update, remove } from '../controllers/clients.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { upload } from '../middleware/upload';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermission('ORDERS', 'view'), list);
router.get('/:id', requirePermission('ORDERS', 'view'), getById);
router.post(
  '/',
  requirePermission('ORDERS', 'modify'),
  upload.fields([
    { name: 'contract', maxCount: 1 },
    { name: 'documents', maxCount: 10 },
  ]),
  create
);
router.put('/:id', requirePermission('ORDERS', 'modify'), update);
router.delete('/:id', requirePermission('ORDERS', 'modify'), remove);

export default router;
