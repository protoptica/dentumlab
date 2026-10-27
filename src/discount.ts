import { type Invoice, type Line, decimal } from "./domain";
export const isDelivery = (l: Line) =>
  /доставк|транспортн.*услуг|shipping|delivery/i.test(l.name);
export function allocate(
  amount: number,
  weights: number[],
  restore = false,
): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(amount) || amount < 0 || (!restore && amount > sum))
    throw Error("Скидка не может превышать стоимость товаров");
  if (!sum) return weights.map(() => 0);
  const parts = weights.map((w, index) => ({
    index,
    n: (BigInt(amount) * BigInt(w)) / BigInt(sum),
    r: (BigInt(amount) * BigInt(w)) % BigInt(sum),
  }));
  let rest = amount - parts.reduce((a, p) => a + Number(p.n), 0);
  for (const p of [...parts].sort((a, b) =>
    a.r === b.r ? a.index - b.index : a.r > b.r ? -1 : 1,
  ))
    if (rest-- > 0) p.n++;
  return parts.map((p) => Number(p.n));
}
export function prepareDiscount(i: Invoice): Invoice {
  const next = structuredClone(i);
  const eligible = next.lines.map((l) => (isDelivery(l) ? 0 : l.total));
  const oldDiscount = next.discount || 0;
  // Legacy invoices store net prices and an informational discount. Recover a stable gross basis once.
  const sum = eligible.reduce((a, b) => a + b, 0);
  const extras = sum
    ? allocate(oldDiscount, eligible, true)
    : eligible.map(() => 0);
  next.lines = next.lines.map((l, n) => ({
    ...l,
    unit_price: Number(
      (BigInt(l.total) * 1000n + decimal(l.quantity, 3) / 2n) /
        decimal(l.quantity, 3),
    ),
    base_total: l.base_total ?? l.total + (extras[n] || 0),
    discount_amount:
      l.base_total != null ? l.discount_amount || 0 : extras[n] || 0,
  }));
  return next;
}
export function applyDiscount(
  i: Invoice,
  amount: number,
  percent: number | null = null,
): Invoice {
  const next = prepareDiscount(i);
  const weights = next.lines.map((l) => (isDelivery(l) ? 0 : l.base_total!));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (percent !== null) {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100)
      throw Error("Скидка должна быть от 0 до 100%");
    amount = Number(
      (BigInt(sum) * decimal(String(percent), 2) + 5000n) / 10000n,
    );
  }
  const discounts = allocate(amount, weights);
  next.lines = next.lines.map((l, n) => {
    const total = l.base_total! - discounts[n];
    return {
      ...l,
      discount_amount: discounts[n],
      total,
      unit_price: Number(
        (BigInt(total) * 1000n + decimal(l.quantity, 3) / 2n) /
          decimal(l.quantity, 3),
      ),
    };
  });
  next.discount = amount;
  next.discount_percent = percent;
  if (next.paid > 0)
    next.paid = next.lines.reduce((s, l) => s + l.total, 0) + next.delivery;
  return next;
}
export function basePrice(l: Line): number {
  return Number(
    (BigInt(l.base_total ?? l.total) * 1000n + decimal(l.quantity, 3) / 2n) /
      decimal(l.quantity, 3),
  );
}
