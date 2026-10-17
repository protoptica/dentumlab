import { Data, Invoice, Material, uid } from "./domain";
export function demoData(): Data {
  const suppliers = [
    { id: uid(), name: "Bloomden", inn: "" },
    { id: uid(), name: "Стоматорг", inn: "" },
    { id: uid(), name: "Ozon", inn: "" },
    { id: uid(), name: "Русхим", inn: "" },
  ];
  const materials: Material[] = [
    [
      "Диоксид циркония 3D Pro",
      "Диски и блоки",
      "Bloomden",
      "BL-3D-A2",
      "шт.",
      "Ø 98 × 18 мм",
      "Цвет A2",
    ],
    [
      "Гипс Fujirock EP",
      "Гипсы и массы",
      "GC",
      "GC-FR",
      "кг",
      "5 кг",
      "Класс IV",
    ],
    [
      "Фреза твердосплавная",
      "Инструменты",
      "NTI",
      "H79EF",
      "шт.",
      "1 шт.",
      "Мелкая насечка",
    ],
    [
      "Спирт изопропиловый",
      "Расходные материалы",
      "",
      "IPA-10",
      "л",
      "10 л",
      "99,7%",
    ],
    [
      "Силикон Zetalabor",
      "Гипсы и массы",
      "Zhermack",
      "C400",
      "кг",
      "5 кг",
      "Твёрдость 80 Shore A",
    ],
    [
      "Перчатки нитриловые M",
      "Расходные материалы",
      "",
      "",
      "шт.",
      "100 шт.",
      "Без пудры",
    ],
  ].map((a) => ({
    id: uid(),
    name: a[0],
    category: a[1],
    manufacturer: a[2],
    sku: a[3],
    unit: a[4],
    pack: a[5],
    properties: a[6],
    version: 1,
  }));
  const now = new Date();
  const month = (back: number, day: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() - back, day, 12);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const specs: [number, number, number, number, number, number, string][] = [
    [0, 12, 0, 0, 6, 845000, "confirmed"],
    [0, 9, 1, 1, 4, 1220000, "confirmed"],
    [0, 6, 3, 3, 2, 310000, "confirmed"],
    [0, 3, 1, 2, 8, 185000, "confirmed"],
    [0, 14, 0, 0, 4, 890000, "review"],
    [0, 15, 2, 5, 5, 89000, "review"],
    [1, 19, 0, 0, 8, 810000, "confirmed"],
    [1, 8, 1, 4, 3, 745000, "confirmed"],
    [2, 21, 0, 0, 5, 810000, "confirmed"],
    [2, 7, 1, 1, 6, 1180000, "confirmed"],
    [3, 11, 1, 2, 12, 172000, "confirmed"],
    [4, 12, 0, 0, 7, 780000, "confirmed"],
    [5, 14, 1, 4, 5, 720000, "confirmed"],
  ];
  const invoices: Invoice[] = specs.map(
    ([back, day, s, m, q, p, status], n) => ({
      id: uid(),
      number: ["БЛ", "СТ", "ОЗ", "РХ"][s] + "-" + (1042 + n),
      date: month(back, day),
      supplier_id: suppliers[s].id,
      status: status as Invoice["status"],
      lines: [
        {
          id: uid(),
          name: materials[m].name,
          material_id: materials[m].id,
          quantity: String(q),
          unit: "уп.",
          unit_price: p,
          total: q * p,
          factor:
            m === 1 || m === 4 ? "5" : m === 3 ? "10" : m === 5 ? "100" : "1",
          category: materials[m].category,
          page: 1,
        },
      ],
      delivery: 0,
      vat: "Включён в цену",
      paid: status === "confirmed" && n !== 0 ? q * p : 0,
      received: status === "confirmed" && n !== 0,
      version: 1,
      seller: s === 2 ? "" : suppliers[s].name,
      marketplace: s === 2 ? "Ozon" : "",
      note: "",
    }),
  );
  return {
    suppliers,
    materials,
    invoices,
    documents: [],
    audit: [],
    synced_at: new Date().toISOString(),
  };
}
