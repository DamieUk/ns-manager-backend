import { Router, Request, Response } from 'express';
import { pingDB } from '../db';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: (await pingDB()) ? 'connected' : 'disconnected',
    // The client IP as the app sees it (rate limiting is per IP). Behind a proxy this must be the
    // visitor's real address, not 127.0.0.1 — a quick check after deploying to a new host.
    ip: req.ip,
  });
});

export default router;
