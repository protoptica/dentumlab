import React from "react";
import { type Data, type Status, labels, money } from "./domain";
const compactDecimal = (value: string) =>
  value.replace(/([.,]\d*?[1-9])0+$|[.,]0+$/, "$1");

export default function AuditDetails({
  before,
  after,
  data,
}: {
  before: unknown;
  after: unknown;
  data: Data;
}) {
  const names: Record<string, string> = {
    name: "Название",
    number: "Номер",
    date: "Дата",
    category: "Категория",
    manufacturer: "Производитель",
    sku: "Артикул",
    unit: "Единица",
    pack: "Фасовка",
    properties: "Характеристики",
    delivery: "Доставка",
    discount: "Скидка (учтена в ценах)",
    vat: "НДС",
    paid: "Оплачено",
    received: "Товар получен",
    seller: "Продавец",
    marketplace: "Площадка",
    note: "Примечание",
    status: "Статус",
  };
  const describe = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return "—";
    const obj = raw as Record<string, unknown>;
    const rows = Object.entries(obj)
      .filter(([k]) => names[k])
      .map(
        ([k, v]) =>
          names[k] +
          ": " +
          (k === "paid" || k === "delivery" || k === "discount"
            ? money(Number(v))
            : k === "received"
              ? v
                ? "Да"
                : "Нет"
              : k === "status"
                ? labels[v as Status]
                : String(v || "—")),
      );
    if (Array.isArray(obj.lines))
      for (const l of obj.lines)
        rows.push(
          l.name +
            " · " +
            l.quantity +
            " " +
            l.unit +
            " · " +
            money(l.total) +
            " · фасовка: " +
            compactDecimal(String(l.factor || "неизвестна")) +
            " · материал: " +
            (data.materials.find((m) => m.id === l.material_id)?.name ||
              "не выбран"),
        );
    return rows.join("\n") || "Запись создана";
  };
  return (
    <div className="audit-values">
      <div>
        <b>До</b>
        <p>{describe(before)}</p>
      </div>
      <div>
        <b>После</b>
        <p>{describe(after)}</p>
      </div>
    </div>
  );
}
