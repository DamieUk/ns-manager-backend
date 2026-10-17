import { Router } from 'express';
import { list, create, remove, pdf } from '../controllers/shipments.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';

const router = Router();

router.use(requireAuth, requireRole('executive'));

router.get('/', list);
router.get('/:id/pdf', pdf);
router.post('/', create);
router.delete('/:id', remove);

export default router;
