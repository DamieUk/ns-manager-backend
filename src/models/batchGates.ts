import { Order } from './order.model';
import { isSigned, listContractsOfClients, paperStatus } from './contract.model';
import { nextStage, Stage, stageIndex } from './orderStage.model';

// What is known about a batch's papers and payments when deciding whether it may move on.
export interface GateContext {
  frameworkSigned: boolean;
  annexSigned: boolean;
}

// What a batch needs before it may enter a stage. Moving forward checks the gates of every stage
// it passes (and reopening a cancelled batch those up to the target); moving back or cancelling
// is always allowed. These are hard blocks: there is no override.
const GATES: Array<{ stage: Stage; unmet: (order: Order, ctx: GateContext) => string | false }> = [
  { stage: 'agreement', unmet: (o) => !(o.quoteAmount && o.quoteCurrency) && 'Вкажіть ціну прорахунку' },
  { stage: 'invoicing', unmet: (_, ctx) => !ctx.frameworkSigned && 'Потрібен підписаний рамковий договір з клієнтом' },
  { stage: 'invoicing', unmet: (_, ctx) => !ctx.annexSigned && 'Потрібен підписаний додаток на цю партію' },
  { stage: 'invoicing', unmet: (o) => !o.priceUah && 'Зафіксуйте ціну партії в гривнях' },
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

// From the invoicing stage on, the batch price is the one in the signed annex and invoices.
export function isPriceLocked(order: Order): boolean {
  return stageIndex(order.stage) >= stageIndex('invoicing');
}

export async function loadGateContexts(orders: Order[]): Promise<Map<string, GateContext>> {
  const contracts = await listContractsOfClients([...new Set(orders.map((o) => o.clientId))]);
  return new Map(
    orders.map((order) => {
      const own = contracts.filter((c) => c.clientId === order.clientId);
      const framework = paperStatus(own).framework;
      return [
        order.id,
        {
          frameworkSigned: Boolean(framework?.signedAt),
          annexSigned: own.some((c) => c.type === 'annex' && c.orderId === order.id && isSigned(c)),
        },
      ];
    })
  );
}
