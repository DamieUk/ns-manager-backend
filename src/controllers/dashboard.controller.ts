import { Request, Response } from 'express';
import { listActiveOrders } from '../models/order.model';
import { listEntries } from '../models/dailyProgress.model';
import { findUsersByIds, User } from '../models/user.model';
import { byId } from '../utils/validate';
import { loadOrderRefs } from './orders.controller';

export async function getDashboard(req: Request, res: Response): Promise<void> {
  const employeeFilter = typeof req.query.employee === 'string' ? req.query.employee : undefined;

  const orders = await listActiveOrders();
  const refs = await loadOrderRefs(orders);

  const allEntries = await listEntries({ orderIds: orders.map((o) => o.id) });
  const employees = byId<User>(await findUsersByIds([...new Set(allEntries.map((e) => e.employeeId))]));
  const entries = allEntries.filter((e) => employees.has(e.employeeId));

  const entriesByOrder = new Map<string, typeof entries>();
  for (const entry of entries) {
    const bucket = entriesByOrder.get(entry.orderId) ?? [];
    bucket.push(entry);
    entriesByOrder.set(entry.orderId, bucket);
  }

  const response = {
    generatedAt: new Date().toISOString(),
    orders: orders
      .filter((order) => refs.clients.has(order.clientId) && refs.products.has(order.productId))
      .map((order) => {
        const client = refs.clients.get(order.clientId)!;
        const product = refs.products.get(order.productId)!;
        const manager = order.managerId ? refs.users.get(order.managerId) : undefined;
        const assignedEmployees = order.assignedEmployees.map((id) => refs.users.get(id)).filter((u): u is User => Boolean(u));
        const orderEntries = entriesByOrder.get(order.id) ?? [];

        const totals = orderEntries.reduce(
          (acc, e) => ({
            completed: acc.completed + e.completed,
            needsRework: acc.needsRework + e.needsRework,
            partiallyAssembled: acc.partiallyAssembled + e.partiallyAssembled,
          }),
          { completed: 0, needsRework: 0, partiallyAssembled: 0 }
        );

        const visibleEntries = employeeFilter ? orderEntries.filter((e) => e.employeeId === employeeFilter) : orderEntries;

        return {
          orderId: order.id,
          product: { id: product.id, name: product.name },
          client: { id: client.id, name: client.name },
          quantity: order.quantity,
          description: order.description,
          status: order.status,
          dueDate: order.dueDate ?? null,
          isOverdue: Boolean(order.dueDate) && order.dueDate! < new Date() && order.status === 'active',
          manager: manager ? { id: manager.id, name: `${manager.firstName} ${manager.lastName}` } : null,
          assignedEmployees: assignedEmployees.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` })),
          totals,
          remaining: Math.max(order.quantity - totals.completed, 0),
          entries: visibleEntries.map((e) => {
            const employee = employees.get(e.employeeId)!;
            return {
              id: e.id,
              employee: { id: employee.id, name: `${employee.firstName} ${employee.lastName}` },
              date: e.date,
              completed: e.completed,
              needsRework: e.needsRework,
              partiallyAssembled: e.partiallyAssembled,
              notes: e.notes ?? '',
            };
          }),
        };
      }),
  };

  res.json(response);
}
