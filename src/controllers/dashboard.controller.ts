import { Request, Response } from 'express';
import { Types } from 'mongoose';
import Order from '../models/order.model';
import DailyProgress from '../models/dailyProgress.model';

export async function getDashboard(req: Request, res: Response): Promise<void> {
  const employeeFilter = typeof req.query.employee === 'string' ? req.query.employee : undefined;

  const orders = await Order.find({ status: 'active' })
    .populate('client', 'name')
    .populate('product', 'name')
    .populate('manager', 'firstName lastName')
    .populate('assignedEmployees', 'firstName lastName');
  const orderIds = orders.map((o) => o._id);

  const entries = (
    await DailyProgress.find({ order: { $in: orderIds } })
      .populate('employee', 'firstName lastName')
      .sort({ date: -1 })
  ).filter((e) => e.employee);

  const entriesByOrder = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = entry.order.toString();
    const bucket = entriesByOrder.get(key) ?? [];
    bucket.push(entry);
    entriesByOrder.set(key, bucket);
  }

  const response = {
    generatedAt: new Date().toISOString(),
    orders: orders
      .filter((order) => order.client && order.product)
      .map((order) => {
      const client = order.client as unknown as { _id: Types.ObjectId; name: string };
      const product = order.product as unknown as { _id: Types.ObjectId; name: string };
      const manager = order.manager as unknown as { _id: Types.ObjectId; firstName: string; lastName: string } | undefined;
      const assignedEmployees = order.assignedEmployees as unknown as Array<{
        _id: Types.ObjectId;
        firstName: string;
        lastName: string;
      }>;
      const orderEntries = entriesByOrder.get(order._id.toString()) ?? [];

      const totals = orderEntries.reduce(
        (acc, e) => ({
          completed: acc.completed + e.completed,
          needsRework: acc.needsRework + e.needsRework,
          partiallyAssembled: acc.partiallyAssembled + e.partiallyAssembled,
        }),
        { completed: 0, needsRework: 0, partiallyAssembled: 0 }
      );

      const visibleEntries = employeeFilter
        ? orderEntries.filter((e) => (e.employee as unknown as { _id: Types.ObjectId })._id.toString() === employeeFilter)
        : orderEntries;

      return {
        orderId: order._id.toString(),
        product: { id: product._id.toString(), name: product.name },
        client: { id: client._id.toString(), name: client.name },
        quantity: order.quantity,
        description: order.description,
        status: order.status,
        dueDate: order.dueDate ?? null,
        isOverdue: Boolean(order.dueDate) && order.dueDate! < new Date() && order.status === 'active',
        manager: manager ? { id: manager._id.toString(), name: `${manager.firstName} ${manager.lastName}` } : null,
        assignedEmployees: (assignedEmployees ?? [])
          .filter((e) => e && e._id)
          .map((e) => ({ id: e._id.toString(), name: `${e.firstName} ${e.lastName}` })),
        totals,
        remaining: Math.max(order.quantity - totals.completed, 0),
        entries: visibleEntries.map((e) => {
          const employee = e.employee as unknown as { _id: Types.ObjectId; firstName: string; lastName: string };
          return {
            id: e._id.toString(),
            employee: { id: employee._id.toString(), name: `${employee.firstName} ${employee.lastName}` },
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
