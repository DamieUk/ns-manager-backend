import { Order } from './order.model';
import { isSigned, listContractsOfClients, paperStatus } from './contract.model';
import { isPrepaid, listInvoices } from './invoice.model';
import { isPurchaseOpen, listPurchases } from './purchase.model';
import { nextStage, Stage, stageIndex } from './orderStage.model';

// What is known about a batch's papers and payments when deciding whether it may move on.
export interface GateContext {
  frameworkSigned: boolean;
  annexSigned: boolean;
  prepaid: boolean;
  openPurchases: number;
}

// What a batch needs before it may enter a stage. Moving forward checks the gates of every stage
// it passes (and reopening a cancelled batch those up to the target); moving back or cancelling
// is always allowed. These are hard blocks: there is no override.
const GATES: Array<{ stage: Stage; unmet: (order: Order, ctx: GateContext) => string | false }> = [
  { stage: 'agreement', unmet: (o) => !(o.unitQuote && o.quoteCurrency) && 'Вкажіть ціну прорахунку за плату' },
  { stage: 'invoicing', unmet: (_, ctx) => !ctx.frameworkSigned && 'Потрібен підписаний рамковий договір з клієнтом' },
  { stage: 'invoicing', unmet: (_, ctx) => !ctx.annexSigned && 'Потрібен підписаний додаток на цю партію' },
  { stage: 'invoicing', unmet: (o) => !o.unitPrice && 'Зафіксуйте ціну за плату в гривнях' },
  { stage: 'procurement', unmet: (_, ctx) => !ctx.prepaid && 'Чекаємо передоплату' },
  { stage: 'assembly', unmet: (_, ctx) => ctx.openPurchases > 0 && `Не всі закупівлі отримані (${ctx.openPurchases})` },
];

export function stageBlockers(order: Order, ctx: GateContext, target: Stage): string[] {
  if (target === 'cancelled') return [];
  const from = stageIndex(order.stage);
  const to = stageIndex(target);
  if (to <= from) return [];
  return GATES.filter((g) => stageIndex(g.stage) > from && stageIndex(g.stage) <= to)
    .map((g) => g.unmet(order, ctx))
    .filter((m): m is string => Boolean(m));
}

export function nextStageBlockers(order: Order, ctx: GateContext): string[] {
  const next = nextStage(order.stage);
  return next ? stageBlockers(order, ctx, next) : [];
}

// From the invoicing stage on, the price and quantity are the ones in the signed annex and invoices.
export function isPriceLocked(order: Order): boolean {
  return stageIndex(order.stage) >= stageIndex('invoicing');
}

export async function loadGateContexts(orders: Order[]): Promise<Map<string, GateContext>> {
  const orderIds = orders.map((o) => o.id);
  const [contracts, invoices, purchases] = await Promise.all([
    listContractsOfClients([...new Set(orders.map((o) => o.clientId))]),
    listInvoices({ orderIds }),
    listPurchases({ orderIds }),
  ]);
  return new Map(
    orders.map((order) => {
      const own = contracts.filter((c) => c.clientId === order.clientId);
      const framework = paperStatus(own).framework;
      return [
        order.id,
        {
          frameworkSigned: Boolean(framework?.signedAt),
          annexSigned: own.some((c) => c.type === 'annex' && c.orderId === order.id && isSigned(c)),
          prepaid: isPrepaid(invoices.filter((i) => i.orderId === order.id)),
          openPurchases: purchases.filter((p) => p.orderId === order.id && isPurchaseOpen(p)).length,
        },
      ];
    })
  );
}
