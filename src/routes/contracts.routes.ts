import { Router } from 'express';
import { list, getById, create, update, remove } from '../controllers/contracts.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { upload } from '../middleware/upload';

const router = Router();

router.use(requireAuth);

// Create/update accept JSON or multipart with the signed scans as `files`.
router.get('/', requirePermission('ORDERS', 'view'), list);
router.get('/:id', requirePermission('ORDERS', 'view'), getById);
router.post('/', requirePermission('ORDERS', 'modify'), upload.array('files', 10), create);
router.put('/:id', requirePermission('ORDERS', 'modify'), upload.array('files', 10), update);
router.delete('/:id', requirePermission('ORDERS', 'modify'), remove);

export default router;
