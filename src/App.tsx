import { loginError } from "./auth-errors";
import AccountSettings from "./AccountSettings";
import React, { useEffect, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import {
  LayoutDashboard,
  ReceiptText,
  Boxes,
  Building2,
  ScanLine,
  Settings,
  Plus,
  ArrowUpRight,
  ArrowDownToLine,
  Search,
  ChevronRight,
  ChevronLeft,
  Upload,
  Check,
  X,
  FileText,
  RefreshCw,
  LogOut,
  WifiOff,
  ArrowRight,
  Trash2,
  Clock,
  CheckCheck,
  SlidersHorizontal,
  ExternalLink,
  Leaf,
} from "lucide-react";
import {
  Data,
  Invoice,
  Material,
  Line,
  Status,
  labels,
  money,
  total,
  uid,
  emptyData,
  cents,
  lineTotal,
  csv,
} from "./domain";
import * as api from "./store";
type Page =
  "overview" | "invoices" | "materials" | "suppliers" | "review" | "settings";
const pages: { id: Page; label: string; icon: typeof Boxes }[] = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "invoices", label: "Счета", icon: ReceiptText },
  { id: "materials", label: "Материалы", icon: Boxes },
  { id: "suppliers", label: "Поставщики", icon: Building2 },
  { id: "review", label: "Проверка документов", icon: ScanLine },
];
function pageFromHash(): Page {
  const value = location.hash.replace(/^#\/?/, "");
  return [
    "overview",
    "invoices",
    "materials",
    "suppliers",
    "review",
    "settings",
  ].includes(value)
    ? (value as Page)
    : "overview";
}
const formatDate = (s: string) =>
  new Date(s + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
  });
