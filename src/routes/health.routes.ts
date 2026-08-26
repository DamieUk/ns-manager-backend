import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const mongoStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mongo: mongoStates[mongoose.connection.readyState],
  });
});

export default router;
