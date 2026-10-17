import { Router } from 'express';
import { list, create, update, recordPayment, remove, pdf } from '../controllers/invoices.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';

const router = Router();

router.use(requireAuth, requireRole('executive'));

router.get('/', list);
router.get('/:id/pdf', pdf);
router.post('/', create);
router.put('/:id', update);
router.put('/:id/payment', recordPayment);
router.delete('/:id', remove);

export default router;
