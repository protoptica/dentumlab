import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "./store";
type Member = { id: string; email: string; role: string; owner: boolean };
export default function AccountSettings() {
  const [members, setMembers] = useState<Member[]>([]),
    [owner, setOwner] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [reset, setReset] = useState<Member | null>(null),
    [show, setShow] = useState(false);
  async function call(body: object) {
    const { data, error } = await supabase!.functions.invoke("manage-users", {
      body,
    });
    if (error) {
      let text = "Не удалось выполнить действие";
      try {
        text = (await error.context.json()).error || text;
      } catch {}
      throw Error(text);
    }
    if (data.error) throw Error(data.error);
    return data;
  }
  async function refresh() {
    const data = await call({ action: "list" });
    setMembers(data.users);
    setOwner(true);
  }
  useEffect(() => {
    let active = true;
    call({ action: "capabilities" })
      .then(async (data) => {
        if (active && data.can_manage) await refresh();
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function act(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeOwn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    await act(async () => {
      if (f.get("password") !== f.get("repeat"))
        throw Error("Новые пароли не совпадают");
      const { data } = await supabase!.auth.getUser();
      if (!data.user?.email) throw Error("Войдите заново");
      const verified = await supabase!.auth.signInWithPassword({
        email: data.user.email,
        password: String(f.get("current")),
      });
      if (verified.error) throw Error("Текущий пароль неверен");
      const result = await supabase!.auth.updateUser({
        password: String(f.get("password")),
      });
      if (result.error)
        throw Error(
          "Не удалось сменить пароль. Используйте другой пароль от 8 символов.",
        );
      form.reset();
      setMessage("Ваш пароль изменён");
    });
  }
  return (
    <section className="panel settings-panel account-settings">
      <h2>Аккаунты и пароли</h2>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <h3>Мой пароль</h3>
      <form className="modal-form" onSubmit={changeOwn}>
        <label>
          Текущий пароль
          <input
            name="current"
            type="password"
            autoComplete="current-password"
            required
            disabled={busy}
          />
        </label>
        <label>
          Новый пароль
          <input
            name="password"
            type="password"
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            required
            disabled={busy}
          />
        </label>
        <label>
          Повторите новый пароль
          <input
            name="repeat"
            type="password"
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            required
            disabled={busy}
          />
        </label>
        <button disabled={busy} type="submit">
          Изменить мой пароль
        </button>
      </form>
      {owner && (
        <>
          <h3>Пользователи лаборатории</h3>
          <p className="muted">
            У вас права владельца: создание аккаунтов, роли, смена паролей и
            отключение доступа. Права владельца нельзя снять. Управление
            аккаунтами доступно только вам.
          </p>
          <div className="account-list">
            {members.map((m) => (
              <div key={m.id} className="account-row">
                <strong>{m.email}</strong>
                {m.owner ? (
                  <span>Владелец · полный доступ</span>
                ) : (
                  <>
                    <label>
                      Роль
                      <select
                        value={m.role}
                        disabled={busy}
                        onChange={(e) =>
                          void act(async () => {
                            await call({
                              action: "role",
                              user_id: m.id,
                              role: e.target.value,
                            });
                            await refresh();
                            setMessage("Роль изменена");
                          })
                        }
                      >
                        <option value="editor">Сотрудник</option>
                        <option value="admin">Администратор</option>
                      </select>
                    </label>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setReset(m);
                        setMessage("");
                      }}
                    >
                      Изменить пароль
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Отключить доступ ${m.email} к лаборатории?`,
                          )
                        )
                          void act(async () => {
                            await call({ action: "remove", user_id: m.id });
                            await refresh();
                            setMessage("Доступ отключён");
                          });
                      }}
                    >
                      Отключить доступ
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          {reset && (
            <form
              className="modal-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act(async () => {
                  await call({
                    action: "password",
                    user_id: reset.id,
                    password: String(f.get("password")),
                  });
                  setReset(null);
                  setMessage(
                    "Пароль изменён. Передайте новый пароль сотруднику лично.",
                  );
                });
              }}
            >
              <h3>Новый пароль для {reset.email}</h3>
              <input
                name="password"
                aria-label="Новый пароль сотрудника"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                disabled={busy}
              />
              <div className="actions">
                <button type="submit" disabled={busy}>
                  Сохранить пароль
                </button>
                <button type="button" onClick={() => setReset(null)}>
                  Отмена
                </button>
              </div>
            </form>
          )}
          <h3>Создать аккаунт</h3>
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              void act(async () => {
                await call({
                  action: "create",
                  email: String(f.get("email")),
                  password: String(f.get("password")),
                  role: String(f.get("role")),
                });
                form.reset();
                await refresh();
                setMessage(
                  "Аккаунт создан. Передайте сотруднику email и пароль; письмо автоматически не отправляется.",
                );
              });
            }}
          >
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="off"
                required
                disabled={busy}
              />
            </label>
            <label>
              Пароль — минимум 8 символов
              <input
                name="password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                disabled={busy}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={show}
                onChange={(e) => setShow(e.target.checked)}
              />
              Показать пароль
            </label>
            <label>
              Роль
              <select name="role" disabled={busy}>
                <option value="editor">Сотрудник</option>
                <option value="admin">Администратор</option>
              </select>
            </label>
            <button className="primary" type="submit" disabled={busy}>
              Создать аккаунт
            </button>
          </form>
        </>
      )}
    </section>
  );
}
