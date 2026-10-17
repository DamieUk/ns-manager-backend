import { Request, Response } from 'express';
import { createLeave, findLeaveById, LEAVE_KINDS, LeaveKind, LeaveRequest, leaveJson, listLeaves, saveLeave } from '../models/leave.model';
import { findUsersByIds, User } from '../models/user.model';
import { HttpError } from '../utils/HttpError';
import { byId, castId } from '../utils/validate';
import { normalizeToUTCMidnight } from '../utils/normalizeDate';

const personJson = (u: User) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, jobTitle: u.jobTitle });

async function respond(leaves: LeaveRequest[]) {
  const users = byId(await findUsersByIds([...new Set(leaves.flatMap((l) => [l.userId, ...(l.decidedBy ? [l.decidedBy] : [])]))]));
  return leaves
    .filter((l) => users.has(l.userId))
    .map((l) => {
      const decider = l.decidedBy ? users.get(l.decidedBy) : undefined;
      return leaveJson(l, { user: personJson(users.get(l.userId)!), decidedBy: decider ? personJson(decider) : null });
    });
}

async function findLeave(id: unknown): Promise<LeaveRequest> {
  const leave = await findLeaveById(castId(id));
  if (!leave) throw new HttpError(404, 'Leave request not found');
  return leave;
}

// Owners see everyone's requests (?status=pending narrows them); everyone else only their own.
export async function list(req: Request, res: Response): Promise<void> {
  const isOwner = req.user!.role === 'executive';
  const mine = !isOwner || req.query.mine === '1';
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const leaves = await listLeaves({
    userId: mine ? req.user!.id : undefined,
    statuses: status ? (status.split(',') as LeaveRequest['status'][]) : undefined,
  });
  res.json(await respond(leaves));
}

// A request for oneself. It can't overlap one's other pending or approved requests.
export async function create(req: Request, res: Response): Promise<void> {
  const { kind, startDate, endDate, reason } = req.body as Record<string, unknown>;
  if (!LEAVE_KINDS.includes(kind as LeaveKind)) throw new HttpError(400, 'Оберіть тип відсутності');
  if (!startDate || !endDate) throw new HttpError(400, 'Вкажіть дати');
  const start = normalizeToUTCMidnight(startDate);
  const end = normalizeToUTCMidnight(endDate);
  if (end < start) throw new HttpError(400, 'Кінець раніше за початок');

  const overlapping = await listLeaves({ userId: req.user!.id, statuses: ['pending', 'approved'], from: start, to: end });
  if (overlapping.length > 0) throw new HttpError(409, 'На ці дати вже є заявка');

  const leave = await createLeave({ userId: req.user!.id, kind: kind as LeaveKind, startDate: start, endDate: end, reason: typeof reason === 'string' ? reason : undefined });
  res.status(201).json((await respond([leave]))[0]);
}

// The requester withdraws a request that hasn't started yet (or is still pending).
export async function cancel(req: Request, res: Response): Promise<void> {
  const leave = await findLeave(req.params.id);
  if (leave.userId !== req.user!.id) throw new HttpError(403, 'Not your request');
  if (leave.status === 'rejected' || leave.status === 'cancelled') throw new HttpError(409, 'Заявку вже закрито');
  if (leave.status === 'approved' && leave.startDate <= normalizeToUTCMidnight(new Date())) {
    throw new HttpError(409, 'Відпустка вже почалась: зверніться до власника');
  }
  leave.status = 'cancelled';
  await saveLeave(leave);
  res.json((await respond([leave]))[0]);
}

// An owner approves or rejects a pending request ({ decision: 'approved' | 'rejected', note }).
// An approved request can still be revoked (rejected) by an owner.
export async function decide(req: Request, res: Response): Promise<void> {
  const leave = await findLeave(req.params.id);
  const { decision, note } = req.body as { decision?: string; note?: string };
  if (decision !== 'approved' && decision !== 'rejected') throw new HttpError(400, 'Invalid decision');
  if (leave.status === 'cancelled') throw new HttpError(409, 'Заявку скасовано працівником');
  if (leave.status === 'rejected') throw new HttpError(409, 'Заявку вже відхилено');
  if (leave.status === 'approved' && decision === 'approved') throw new HttpError(409, 'Заявку вже погоджено');

  leave.status = decision;
  leave.decidedBy = req.user!.id;
  leave.decidedAt = new Date();
  leave.decisionNote = typeof note === 'string' ? note : undefined;
  await saveLeave(leave);
  res.json((await respond([leave]))[0]);
}
