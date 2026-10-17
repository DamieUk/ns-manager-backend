import { Request, Response } from 'express';
import { batchTotal, listOrders, Order } from '../models/order.model';
import { listStageEventsOf, ORDER_STAGES, Stage, stageIndex, WORK_STAGES } from '../models/orderStage.model';
import { invoiceTotal, isInvoiceOverdue, listInvoices } from '../models/invoice.model';
import { isPurchaseOpen, listPurchases } from '../models/purchase.model';
import { listShipments } from '../models/shipment.model';
import { listEntries } from '../models/dailyProgress.model';
import { findClientsByIds } from '../models/client.model';
import { findProductsByIds } from '../models/product.model';
import { findUsersByIds, listUsers } from '../models/user.model';
import { listLeaves } from '../models/leave.model';
import { byId } from '../utils/validate';
import { normalizeToUTCMidnight } from '../utils/normalizeDate';

// The owners' dashboard in numbers: the pipeline, money, production, where batches wait,
// procurement, shipping and the team. Everything is computed from the records on each request.

const DAY_MS = 86_400_000;
const round = (n: number) => Math.round(n * 100) / 100;
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

// The last `count` months, oldest first: «2026-05», ..., the current one.
function lastMonths(count: number, now: Date): string[] {
  return Array.from({ length: count }, (_, i) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - i), 1))));
}

const OPEN_STAGES = ORDER_STAGES.filter((s) => s !== 'done');

