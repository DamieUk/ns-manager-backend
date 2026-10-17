import { Router } from 'express';
import { get, update, changePassword } from '../controllers/profile.controller';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

router.use(requireAuth);

router.get('/', get);
router.put('/', update);
router.put('/password', changePassword);

export default router;
