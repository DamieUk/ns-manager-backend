import { Router } from 'express';
import { list, getById, uploadDocument, download, remove } from '../controllers/documents.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { upload } from '../middleware/upload';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermission('ORDERS', 'view'), list);
router.get('/:id', requirePermission('ORDERS', 'view'), getById);
router.get('/:id/download', requirePermission('ORDERS', 'view'), download);
router.post('/', requirePermission('ORDERS', 'modify'), upload.single('file'), uploadDocument);
router.delete('/:id', requirePermission('ORDERS', 'modify'), remove);

export default router;
