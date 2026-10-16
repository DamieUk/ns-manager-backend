import { findClientsByIds } from '../models/client.model';
import { findOrderLinks } from '../models/order.model';
import { findProductsByIds } from '../models/product.model';
import { byId } from '../utils/validate';

export type OrderLink = { id: string; number: string; client: { id: string; name: string }; product: { id: string; name: string } };

// The batch, client and product names that lists of invoices or purchases show. Batches (or
// their client or product) deleted since are missing from the map.
export async function loadOrderLinks(orderIds: string[]): Promise<Map<string, OrderLink>> {
  const orders = await findOrderLinks([...new Set(orderIds)]);
  const [clients, products] = await Promise.all([
    findClientsByIds([...new Set(orders.map((o) => o.clientId))]),
    findProductsByIds([...new Set(orders.map((o) => o.productId))]),
  ]);
  const clientsById = byId(clients);
  const productsById = byId(products);
  const links = new Map<string, OrderLink>();
  for (const o of orders) {
    const client = clientsById.get(o.clientId);
    const product = productsById.get(o.productId);
    if (!client || !product) continue;
    links.set(o.id, { id: o.id, number: o.number, client: { id: client.id, name: client.name }, product: { id: product.id, name: product.name } });
  }
  return links;
}