const today = () => new Date().toLocaleDateString("sv-SE");
const blankLine = (): Line => ({
  id: uid(),
  name: "",
  material_id: null,
  quantity: "1",
  unit: "шт.",
  unit_price: 0,
  total: 0,
  factor: "",
  category: "Без категории",
  page: 1,
});
const blankInvoice = (): Invoice => ({
  id: uid(),
  number: "",
  date: today(),
  supplier_id: "",
  status: "review",
  lines: [blankLine()],
  delivery: 0,
  discount: 0,
  vat: "Не указан",
  paid: 0,
  received: false,
  version: 0,
  seller: "",
  marketplace: "",
  note: "",
});
function Badge({ status }: { status: Status }) {
  return (
    <span className={"badge " + status}>
      <span />
      {labels[status]}
    </span>
  );
}
function download(text: string, name: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Modal({
  title,
  close,
  children,
  wide = false,
  error,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  wide?: boolean;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide" : ""}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button aria-label="Закрыть" className="icon-button" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {error && (
        <div className="modal-error" role="alert">
          {error}
        </div>
      )}
      {children}
    </dialog>
  );
}
function App() {
  const [data, setData] = useState<Data>(emptyData),
    [page, setPage] = useState<Page>(pageFromHash),
    [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(api.isDemo),
    [loading, setLoading] = useState(true),
    [online, setOnline] = useState(navigator.onLine),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [updateAvailable, setUpdateAvailable] = useState(false),
    [search, setSearch] = useState(""),
    [period, setPeriod] = useState("all"),
    [supplier, setSupplier] = useState(""),
    [category, setCategory] = useState(""),
    [status, setStatus] = useState(""),
    [sort, setSort] = useState("date"),
    [editing, setEditing] = useState<Invoice | null>(null),
    [material, setMaterial] = useState<Material | null>(null),
    [showUpload, setShowUpload] = useState(false),
    [showSupplier, setShowSupplier] = useState(false),
    [busy, setBusy] = useState(false),
    [originalUrl, setOriginalUrl] = useState("");
  const currentUser = useRef(session?.user.id);
  currentUser.current = session?.user.id;
  const refresh = async () => {
    const who = currentUser.current;
    setLoading(true);
    try {
      const next = await api.load();
      if (who !== currentUser.current) return;
      setData(next);
      setError("");
    } catch (e) {
      const saved = await api.cache();
      if (who !== currentUser.current) return;
      if (saved) setData(saved);
      setError(
        saved
          ? "Обновление не удалось. Показана сохранённая копия."
          : message(e),
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const on = () => {
        setOnline(true);
        if (ready) void refresh();
      },
      off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [ready]);
  useEffect(() => {
    if (!api.supabase) {
      void refresh();
      return;
    }
    api.supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = api.supabase.auth.onAuthStateChange(
      (event, s) => {
        if (event === "SIGNED_OUT") {
          void api.clearSessionCache();
          setData(emptyData());
          setReady(false);
        }
        setSession(s);
      },
    );
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (api.isDemo) return;
    if (!session) {
      setReady(false);
      setLoading(false);
      setData(emptyData());
      return;
    }
    let active = true;
    api
      .initialize(session)
      .then(() => {
        if (active) {
          setReady(true);
          void refresh();
        }
      })
      .catch((e) => setError(message(e)));
    return () => {
      active = false;
    };
  }, [session?.user.id]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  function message(e: unknown) {
    return e instanceof Error
      ? e.message
      : typeof e === "object" && e && "message" in e
        ? String(e.message)
        : "Не удалось выполнить операцию";
  }
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const navigate = (p: Page) => {
    if (location.hash !== "#/" + p) history.pushState(null, "", "#/" + p);
    setPage(p);
    setSearch("");
    setStatus("");
    setCategory("");
    setSupplier("");
    setOriginalUrl("");
  };
  useEffect(() => {
    const change = () => {
      setPage(pageFromHash());
      setSearch("");
      setStatus("");
      setCategory("");
      setSupplier("");
      setOriginalUrl("");
      setEditing(null);
    };
    if (!location.hash) history.replaceState(null, "", "#/" + pageFromHash());
    window.addEventListener("hashchange", change);
    window.addEventListener("popstate", change);
    return () => {
      window.removeEventListener("hashchange", change);
      window.removeEventListener("popstate", change);
    };
  }, []);
  useEffect(() => {
    const update = () => setUpdateAvailable(true);
    window.addEventListener("dentum-update", update);
    return () => window.removeEventListener("dentum-update", update);
  }, []);
  const pending =
    data.invoices.filter((i) => i.status === "review").length +
    data.documents.filter((d) => d.status === "error").length;
  const categories = [
    ...new Set(
      data.materials
        .map((m) => m.category)
        .concat(data.invoices.flatMap((i) => i.lines.map((l) => l.category))),
    ),
  ].filter(Boolean);
  const start =
    period === "month"
      ? today().slice(0, 7) + "-01"
      : period === "quarter"
        ? new Date(
            new Date().getFullYear(),
            Math.floor(new Date().getMonth() / 3) * 3,
            1,
            12,
          ).toLocaleDateString("sv-SE")
        : period === "year"
          ? today().slice(0, 4) + "-01-01"
          : "";
  const filtered = data.invoices
    .filter(
      (i) =>
        (!start || (i.date >= start && i.date <= today())) &&
        (!supplier || i.supplier_id === supplier) &&
        (!category || i.lines.some((l) => l.category === category)) &&
        (!status || i.status === status) &&
        (!search ||
          [
            i.number,
            data.suppliers.find((s) => s.id === i.supplier_id)?.name,
            ...i.lines.map((l) => l.name),
          ]
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase())),
    )
    .sort((a, b) =>
      sort === "sum" ? total(b) - total(a) : b.date.localeCompare(a.date),
    );
  const confirmed = filtered.filter((i) => i.status === "confirmed");
  const sum = confirmed.reduce((s, i) => s + total(i), 0),
    paid = confirmed.reduce((s, i) => s + i.paid, 0);
  const table = (rows: Invoice[]) =>
    rows.length ? (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Счёт / дата</th>
              <th>Поставщик</th>
              <th>Сумма</th>
              <th>Статус</th>
              <th>Оплата / получение</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr
                key={i.id}
                onClick={() => {
                  setEditing(structuredClone(i));
                  setOriginalUrl("");
                }}
              >
                <td>
                  <button
                    className="row-link"
                    onClick={() => setEditing(structuredClone(i))}
                  >
                    № {i.number}
                  </button>
                  <small>
                    {formatDate(i.date)} · {i.lines.length} поз.
                  </small>
                </td>
                <td>
                  <div className="supplier-cell">
                    <span className="supplier-avatar">
                      {data.suppliers
                        .find((s) => s.id === i.supplier_id)
                        ?.name.slice(0, 1) || "—"}
                    </span>
                    {data.suppliers.find((s) => s.id === i.supplier_id)?.name ||
                      "Не указан"}
                  </div>
                </td>
                <td className="numeric strong">{money(total(i))}</td>
                <td>
                  <Badge status={i.status} />
                </td>
                <td>
                  <span className="muted">
                    {i.paid >= total(i) && total(i) > 0
                      ? "Оплачен"
                      : i.paid
                        ? "Частично"
                        : "Не оплачен"}
                  </span>
                  <small>
                    {i.received ? "Товар получен" : "Ожидается товар"}
                  </small>
                </td>
                <td>
                  <ChevronRight size={16} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="empty-inline">
        <Search size={26} />
        <h3>Счета не найдены</h3>
        <p>Измените фильтры или добавьте счёт.</p>
      </div>
    );
  const filters = (
    <div className="filters">
      <label className="search">
        <Search size={17} />
        <input
          aria-label="Поиск"
          placeholder={
            page === "materials"
              ? "Найти материал или артикул…"
              : "Найти счёт, поставщика, материал…"
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <select
        aria-label="Поставщик"
        value={supplier}
        onChange={(e) => setSupplier(e.target.value)}
      >
        <option value="">Все поставщики</option>
        {data.suppliers.map((s) => (
          <option value={s.id} key={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Категория"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        <option value="">Все категории</option>
        {categories.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      {page === "invoices" && (
        <select
          aria-label="Статус"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Все статусы</option>
          {Object.entries(labels).map(([s, l]) => (
            <option value={s} key={s}>
              {l}
            </option>
          ))}
        </select>
      )}
    </div>
  );
  if (!ready && !api.isDemo)
    return (
      <div className="login">
        <div className="brand-mark">
          <Leaf />
        </div>
        <h1>Закупки лаборатории</h1>
        <p>Войдите в учётную запись Дентум</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act(async () => {
              const { error } = await api.supabase!.auth.signInWithPassword({
                email: String(f.get("email")).trim(),
                password: String(f.get("password")),
              });
              if (error) throw Error(loginError(error));
            });
          }}
        >
          <label>
            Электронная почта
            <input type="email" name="email" required autoComplete="email" />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Входим…" : "Войти"} <ArrowRight size={16} />
          </button>
        </form>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <small>Доступ выдаёт администратор лаборатории.</small>
      </div>
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          href="#/overview"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-mark">
            <Leaf size={21} />
          </span>
          <span>
            дентум<span className="brand-sub">ЛАБОРАТОРИЯ</span>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-dot" />
          <div>
            Учёт закупок<small>Рабочее пространство</small>
          </div>
        </div>
        <div className="nav-label">УЧЁТ</div>
        <nav>
          {pages.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              className={page === id ? "active" : ""}
              href={"#/" + id}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "review" && pending > 0 && <b>{pending}</b>}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="storage-note">
            <span className="status-dot" />
            {api.isDemo
              ? "Локальный деморежим"
              : online
                ? "Подключено к Supabase"
                : "Нет связи"}
            <small>
              {api.isDemo
                ? "Данные только в этом браузере"
                : "Общая база лаборатории"}
            </small>
          </div>
          <a
            className={"settings-nav " + (page === "settings" ? "active" : "")}
            href="#/settings"
            aria-current={page === "settings" ? "page" : undefined}
          >
            <Settings size={19} />
            Настройки
          </a>
          <div className="user">
            <span className="user-avatar">ДЛ</span>
            <div>
              {api.isDemo ? "Демо-лаборатория" : "Лаборатория Дентум"}
              <small>{session?.user.email || "Локальное пространство"}</small>
            </div>
            {session && (
              <button
                aria-label="Выйти"
                className="icon-button"
                onClick={() =>
                  void act(async () => {
                    await api.signOut();
                    setData(emptyData());
                    setSession(null);
                  })
                }
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <span>
            Лаборатория <ChevronRight size={13} />
            <b>{pages.find((p) => p.id === page)?.label || "Настройки"}</b>
          </span>
          <div>
            {api.isDemo && <span className="demo-tag">ДЕМО</span>}
            <button
              className="icon-button mobile-settings"
              aria-label="Настройки приложения"
              onClick={() => navigate("settings")}
            >
              <Settings size={17} />
            </button>
            <span className="top-date">
              {new Date().toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
            <button
              className="icon-button"
              aria-label="Обновить данные"
              onClick={() => void refresh()}
              disabled={loading || !online}
            >
              <RefreshCw size={17} className={loading ? "spin" : ""} />
            </button>
          </div>
        </header>
        <main>
          {!online && (
            <div className="banner">
              <WifiOff size={18} />
              <span>
                Нет связи. Сохранённые данные:{" "}
                {new Date(data.synced_at).toLocaleString("ru-RU")}. Изменения
                недоступны.
              </span>
            </div>
          )}
          {error && (
            <div className="banner error" role="alert">
              <span>{error}</span>
              <button
                aria-label="Закрыть ошибку"
                className="icon-button"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">ЗАКУПКИ ЛАБОРАТОРИИ</div>
              <h1>
                {page === "overview"
                  ? "Обзор закупок"
                  : pages.find((p) => p.id === page)?.label || "Настройки"}
              </h1>
              <p>
                {
                  {
                    overview: "Расходы, счета и материалы — в одном месте.",
                    invoices: "Все закупки и их текущий статус.",
                    materials:
                      "Справочник материалов и история закупочных цен.",
                    suppliers: "Поставщики лаборатории и объём закупок.",
                    review: "Проверьте данные перед включением в отчёты.",
                    settings: "Подключения, данные и журнал изменений.",
                  }[page]
                }
              </p>
            </div>
            <div className="heading-actions">
              {page === "suppliers" ? (
                <button
                  className="primary"
                  disabled={!online}
                  onClick={() => setShowSupplier(true)}
                >
                  <Plus size={17} />
                  Поставщик
                </button>
              ) : (
                page !== "settings" && (
                  <>
                    <button
                      className="secondary"
                      disabled={!online}
                      onClick={() => setEditing(blankInvoice())}
                    >
                      <Plus size={17} />
                      Новый счёт
                    </button>
                    <button
                      className="primary"
                      disabled={!online}
                      onClick={() => setShowUpload(true)}
                    >
                      <Upload size={17} />
                      Загрузить счёт
                    </button>
                  </>
                )
              )}
            </div>
          </div>
          {(page === "overview" || page === "invoices") && (
            <div className="period-row">
              <div className="tabs">
                {[
                  ["month", "Этот месяц"],
                  ["quarter", "Квартал"],
                  ["year", "Год"],
                  ["all", "Всё время"],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    className={period === v ? "selected" : ""}
                    onClick={() => setPeriod(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <span className="muted period-note">
                {start
                  ? `${formatDate(start)} — ${formatDate(today())}`
                  : "За всё время"}
              </span>
            </div>
          )}
          {page === "overview" && (
            <>
              {start && !filtered.length && data.invoices.length > 0 && (
                <div className="review-info">
                  <p>
                    За выбранный период счетов нет. В базе есть счета за другие
                    даты.
                  </p>
                  <button
                    onClick={() => {
                      setPeriod("all");
                      setSearch("");
                      setSupplier("");
                      setCategory("");
                      setStatus("");
                    }}
                  >
                    Показать все счета
                  </button>
                </div>
              )}
              {!data.invoices.length ? (
                <section className="welcome panel">
                  <div className="welcome-icon">
                    <ReceiptText size={40} />
                  </div>
                  <h2>Начните с первого счёта</h2>
                  <p>
                    Загрузите PDF или изображение, проверьте строки
                    <br />и подтвердите закупку. Здесь появятся ваши расходы.
                  </p>
                  <button
                    className="primary"
                    disabled={!online}
                    onClick={() => setShowUpload(true)}
                  >
                    <Upload size={17} />
                    Загрузить счёт
                  </button>
                  {api.isDemo && (
                    <button
                      className="text-button"
                      onClick={() =>
                        void act(async () => {
                          setData(await api.demoReset(true));
                          setNotice("Загружены демонстрационные данные");
                        })
                      }
                    >
                      Посмотреть на примере <ArrowRight size={16} />
                    </button>
                  )}
                  <div className="welcome-steps">
                    <span>
                      <b>01</b> Загрузите документ
                    </span>
                    <span>
                      <b>02</b> Проверьте строки
                    </span>
                    <span>
                      <b>03</b> Подтвердите счёт
                    </span>
                  </div>
                </section>
              ) : (
                <>
                  {filters}
                  <div className="metrics">
                    <section className="metric featured">
                      <div>
                        Подтверждённые закупки <ReceiptText size={17} />
                      </div>
                      <strong>{money(sum)}</strong>
                      <small>{confirmed.length} счетов за период</small>
                    </section>
                    <section className="metric">
                      <div>
                        Оплачено <CheckCheck size={18} />
                      </div>
                      <strong>{money(paid)}</strong>
                      <small>Осталось оплатить {money(sum - paid)}</small>
                    </section>
                    <section className="metric">
                      <div>
                        Товар получен <Boxes size={18} />
                      </div>
                      <strong>
                        {confirmed.filter((i) => i.received).length}
                        <em> / {confirmed.length} счетов</em>
                      </strong>
                      <small>По отметкам о получении</small>
                    </section>
                    <section className="metric">
                      <div>
                        Ожидают проверки <ScanLine size={18} />
                      </div>
                      <strong>
                        {
                          data.invoices.filter((i) => i.status === "review")
                            .length
                        }
                        <em> счетов</em>
                      </strong>
                      <button
                        className="text-button"
                        onClick={() => navigate("review")}
                      >
                        Перейти к проверке <ArrowUpRight size={15} />
                      </button>
                    </section>
                  </div>
                  <div className="charts">
                    <section className="panel chart-panel">
                      <div className="section-heading">
                        <div>
                          <h2>Динамика закупок</h2>
                          <p>Подтверждённые счета · последние 6 месяцев</p>
                        </div>
                        <span className="chart-legend">
                          <i />
                          Сумма закупок
                        </span>
                      </div>
                      <MonthChart
                        invoices={data.invoices.filter(
                          (i) =>
                            i.status === "confirmed" &&
                            (!supplier || i.supplier_id === supplier) &&
                            (!category ||
                              i.lines.some((l) => l.category === category)),
                        )}
                      />
                    </section>
                    <section className="panel category-panel">
                      <div className="section-heading">
                        <h2>По категориям</h2>
                        <SlidersHorizontal size={16} />
                      </div>
                      <CategoryChart invoices={confirmed} />
                    </section>
                  </div>
                  {pending > 0 && (
                    <button
                      className="review-callout"
                      onClick={() => navigate("review")}
                    >
                      <span className="review-icon">
                        <ScanLine size={21} />
                      </span>
                      <span>
                        <strong>Есть документы для проверки</strong>
                        <small>
                          Проверьте строки и сопоставьте материалы со
                          справочником.
                        </small>
                      </span>
                      <span className="callout-action">
                        Открыть проверку <ArrowRight size={18} />
                      </span>
                    </button>
                  )}
                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <h2>Последние счета</h2>
                        <p>Закупки за выбранный период</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => navigate("invoices")}
                      >
                        Все счета <ArrowRight size={16} />
                      </button>
                    </div>
                    {table(filtered.slice(0, 5))}
                  </section>
                </>
              )}
            </>
          )}
          {page === "invoices" && (
            <>
              {filters}
              <section className="panel">
                <div className="section-heading">
                  <h2>
                    Счета <span className="count">{filtered.length}</span>
                  </h2>
                  <div className="inline">
                    <select
                      aria-label="Сортировка"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="date">Сначала новые</option>
                      <option value="sum">По сумме</option>
                    </select>
                    <button
                      className="secondary"
                      onClick={() => download(csv(data, filtered), "Счета.csv")}
                    >
                      <ArrowDownToLine size={16} />
                      CSV
                    </button>
                  </div>
                </div>
                {table(filtered)}
                <div className="table-footer">
                  Подтверждено: {money(sum)}{" "}
                  <span>Непроверенные счета не включены в сумму</span>
                </div>
              </section>
            </>
          )}
          {page === "materials" && (
            <>
              {filters}
              <section className="panel">
                <div className="section-heading">
                  <h2>
                    Справочник{" "}
                    <span className="count">{data.materials.length}</span>
                  </h2>
                  <span className="muted">
                    Карточки создаются при подтверждении счетов
                  </span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Материал</th>
                        <th>Категория</th>
                        <th>Фасовка</th>
                        <th>Последняя цена за баз. ед.</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.materials
                        .filter(
                          (m) =>
                            (!category || m.category === category) &&
                            (!search ||
                              [m.name, m.sku, m.manufacturer]
                                .join(" ")
                                .toLowerCase()
                                .includes(search.toLowerCase())) &&
                            (!supplier ||
                              data.invoices.some(
                                (i) =>
                                  i.supplier_id === supplier &&
                                  i.lines.some((l) => l.material_id === m.id),
                              )),
                        )
                        .map((m) => {
                          const l = data.invoices
                            .filter((i) => i.status === "confirmed")
                            .sort((a, b) => b.date.localeCompare(a.date))
                            .flatMap((i) => i.lines)
                            .find((l) => l.material_id === m.id);
                          return (
                            <tr
                              key={m.id}
                              onClick={() => setMaterial({ ...m })}
                            >
                              <td>
                                <button
                                  className="row-link"
                                  onClick={() => setMaterial({ ...m })}
                                >
                                  {m.name}
                                </button>
                                <small>
                                  {m.manufacturer || "Производитель не указан"}
                                  {m.sku && ` · ${m.sku}`}
                                </small>
                              </td>
                              <td>{m.category}</td>
                              <td>{m.pack || "Не указана"}</td>
                              <td className="numeric">
                                {l?.factor
                                  ? `${money(Math.round(l.unit_price / Number(l.factor)))} / ${m.unit}`
                                  : "Нет коэффициента"}
                              </td>
                              <td>
                                <ChevronRight size={16} />
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                {!data.materials.length && (
                  <div className="empty-inline">
                    <Boxes />
                    <h3>Справочник пока пуст</h3>
                    <p>Добавьте и подтвердите первый счёт.</p>
                  </div>
                )}
              </section>
            </>
          )}
          {page === "suppliers" && (
            <>
              <label className="search standalone">
                <Search size={17} />
                <input
                  aria-label="Поиск поставщика"
                  placeholder="Найти поставщика…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="supplier-grid">
                {data.suppliers
                  .filter((s) =>
                    s.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((s) => {
                    const invoices = data.invoices.filter(
                      (i) => i.supplier_id === s.id && i.status === "confirmed",
                    );
                    return (
                      <button
                        className="panel supplier-card"
                        key={s.id}
                        onClick={() => {
                          navigate("invoices");
                          setPeriod("all");
                          setSupplier(s.id);
                        }}
                      >
                        <span className="supplier-avatar large">
                          {s.name.slice(0, 1)}
                        </span>
                        <ArrowUpRight className="card-arrow" size={18} />
                        <h2>{s.name}</h2>
                        <p>{s.inn ? `ИНН ${s.inn}` : "ИНН не указан"}</p>
                        <div>
                          <strong>
                            {money(invoices.reduce((v, i) => v + total(i), 0))}
                          </strong>
                          <small>{invoices.length} подтверждённых счетов</small>
                        </div>
                      </button>
                    );
                  })}
              </div>
              {!data.suppliers.length && (
                <div className="empty-inline">
                  <Building2 />
                  <h3>Добавьте первого поставщика</h3>
                </div>
              )}
            </>
          )}
          {page === "review" && (
            <>
              <div className="review-info">
                <ScanLine size={19} />
                <p>
                  Сверьте цены после скидок, фасовку и НДС с оригиналом.
                  Подтверждённый счёт попадёт в отчёты.
                </p>
              </div>
              <section className="panel">
                <div className="section-heading">
                  <h2>
                    Требуют проверки{" "}
                    <span className="count">
                      {
                        data.invoices.filter((i) => i.status === "review")
                          .length
                      }
                    </span>
                  </h2>
                </div>
                {table(data.invoices.filter((i) => i.status === "review"))}
              </section>
              <section className="panel queue">
                <div className="section-heading">
                  <h2>Очередь документов</h2>
                  <button
                    className="text-button"
                    onClick={() => void refresh()}
                    disabled={!online}
                  >
                    <RefreshCw size={15} />
                    Обновить
                  </button>
                </div>
                {data.documents.length ? (
                  data.documents.map((d) => (
                    <div className="queue-row" key={d.id}>
                      <FileText />
                      <div>
                        <strong>{d.name}</strong>
                        <small>
                          {d.source === "telegram"
                            ? "Telegram"
                            : "Загрузка с сайта"}{" "}
                          · {new Date(d.created_at).toLocaleString("ru-RU")} ·{" "}
                          {d.archive_status === "saved"
                            ? "Оригинал сохранён"
                            : "Архивирование ожидается"}
                        </small>
                        {d.error && <p className="error-text">{d.error}</p>}
                      </div>
                      <Badge status={d.status} />
                      {d.status === "error" && (
                        <button
                          className="secondary"
                          disabled={!online || busy}
                          onClick={() =>
                            void act(async () => {
                              await api.retry(d.id);
                              await refresh();
                            })
                          }
                        >
                          Повторить
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="empty-inline compact">
                    <Clock size={23} />
                    <p>В очереди нет документов</p>
                  </div>
                )}
              </section>
            </>
          )}
          {page === "settings" && (
            <div className="settings-grid">
              {!api.isDemo && <AccountSettings />}
              <section className="panel settings-panel">
                <h2>Подключения</h2>
                <div className="setting-row">
                  <div>
                    <strong>Общая база Supabase</strong>
                    <small>
                      {api.isDemo
                        ? "Не подключена. Работает локальный деморежим."
                        : "Подключена. Доступ ограничен участниками лаборатории."}
                    </small>
                  </div>
                  <span
                    className={"badge " + (api.isDemo ? "review" : "confirmed")}
                  >
                    {api.isDemo ? "Не настроена" : "Подключена"}
                  </span>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Telegram и распознавание</strong>
                    <small>
                      Настраиваются на сервере. Токены не вводятся в браузере.
                    </small>
                  </div>
                </div>
                <p className="muted">
                  Инструкция по подключению: procurement/README.md
                </p>
                <h3>Данные</h3>
                <p className="muted">
                  CSV содержит строки счетов. Для восстановления нужны резервная
                  копия PostgreSQL и отдельная настройка Auth.
                </p>
                <button
                  className="secondary"
                  onClick={() =>
                    download(csv(data, data.invoices), "Все-счета.csv")
                  }
                >
                  <ArrowDownToLine size={16} />
                  Выгрузить счета в CSV
                </button>
                {api.isDemo && (
                  <div className="demo-actions">
                    <h3>Демонстрационный режим</h3>
                    <p className="muted">
                      Примеры вымышлены. Изменения сохраняются в этом браузере.
                    </p>
                    <button
                      className="secondary"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Заменить текущие демонстрационные данные примерами?",
                          )
                        )
                          void act(async () =>
                            setData(await api.demoReset(true)),
                          );
                      }}
                    >
                      Загрузить примеры
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Удалить все локальные демонстрационные данные?",
                          )
                        )
                          void act(async () =>
                            setData(await api.demoReset(false)),
                          );
                      }}
                    >
                      Очистить демоданные
                    </button>
                  </div>
                )}
              </section>
              <section className="panel settings-panel">
                <h2>Журнал изменений</h2>
                {data.audit.length ? (
                  data.audit.slice(0, 30).map((a) => (
                    <details className="audit-row" key={a.id}>
                      <summary>
                        {a.action}
                        <small>
                          {new Date(a.created_at).toLocaleString("ru-RU")}
                        </small>
                      </summary>
                      <AuditDetails
                        before={a.before}
                        after={a.after}
                        data={data}
                      />
                      {a.action === "Связи материалов и фасовка изменены" &&
                        !data.audit.some(
                          (x) =>
                            x.action === "Связи восстановлены" &&
                            x.entity_id === a.id,
                        ) && (
                          <button
                            className="secondary"
                            disabled={!online || busy}
                            onClick={() =>
                              void act(async () => {
                                setData(await api.undoMove(data, a.id));
                                setNotice("Связи восстановлены");
                              })
                            }
                          >
                            Восстановить связи
                          </button>
                        )}
                    </details>
                  ))
                ) : (
                  <p className="muted">Изменений пока нет</p>
                )}
              </section>
            </div>
          )}
          <footer className="page-footer">
            <span>Дентум · Учёт закупок</span>
            <span>
              {api.isDemo
                ? "Демонстрационные данные хранятся локально"
                : `Обновлено ${new Date(data.synced_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`}
            </span>
          </footer>
        </main>
      </div>
      {editing && (
        <Modal
          error={error}
          title={editing.version ? `Счёт № ${editing.number}` : "Новый счёт"}
          close={() => {
            setEditing(null);
            setOriginalUrl("");
          }}
          wide
        >
          <InvoiceEditor
            onDecline={() =>
              void act(async () => {
                setData(await api.declineInvoice(data, editing));
                setEditing(null);
                setNotice("Счёт отклонён. Оригинал сохранён в архиве");
              })
            }
            onArchive={() =>
              void act(async () => {
                setData(await api.archiveInvoice(data, editing));
                setEditing(null);
                setNotice("Счёт архивирован и исключён из отчётов");
              })
            }
            invoice={editing}
            data={data}
            busy={busy}
            disabled={!online}
            originalUrl={originalUrl}
            onOriginal={() =>
              void act(async () => {
                if (!editing.document_id)
                  throw Error("У этого счёта нет прикреплённого оригинала");
                setOriginalUrl(await api.original(editing.document_id));
              })
            }
            onSave={(i, confirm) =>
              void act(async () => {
                setData(await api.saveInvoice(data, i, confirm));
                setEditing(null);
                setNotice(
                  confirm
                    ? "Счёт подтверждён и включён в отчёты"
                    : "Изменения сохранены",
                );
              })
            }
          />
        </Modal>
      )}
      {material && (
        <Modal
          error={error}
          title="Карточка материала"
          close={() => setMaterial(null)}
          wide
        >
          <MaterialEditor
            onMove={(target, name, lines, factor) =>
              void act(async () => {
                setData(
                  await api.moveLines(
                    data,
                    material,
                    target,
                    name,
                    lines,
                    factor,
                  ),
                );
                setMaterial(null);
                setNotice("Связи обновлены. Отмена доступна в журнале.");
              })
            }
            material={material}
            data={data}
            busy={busy}
            disabled={!online}
            onSave={(m) =>
              void act(async () => {
                setData(await api.saveMaterial(data, m));
                setMaterial(null);
                setNotice("Материал сохранён");
              })
            }
          />
        </Modal>
      )}
      {showSupplier && (
        <Modal
          error={error}
          title="Новый поставщик"
          close={() => setShowSupplier(false)}
        >
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(async () => {
                setData(
                  await api.addSupplier(
                    data,
                    String(f.get("name")).trim(),
                    String(f.get("inn")).trim(),
                  ),
                );
                setShowSupplier(false);
                setNotice("Поставщик добавлен");
              });
            }}
          >
            <label>
              Название
              <input name="name" required maxLength={200} />
            </label>
            <label>
              ИНН <span className="muted">необязательно</span>
              <input name="inn" pattern="([0-9]{10}|[0-9]{12})?" />
            </label>
            <button className="primary" disabled={busy}>
              Добавить поставщика
            </button>
          </form>
        </Modal>
      )}
      {showUpload && (
        <Modal
          error={error}
          title="Загрузить счёт"
          close={() => setShowUpload(false)}
        >
          <div className="modal-form">
            {api.isDemo ? (
              <>
                <div className="review-info">
                  <FileText />
                  <p>
                    Для загрузки и распознавания нужны Supabase, Telegram и
                    обработчик. Сейчас открыт локальный деморежим.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setShowUpload(false);
                    setEditing(blankInvoice());
                  }}
                >
                  Создать счёт вручную <ArrowRight size={17} />
                </button>
              </>
            ) : (
              <>
                <label
                  className="dropzone"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file)
                      void act(async () => {
                        await api.upload(file);
                        await refresh();
                        setShowUpload(false);
                        setNotice("Документ принят в очередь");
                      });
                  }}
                >
                  <Upload size={30} />
                  <strong>Выберите файл или перетащите сюда</strong>
                  <span>PDF, JPG, PNG · до 20 МБ</span>
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        void act(async () => {
                          await api.upload(f);
                          await refresh();
                          setShowUpload(false);
                          setNotice("Документ принят в очередь");
                        });
                    }}
                  />
                </label>
                <p className="muted">
                  Оригинал будет отправлен в закрытый Telegram-архив.
                  Распознавание начнётся, когда обработчик будет доступен.
                </p>
              </>
            )}
          </div>
        </Modal>
      )}
      {updateAvailable && (
        <div role="status" className="toast">
          Доступна новая версия. Сохраните изменения.
          <button className="secondary" onClick={() => location.reload()}>
            Обновить сайт
          </button>
        </div>
      )}
      {!updateAvailable && notice && (
        <div role="status" className="toast">
          <Check size={18} />
          {notice}
        </div>
      )}
      {busy && (
        <div className="busy-indicator" role="status">
          Сохранение…
        </div>
      )}
    </div>
  );
}
function AuditDetails({
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
            (l.factor || "неизвестна") +
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
function MonthChart({ invoices }: { invoices: Invoice[] }) {
  const months = Array.from({ length: 6 }, (_, n) => {
    const d = new Date(
        new Date().getFullYear(),
        new Date().getMonth() - 5 + n,
        1,
        12,
      ),
      key = d.toLocaleDateString("sv-SE").slice(0, 7);
    return {
      label: d.toLocaleDateString("ru-RU", { month: "short" }).replace(".", ""),
      sum: invoices
        .filter((i) => i.date.startsWith(key))
        .reduce((s, i) => s + total(i), 0),
    };
  });
  const max = Math.max(...months.map((m) => m.sum), 100);
  return (
    <div className="bar-chart">
      <div className="chart-axis">
        {[1, 0.75, 0.5, 0.25, 0].map((v) => (
          <span key={v}>{Math.round((max * v) / 100000)} тыс.</span>
        ))}
      </div>
      <div className="bar-area">
        <div className="grid-lines">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        {months.map((m, n) => (
          <div className="bar-column" key={m.label}>
            <div className="bar-space">
              <div
                className={"bar " + (n === 5 ? "current" : "")}
                style={{
                  height: `${Math.max((m.sum / max) * 100, m.sum ? 2 : 0)}%`,
                }}
                title={`${m.label}: ${money(m.sum)}`}
              >
                <span>{money(m.sum)}</span>
              </div>
            </div>
            <span>{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function CategoryChart({ invoices }: { invoices: Invoice[] }) {
  const map: Record<string, number> = {};
  invoices.forEach((i) => {
    i.lines.forEach(
      (l) => (map[l.category] = (map[l.category] || 0) + l.total),
    );
    if (i.delivery) map["Доставка"] = (map["Доставка"] || 0) + i.delivery;
  });
  const all = Object.values(map).reduce((s, v) => s + v, 0);
  return (
    <div className="category-list">
      {Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .map(([name, v], n) => (
          <div key={name}>
            <div>
              <span>
                <i
                  style={{
                    background: [
                      "#2f6456",
                      "#8caa8c",
                      "#bfbaa2",
                      "#d4ae7d",
                      "#b8c8cc",
                    ][n % 5],
                  }}
                />
                {name}
              </span>
              <strong>{money(v)}</strong>
            </div>
            <div className="category-track">
              <i
                style={{
                  width: `${all ? (v / all) * 100 : 0}%`,
                  background: [
                    "#2f6456",
                    "#8caa8c",
                    "#bfbaa2",
                    "#d4ae7d",
                    "#b8c8cc",
                  ][n % 5],
                }}
              />
            </div>
          </div>
        ))}
      {!all && <p className="muted">Нет подтверждённых закупок за период</p>}
      <small>Суммы строк после скидок. Доставка отдельно.</small>
    </div>
  );
}
function InvoiceEditor({
  invoice,
  data,
  onSave,
  busy,
  disabled,
  onOriginal,
  originalUrl,
  onArchive,
  onDecline,
}: {
  invoice: Invoice;
  data: Data;
  onSave: (i: Invoice, c: boolean) => void;
  busy: boolean;
  disabled: boolean;
  onOriginal: () => void;
  onArchive: () => void;
  onDecline: () => void;
  originalUrl: string;
}) {
  const [i, set] = useState(invoice),
    [error, setError] = useState("");
  const patch = (p: Partial<Invoice>) => {
    const next = { ...i, ...p };
    next.paid = (p.paid !== undefined ? p.paid > 0 : i.paid > 0)
      ? total(next)
      : 0;
    set(next);
  };
  const update = (id: string, p: Partial<Line>) => {
    try {
      patch({
        lines: i.lines.map((l) => {
          if (l.id !== id) return l;
          const next = { ...l, ...p };
          next.total = lineTotal(next.quantity, next.unit_price);
          return next;
        }),
      });
      setError("");
    } catch {
      setError(
        "Проверьте числовые значения. Количество — до 3 знаков после запятой.",
      );
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(i, true);
      }}
    >
      <div className="editor-body">
        <div className="invoice-fields">
          <label>
            Номер счёта
            <input
              required
              value={i.number}
              disabled={disabled}
              onChange={(e) => patch({ number: e.target.value })}
            />
          </label>
          <label>
            Дата
            <input
              type="date"
              required
              value={i.date}
              disabled={disabled}
              onChange={(e) => patch({ date: e.target.value })}
            />
          </label>
          <label>
            Поставщик
            <select
              required
              value={i.supplier_id}
              disabled={disabled}
              onChange={(e) => patch({ supplier_id: e.target.value })}
            >
              <option value="">Выберите поставщика</option>
              {data.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            НДС
            <select
              value={i.vat}
              disabled={disabled}
              onChange={(e) => patch({ vat: e.target.value })}
            >
              {[
                "Не указан",
                "Включён в цену",
                "Без НДС",
                "НДС сверху — включён в строки",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>
        {!data.suppliers.length && (
          <p className="error-text">
            Сначала добавьте поставщика в разделе «Поставщики».
          </p>
        )}
        <div className="original-toolbar">
          {i.version > 0 &&
            i.status !== "archived" &&
            i.status !== "declined" && (
              <button
                type="button"
                className="text-button"
                disabled={busy || disabled}
                onClick={onArchive}
              >
                Архивировать счёт
              </button>
            )}
          <Badge status={i.status} />
          <button
            type="button"
            className="text-button"
            disabled={!i.document_id}
            onClick={onOriginal}
          >
            <ExternalLink size={16} />
            {i.document_id ? "Открыть оригинал" : "Оригинал не прикреплён"}
          </button>
        </div>
        <div className={originalUrl ? "split-review" : ""}>
          {originalUrl && <iframe title="Оригинал счёта" src={originalUrl} />}
          <div>
            <div className="table-scroll line-table">
              <table>
                <thead>
                  <tr>
                    <th>Наименование / материал</th>
                    <th>Кол-во</th>
                    <th>Цена после скидки, ₽</th>
                    <th>Сумма</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {i.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <input
                          aria-label="Название строки"
                          value={l.name}
                          required
                          disabled={disabled}
                          onChange={(e) =>
                            update(l.id, { name: e.target.value })
                          }
                        />
                        <select
                          aria-label="Материал из справочника"
                          value={l.material_id || ""}
                          disabled={disabled}
                          onChange={(e) => {
                            const m = data.materials.find(
                              (m) => m.id === e.target.value,
                            );
                            update(l.id, {
                              material_id: m?.id || null,
                              category: m?.category || l.category,
                            });
                          }}
                        >
                          <option value="">+ Создать новый материал</option>
                          {data.materials.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <div className="line-meta">
                          <label>
                            Категория
                            <input
                              value={l.category}
                              disabled={disabled}
                              onChange={(e) =>
                                update(l.id, { category: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            Баз. ед. в упаковке
                            <input
                              aria-label="Коэффициент фасовки"
                              placeholder="Неизвестно"
                              inputMode="decimal"
                              value={l.factor}
                              disabled={disabled}
                              onChange={(e) =>
                                update(l.id, { factor: e.target.value })
                              }
                            />
                          </label>
                          {!l.material_id && (
                            <label>
                              Базовая ед.
                              <input
                                placeholder="кг, л, шт."
                                value={l.base_unit || ""}
                                disabled={disabled}
                                onChange={(e) =>
                                  update(l.id, { base_unit: e.target.value })
                                }
                              />
                            </label>
                          )}
                          <label>
                            Ед. счёта
                            <input
                              aria-label="Единица строки"
                              value={l.unit}
                              disabled={disabled}
                              onChange={(e) =>
                                update(l.id, { unit: e.target.value })
                              }
                            />
                          </label>
                        </div>
                      </td>
                      <td>
                        <input
                          aria-label="Количество"
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={l.quantity}
                          required
                          disabled={disabled}
                          onChange={(e) =>
                            update(l.id, { quantity: e.target.value || "0" })
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label="Цена"
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.unit_price / 100}
                          required
                          disabled={disabled}
                          onChange={(e) => {
                            try {
                              update(l.id, {
                                unit_price: cents(e.target.value || "0"),
                              });
                            } catch {
                              setError(
                                "Цена должна содержать не больше двух знаков после запятой",
                              );
                            }
                          }}
                        />
                      </td>
                      <td className="numeric">{money(l.total)}</td>
                      <td>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Удалить строку"
                          disabled={disabled || i.lines.length === 1}
                          onClick={() =>
                            patch({
                              lines: i.lines.filter((v) => v.id !== l.id),
                            })
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="text-button add-line"
              disabled={disabled}
              onClick={() => patch({ lines: [...i.lines, blankLine()] })}
            >
              <Plus size={16} />
              Добавить строку
            </button>
          </div>
        </div>
        <div className="invoice-fields bottom-fields">
          <label>
            Скидка, ₽ (уже учтена в ценах)
            <input
              type="number"
              min="0"
              step="0.01"
              value={(i.discount || 0) / 100}
              disabled={disabled}
              onChange={(e) => {
                try {
                  patch({ discount: cents(e.target.value || "0") });
                } catch {
                  setError("Проверьте сумму скидки");
                }
              }}
            />
          </label>
          <label>
            Доставка, ₽
            <input
              type="number"
              min="0"
              step="0.01"
              value={i.delivery / 100}
              disabled={disabled}
              onChange={(e) => {
                try {
                  patch({ delivery: cents(e.target.value || "0") });
                } catch {
                  setError("Проверьте сумму доставки");
                }
              }}
            />
          </label>
          <label>
            Площадка
            <input
              placeholder="Например, Ozon"
              value={i.marketplace}
              disabled={disabled}
              onChange={(e) => patch({ marketplace: e.target.value })}
            />
          </label>
          <label>
            Фактический продавец
            <input
              placeholder="Неизвестен"
              value={i.seller}
              disabled={disabled}
              onChange={(e) => patch({ seller: e.target.value })}
            />
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={i.paid > 0}
            disabled={disabled}
            onChange={(e) => patch({ paid: e.target.checked ? total(i) : 0 })}
          />
          Оплачено
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={i.received}
            disabled={disabled}
            onChange={(e) => patch({ received: e.target.checked })}
          />
          Товар получен
        </label>
        <label>
          Примечание
          <textarea
            rows={2}
            value={i.note}
            disabled={disabled}
            onChange={(e) => patch({ note: e.target.value })}
          />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <div>
          <span className="muted">Итого по счёту</span>
          <strong>{money(total(i))}</strong>
        </div>
        <div className="inline">
          <button
            type="button"
            className="secondary"
            disabled={busy || disabled || i.status === "declined"}
            onClick={() => onSave(i, false)}
          >
            Сохранить
          </button>
          {i.version > 0 &&
            i.status !== "declined" &&
            i.status !== "archived" && (
              <button
                type="button"
                className="secondary"
                disabled={busy || disabled}
                onClick={onDecline}
              >
                Отклонить счёт
              </button>
            )}
          <button
            className="primary"
            disabled={busy || disabled || i.status === "declined"}
          >
            <Check size={17} />
            {i.status === "confirmed"
              ? "Сохранить исправления"
              : "Подтвердить счёт"}
          </button>
        </div>
      </div>
    </form>
  );
}
function MaterialEditor({
  material,
  data,
  onSave,
  busy,
  disabled,
  onMove,
}: {
  onMove: (
    target: string,
    name: string,
    lines: string[],
    factor: string,
  ) => void;
  material: Material;
  data: Data;
  onSave: (m: Material) => void;
  busy: boolean;
  disabled: boolean;
}) {
  const [m, set] = useState(material),
    [selected, setSelected] = useState<string[]>([]),
    [target, setTarget] = useState(material.id),
    [newName, setNewName] = useState(""),
    [factor, setFactor] = useState("");
  const history = data.invoices
    .filter(
      (i) =>
        i.status === "confirmed" && i.lines.some((l) => l.material_id === m.id),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(m);
      }}
    >
      <div className="editor-body">
        <div className="material-fields">
          {(
            [
              ["name", "Название"],
              ["category", "Категория"],
              ["manufacturer", "Производитель"],
              ["sku", "Артикул"],
              ["unit", "Базовая единица"],
              ["pack", "Фасовка"],
              ["properties", "Характеристики"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                required={key === "name" || key === "unit"}
                value={m[key]}
                disabled={disabled}
                onChange={(e) => set({ ...m, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <p className="review-info">
          Изменение карточки не переписывает фасовку и исходные названия в
          старых счетах.
        </p>
        <h3>История закупок</h3>
        <p className="muted">
          Выберите строки для переноса в другую карточку или исправления
          фасовки.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Дата / счёт</th>
                <th>Исходное название</th>
                <th>Цена упаковки</th>
                <th>Цена за баз. ед.</th>
              </tr>
            </thead>
            <tbody>
              {history.flatMap((i) =>
                i.lines
                  .filter((l) => l.material_id === m.id)
                  .map((l) => (
                    <tr key={l.id}>
                      <td>
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={selected.includes(l.id)}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, l.id]
                                  : selected.filter((id) => id !== l.id),
                              )
                            }
                          />
                          {formatDate(i.date)}
                        </label>
                        <small>№ {i.number}</small>
                      </td>
                      <td>
                        {l.name}
                        <small>
                          {
                            data.suppliers.find((s) => s.id === i.supplier_id)
                              ?.name
                          }
                        </small>
                      </td>
                      <td>{money(l.unit_price)}</td>
                      <td>
                        {l.factor
                          ? `${money(Math.round(l.unit_price / Number(l.factor)))} / ${material.unit}`
                          : "Неизвестна"}
                      </td>
                    </tr>
                  )),
              )}
            </tbody>
          </table>
        </div>
        {selected.length > 0 && (
          <section className="move-panel">
            <h3>Изменить выбранные строки: {selected.length}</h3>
            <div className="material-fields">
              <label>
                Карточка материала
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Создать отдельную карточку</option>
                  {data.materials
                    .filter((x) => x.unit === material.unit)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </label>
              {!target && (
                <label>
                  Название новой карточки
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </label>
              )}
              <label>
                Новый коэффициент фасовки
                <input
                  placeholder="Оставить прежний"
                  value={factor}
                  onChange={(e) => setFactor(e.target.value)}
                />
              </label>
            </div>
            <p className="muted">
              Суммы закупок сохранятся.{" "}
              {factor && Number(factor) > 0
                ? "Цена за базовую единицу станет равна цене упаковки / " +
                  factor
                : "Историческая фасовка сохранится."}
            </p>
            {factor &&
              Number(factor) > 0 &&
              history.flatMap((i) =>
                i.lines
                  .filter((l) => selected.includes(l.id))
                  .map((l) => (
                    <p key={l.id} className="muted">
                      № {i.number}:{" "}
                      {l.factor
                        ? money(Math.round(l.unit_price / Number(l.factor)))
                        : "неизвестно"}{" "}
                      → {money(Math.round(l.unit_price / Number(factor)))} /{" "}
                      {material.unit}
                    </p>
                  )),
              )}
            <button
              className="secondary"
              type="button"
              disabled={busy || disabled || (!target && !newName.trim())}
              onClick={() => onMove(target, newName, selected, factor)}
            >
              Применить к выбранным строкам
            </button>
          </section>
        )}
      </div>
      <div className="modal-footer">
        <span className="muted">Изменения попадут в журнал</span>
        <button className="primary" disabled={busy || disabled}>
          Сохранить карточку
        </button>
      </div>
    </form>
  );
}

export default App;
