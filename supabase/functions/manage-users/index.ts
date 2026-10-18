import { cors, json, userClient } from "../_shared/common.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")
    return json({ error: "Метод не поддерживается" }, 405);
  try {
    const { db, user } = await userClient(req);
    const { data: membership } = await db
      .from("lab_member")
      .select("lab_id,role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    const owner = Deno.env.get("OWNER_USER_ID");
    const b = await req.json();
    if (b.action === "capabilities")
      return json({ can_manage: !!membership && !!owner && user.id === owner });
    if (!membership || !owner || user.id !== owner)
      return json(
        { error: "Управление аккаунтами доступно владельцу лаборатории" },
        403,
      );
    const audit = async (action: string, id: string, after: object) => {
      const { error } = await db.from("audit_event").insert({
        lab_id: membership.lab_id,
        user_id: user.id,
        action,
        entity_id: id,
        after,
      });
      if (error)
        throw Error(
          "Действие выполнено, но журнал недоступен. Обновите список.",
        );
    };
    if (b.action === "list") {
      const { data: members, error } = await db
        .from("lab_member")
        .select("user_id,role")
        .eq("lab_id", membership.lab_id);
      if (error) throw Error("Не удалось загрузить пользователей");
      const users = await Promise.all(
        (members || []).map(async (m) => {
          const { data, error } = await db.auth.admin.getUserById(m.user_id);
          if (error) throw Error("Не удалось загрузить пользователя");
          return {
            id: m.user_id,
            email: data.user.email,
            role: m.role,
            owner: m.user_id === owner,
          };
        }),
      );
      return json({ users, owner_id: owner });
    }
    if (b.action === "create") {
      const email = String(b.email || "")
          .trim()
          .toLowerCase(),
        password = String(b.password || "");
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        password.length < 12 ||
        password.length > 128
      )
        return json(
          { error: "Укажите email и пароль от 12 до 128 символов" },
          400,
        );
      if (!["admin", "editor"].includes(b.role))
        return json({ error: "Некорректная роль" }, 400);
      const { data, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error)
        return json(
          {
            error:
              "Не удалось создать аккаунт. Возможно, этот email уже зарегистрирован.",
          },
          400,
        );
      const added = await db.from("lab_member").insert({
        lab_id: membership.lab_id,
        user_id: data.user.id,
        role: b.role,
      });
      if (added.error) {
        await db.auth.admin.deleteUser(data.user.id);
        throw Error("Не удалось выдать доступ");
      }
      await audit("Создан аккаунт", data.user.id, { email, role: b.role });
      return json({ ok: true });
    }
    if (!["role", "remove", "password"].includes(b.action))
      return json({ error: "Неизвестное действие" }, 400);
    if (b.user_id === owner)
      return json(
        {
          error:
            "Права владельца защищены. Свой пароль меняйте в разделе «Мой пароль».",
        },
        400,
      );
    const { data: target } = await db
      .from("lab_member")
      .select("user_id")
      .eq("lab_id", membership.lab_id)
      .eq("user_id", b.user_id)
      .maybeSingle();
    if (!target)
      return json({ error: "Пользователь не найден в лаборатории" }, 404);
    if (b.action === "role") {
      if (!["admin", "editor"].includes(b.role))
        return json({ error: "Некорректная роль" }, 400);
      const { error } = await db
        .from("lab_member")
        .update({ role: b.role })
        .eq("lab_id", membership.lab_id)
        .eq("user_id", b.user_id);
      if (error) throw Error("Не удалось изменить роль");
      await audit("Изменена роль аккаунта", b.user_id, { role: b.role });
    } else if (b.action === "remove") {
      const { error } = await db
        .from("lab_member")
        .delete()
        .eq("lab_id", membership.lab_id)
        .eq("user_id", b.user_id);
      if (error) throw Error("Не удалось отключить доступ");
      await audit("Отключён доступ аккаунта", b.user_id, {});
    } else {
      const password = String(b.password || "");
      if (password.length < 12 || password.length > 128)
        return json(
          { error: "Пароль должен содержать от 12 до 128 символов" },
          400,
        );
      // Passwords are global to Auth: never reset an account shared with another lab.
      const { count, error } = await db
        .from("lab_member")
        .select("*", { count: "exact", head: true })
        .eq("user_id", b.user_id);
      if (error || count !== 1)
        return json(
          {
            error:
              "Нельзя менять пароль общего аккаунта нескольких лабораторий",
          },
          409,
        );
      const result = await db.auth.admin.updateUserById(b.user_id, {
        password,
      });
      if (result.error) throw Error("Не удалось изменить пароль");
      await audit("Изменён пароль аккаунта", b.user_id, {});
    }
    return json({ ok: true });
  } catch {
    return json(
      {
        error:
          "Не удалось выполнить действие. Проверьте вход и обновите страницу.",
      },
      400,
    );
  }
});
