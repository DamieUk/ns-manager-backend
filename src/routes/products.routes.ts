import { Router } from 'express';
import { list, getById, create, update, remove } from '../controllers/products.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { upload } from '../middleware/upload';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermission('PRODUCTS', 'view'), list);
router.get('/:id', requirePermission('PRODUCTS', 'view'), getById);
router.post(
  '/',
  requirePermission('PRODUCTS', 'modify'),
  upload.fields([
    { name: 'bomFile', maxCount: 1 },
    { name: 'additionalFiles', maxCount: 10 },
  ]),
  create
);
router.put('/:id', requirePermission('PRODUCTS', 'modify'), update);
router.delete('/:id', requirePermission('PRODUCTS', 'modify'), remove);

export default router;
