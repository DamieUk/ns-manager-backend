import { Router } from 'express';
import { listUsers, getUserById, createUser, updateUser, setPassword, deleteUser } from '../controllers/users.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermission('USERS', 'view'), listUsers);
router.get('/:id', requirePermission('USERS', 'view'), getUserById);
router.post('/', requirePermission('USERS', 'modify'), createUser);
router.put('/:id', requirePermission('USERS', 'modify'), updateUser);
router.put('/:id/password', requirePermission('USERS', 'modify'), setPassword);
router.delete('/:id', requirePermission('USERS', 'modify'), deleteUser);

export default router;
