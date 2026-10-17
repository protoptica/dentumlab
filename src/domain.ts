export type Status =
  "received" | "processing" | "review" | "confirmed" | "error" | "archived";
export type Material = {
  id: string;
  name: string;
  category: string;
  manufacturer: string;
  sku: string;
  unit: string;
  pack: string;
  properties: string;
  version: number;
};
export type Supplier = { id: string; name: string; inn: string };
export type Line = {
  id: string;
  name: string;
  material_id: string | null;
  quantity: string;
  unit: string;
  unit_price: number;
  total: number;
  factor: string;
  base_unit?: string;
  category: string;
  page: number;
};
export type Invoice = {
  id: string;
  number: string;
  date: string;
  supplier_id: string;
  status: Status;
  lines: Line[];
  delivery: number;
  vat: string;
  paid: number;
  received: boolean;
  version: number;
  document_id?: string;
  seller: string;
  marketplace: string;
  note: string;
};
export type Document = {
  id: string;
  name: string;
  status: Status;
  source: string;
  archive_status: string;
  error: string | null;
  created_at: string;
};
export type Audit = {
  id: string;
  created_at: string;
  action: string;
  entity_id: string;
  before: unknown;
  after: unknown;
};
export type Data = {
  invoices: Invoice[];
  materials: Material[];
  suppliers: Supplier[];
  documents: Document[];
  audit: Audit[];
  synced_at: string;
};
export const labels: Record<Status, string> = {
  received: "Получен",
  processing: "Обрабатывается",
  review: "На проверке",
  confirmed: "Подтверждён",
  error: "Ошибка",
  archived: "Архивирован",
};
export const money = (v: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: v % 100 === 0 ? 0 : 2,
  }).format(v / 100);
export const uid = () => crypto.randomUUID();
export const emptyData = (): Data => ({
  invoices: [],
  materials: [],
  suppliers: [],
  documents: [],
  audit: [],
  synced_at: new Date().toISOString(),
});
// Decimal inputs are converted using integers; accounting never accumulates binary fractions.
export function decimal(value: string, scale = 2): bigint {
  const s = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) throw Error("Введите неотрицательное число");
  const [a, b = ""] = s.split(".");
  if (b.length > scale) throw Error(`Допустимо знаков после запятой: ${scale}`);
  return BigInt(a) * 10n ** BigInt(scale) + BigInt(b.padEnd(scale, "0"));
}
export function cents(s: string): number {
  const n = Number(decimal(s));
  if (!Number.isSafeInteger(n) || n > 1e12) throw Error("Сумма слишком велика");
  return n;
}
export function lineTotal(q: string, p: number): number {
  const n = (decimal(q, 3) * BigInt(p) + 500n) / 1000n;
  const out = Number(n);
  if (!Number.isSafeInteger(out) || out > 1e12)
    throw Error("Сумма слишком велика");
  return out;
}
export const total = (i: Invoice) =>
  i.lines.reduce((s, l) => s + l.total, 0) + i.delivery;
export function validateInvoice(i: Invoice) {
  if (!i.number.trim() || !i.date || !i.supplier_id)
    throw Error("Укажите номер, дату и поставщика");
  if (!i.lines.length) throw Error("Добавьте хотя бы одну строку");
  for (const l of i.lines) {
    if (!l.name.trim() || decimal(l.quantity, 3) <= 0n)
      throw Error("Проверьте название и количество в строках");
    if (
      !l.material_id &&
      l.factor &&
      decimal(l.factor, 3) !== 1000n &&
      !l.base_unit?.trim()
    )
      throw Error(
        "Укажите базовую единицу нового материала для пересчёта фасовки",
      );
    if (l.factor && decimal(l.factor, 3) <= 0n)
      throw Error("Коэффициент должен быть больше нуля");
    if (l.total !== lineTotal(l.quantity, l.unit_price))
      throw Error("Сумма строки не совпадает с количеством и ценой");
  }
  if (i.paid > total(i)) throw Error("Оплата превышает сумму счёта");
}
export function csv(data: Data, invoices: Invoice[]) {
  const cell = (v: unknown) =>
    `"${String(v ?? "")
      .replace(/^[=+@-]/, "'$&")
      .replaceAll('"', '""')}"`;
  return (
    "\uFEFF" +
    [
      [
        "Дата",
        "Номер",
        "Поставщик",
        "Материал",
        "Количество",
        "Единица",
        "Цена, руб.",
        "Сумма, руб.",
        "Доставка, руб.",
        "НДС",
        "Статус",
      ],
      ...invoices.flatMap((i) =>
        i.lines.map((l, n) => [
          i.date,
          i.number,
          data.suppliers.find((s) => s.id === i.supplier_id)?.name,
          l.name,
          l.quantity,
          l.unit,
          (l.unit_price / 100).toFixed(2),
          (l.total / 100).toFixed(2),
          n === 0 ? (i.delivery / 100).toFixed(2) : "",
          i.vat,
          labels[i.status],
        ]),
      ),
    ]
      .map((r) => r.map(cell).join(";"))
      .join("\r\n")
  );
}