export async function getOverview(req: Request, res: Response): Promise<void> {
  const now = new Date();
  const today = normalizeToUTCMidnight(now);
  const since30 = new Date(today.getTime() - 29 * DAY_MS);
  const months = lastMonths(6, now);
  const thisMonth = monthKey(now);

  const [orders, invoices, purchases, shipments, entries, users, awayLeaves, pendingLeaves] = await Promise.all([
    listOrders(),
    listInvoices(),
    listPurchases(),
    listShipments(),
    listEntries({ from: since30 }),
    listUsers(),
    listLeaves({ statuses: ['approved'], from: today, to: today }),
    listLeaves({ statuses: ['pending'] }),
  ]);
  const [clients, products, events] = await Promise.all([
    findClientsByIds([...new Set(orders.map((o) => o.clientId))]),
    findProductsByIds([...new Set(orders.map((o) => o.productId))]),
    listStageEventsOf(),
  ]);
  const clientsById = byId(clients);
  const productsById = byId(products);
  const visible = orders.filter((o) => clientsById.has(o.clientId) && productsById.has(o.productId));
  const visibleIds = new Set(visible.map((o) => o.id));
  const active = visible.filter((o) => o.status === 'active');

  const shippedByOrder = new Map<string, number>();
  for (const s of shipments) for (const l of s.lines) shippedByOrder.set(l.orderId, (shippedByOrder.get(l.orderId) ?? 0) + l.quantity);

  // Pipeline: open batches per stage, their boards and value without VAT.
  const pipeline = OPEN_STAGES.map((stage) => {
    const here = active.filter((o) => o.stage === stage);
    return {
      stage,
      batches: here.length,
      boards: here.reduce((sum, o) => sum + o.quantity, 0),
      value: round(here.reduce((sum, o) => sum + (batchTotal(o) ?? 0), 0)),
    };
  });

  // Money: invoiced (with VAT) by issue month and received by payment month; what is owed.
  const live = invoices.filter((i) => i.status !== 'cancelled' && visibleIds.has(i.orderId));
  const moneyMonths = months.map((month) => ({
    month,
    invoiced: round(live.filter((i) => monthKey(i.issuedAt) === month).reduce((sum, i) => sum + invoiceTotal(i), 0)),
    paid: round(live.filter((i) => i.paidAt && monthKey(i.paidAt) === month).reduce((sum, i) => sum + (i.paidAmount ?? 0), 0)),
  }));
  const open = live.filter((i) => i.status === 'issued');
  const owed = (list: typeof open) => round(list.reduce((sum, i) => sum + invoiceTotal(i) - (i.paidAmount ?? 0), 0));
  const receivables = {
    notDue: owed(open.filter((i) => !isInvoiceOverdue(i))),
    overdue: owed(open.filter(isInvoiceOverdue)),
    overdueCount: open.filter(isInvoiceOverdue).length,
  };
  const yearAgo = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()));
  const paidByClient = new Map<string, number>();
  for (const i of live) if (i.paidAt && i.paidAt >= yearAgo) paidByClient.set(i.clientId, (paidByClient.get(i.clientId) ?? 0) + (i.paidAmount ?? 0));
  const byClient = [...paidByClient.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([clientId, paid]) => ({ client: clientsById.get(clientId)?.name ?? '—', paid: round(paid) }));

  // Production: daily output for 30 days, each batch in work, each employee.
  const visibleEntries = entries.filter((e) => visibleIds.has(e.orderId));
  const daily = Array.from({ length: 30 }, (_, i) => {
    const date = dayKey(new Date(since30.getTime() + i * DAY_MS));
    const day = visibleEntries.filter((e) => dayKey(e.date) === date);
    return {
      date,
      completed: day.reduce((sum, e) => sum + e.completed, 0),
      needsRework: day.reduce((sum, e) => sum + e.needsRework, 0),
    };
  });
  const allEntries = await listEntries({ orderIds: active.map((o) => o.id) });
  const completedByOrder = new Map<string, number>();
  for (const e of allEntries) completedByOrder.set(e.orderId, (completedByOrder.get(e.orderId) ?? 0) + e.completed);
  const productionStages: Stage[] = ['prep', 'assembly', 'washing', 'qc', 'shipping'];
  const batches = active
    .filter((o) => productionStages.includes(o.stage))
    .sort((a, b) => stageIndex(b.stage) - stageIndex(a.stage) || (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity))
    .map((o) => ({
      id: o.id,
      number: o.number,
      client: clientsById.get(o.clientId)!.name,
      product: productsById.get(o.productId)!.name,
      stage: o.stage,
      quantity: o.quantity,
      completed: Math.min(completedByOrder.get(o.id) ?? 0, o.quantity),
      shipped: shippedByOrder.get(o.id) ?? 0,
      dueDate: o.dueDate ?? null,
      isOverdue: Boolean(o.dueDate) && o.dueDate! < now,
    }));
  const employeeTotals = new Map<string, { completed: number; needsRework: number }>();
  for (const e of visibleEntries) {
    const t = employeeTotals.get(e.employeeId) ?? { completed: 0, needsRework: 0 };
    t.completed += e.completed;
    t.needsRework += e.needsRework;
    employeeTotals.set(e.employeeId, t);
  }
  const employees = byId(await findUsersByIds([...employeeTotals.keys()]));
  const byEmployee = [...employeeTotals.entries()]
    .filter(([id]) => employees.has(id))
    .map(([id, t]) => ({ employee: `${employees.get(id)!.firstName} ${employees.get(id)!.lastName}`, ...t }))
    .sort((a, b) => b.completed - a.completed);
  const done30 = visibleEntries.reduce((sum, e) => sum + e.completed, 0);
  const rework30 = visibleEntries.reduce((sum, e) => sum + e.needsRework, 0);

  // Where batches wait: average days a finished visit to each stage took, and how long the
  // batches there now have been waiting.
  const ordersById = byId(visible);
  const eventsByOrder = new Map<string, typeof events>();
  for (const e of events) if (ordersById.has(e.orderId)) eventsByOrder.set(e.orderId, [...(eventsByOrder.get(e.orderId) ?? []), e]);
  const spent = new Map<Stage, number[]>();
  for (const list of eventsByOrder.values()) {
    for (let i = 0; i < list.length - 1; i++) {
      const days = (list[i + 1].createdAt.getTime() - list[i].createdAt.getTime()) / DAY_MS;
      spent.set(list[i].toStage, [...(spent.get(list[i].toStage) ?? []), days]);
    }
  }
  const average = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
  const stageDurations = OPEN_STAGES.map((stage) => ({
    stage,
    averageDays: average(spent.get(stage) ?? []),
    currentDays: average(active.filter((o: Order) => o.stage === stage).map((o) => (now.getTime() - o.stageChangedAt.getTime()) / DAY_MS)),
  }));

  // Procurement and shipping.
  const openPurchases = purchases.filter((p) => isPurchaseOpen(p) && visibleIds.has(p.orderId));
  const procurement = {
    planned: openPurchases.filter((p) => p.status === 'planned').length,
    ordered: openPurchases.filter((p) => p.status === 'ordered').length,
    shipped: openPurchases.filter((p) => p.status === 'shipped').length,
    late: openPurchases.filter((p) => p.expectedAt && p.expectedAt < now).length,
  };
  const shippingMonths = months.map((month) => ({
    month,
    boards: shipments.filter((s) => monthKey(s.shippedAt) === month).reduce((sum, s) => sum + s.lines.reduce((n, l) => n + l.quantity, 0), 0),
  }));

  // The team today.
  const usersById = byId(users);
  const team = {
    employees: users.filter((u) => u.role === 'employee' && u.status !== 'deleted' && u.status !== 'fired').length,
    pendingLeaves: pendingLeaves.length,
    away: awayLeaves
      .filter((l) => usersById.has(l.userId))
      .map((l) => ({ name: `${usersById.get(l.userId)!.firstName} ${usersById.get(l.userId)!.lastName}`, kind: l.kind, until: l.endDate })),
  };

  const inWork = active.filter((o) => (WORK_STAGES as readonly string[]).includes(o.stage));
  res.json({
    generatedAt: now.toISOString(),
    kpis: {
      activeBatches: active.length,
      boardsInWork: inWork.reduce((sum, o) => sum + Math.max(o.quantity - (shippedByOrder.get(o.id) ?? 0), 0), 0),
      overdueBatches: active.filter((o) => o.dueDate && o.dueDate < now).length,
      awaiting: round(receivables.notDue + receivables.overdue),
      overdueAmount: receivables.overdue,
      paidThisMonth: moneyMonths.find((m) => m.month === thisMonth)?.paid ?? 0,
      shippedThisMonth: shippingMonths.find((m) => m.month === thisMonth)?.boards ?? 0,
      completed30: done30,
      reworkRate30: done30 + rework30 > 0 ? Math.round((rework30 / (done30 + rework30)) * 1000) / 10 : 0,
      pipelineValue: round(pipeline.reduce((sum, p) => sum + p.value, 0)),
    },
    pipeline,
    money: { months: moneyMonths, receivables, byClient },
    production: { daily, batches, byEmployee },
    stageDurations,
    procurement,
    shipping: { months: shippingMonths },
    team,
  });
}
