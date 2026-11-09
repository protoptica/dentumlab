import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  accountMail,
  mailSender,
  appUrl,
} from "../supabase/functions/_shared/account-mail.ts";

// Exercise the actual Edge handler with fake Auth/DB/SMTP; no accounts or mail are created.
async function createAccount(
  options: {
    mail?: string;
    memberError?: boolean;
    auditError?: boolean;
    owner?: boolean;
  } = {},
) {
  let handler: (req: Request) => Promise<Response>;
  const calls: {
    mail: unknown[][];
    audit: unknown[];
    deleted: string[];
    created: number;
  } = {
    mail: [],
    audit: [],
    deleted: [],
    created: 0,
  };
  const db = {
    from(table: string) {
      if (table === "audit_event")
        return {
          insert: async (row: unknown) => {
            calls.audit.push(row);
            return { error: options.auditError };
          },
        };
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { lab_id: "lab", role: "admin" },
              }),
            }),
          }),
        }),
        insert: async () => ({ error: options.memberError }),
      };
    },
    auth: {
      admin: {
        createUser: async () => {
          calls.created++;
          return { data: { user: { id: "new-user" } }, error: null };
        },
        deleteUser: async (id: string) => {
          calls.deleted.push(id);
        },
      },
    },
  };
  const source = readFileSync(
    new URL("../supabase/functions/manage-users/index.ts", import.meta.url),
    "utf8",
  ).replace(/^import .*;\n/gm, "");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  new Function("Deno", "cors", "json", "userClient", "sendAccountMail", js)(
    {
      serve: (fn: typeof handler) => {
        handler = fn;
      },
      env: { get: () => "owner" },
    },
    {},
    (body: unknown, status = 200) => Response.json(body, { status }),
    async () => ({
      db,
      user: { id: options.owner === false ? "other-user" : "owner" },
    }),
    async (...args: unknown[]) => {
      calls.mail.push(args);
      return options.mail ?? "sent";
    },
  );
  const response = await handler!(
    new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify({
        action: "create",
        email: "Employee@example.com",
        password: "example-test-password",
        role: "editor",
      }),
    }),
  );
  return { status: response.status, body: await response.json(), calls };
}

test("account email preserves password characters in plain text", () => {
  const message = accountMail("employee@example.com", "<>&\"'пароль123");
  assert.equal(message.from.address, mailSender);
  assert.equal(message.to, "employee@example.com");
  assert.ok(message.text.includes(appUrl));
  assert.ok(message.text.includes("Пароль: <>&\"'пароль123"));
});

test("account creation sends credentials only after membership is granted and never audits passwords", async () => {
  const { status, body, calls } = await createAccount();
  assert.equal(status, 200);
  assert.equal(body.mail_status, "sent");
  assert.deepEqual(calls.mail, [
    ["employee@example.com", "example-test-password"],
  ]);
  assert.ok(!JSON.stringify(calls.audit).includes("example-test-password"));
  assert.ok(!JSON.stringify(body).includes("example-test-password"));
});

test("SMTP and audit failures preserve successful account creation", async () => {
  for (const mail of ["failed", "not_configured"]) {
    const { status, body, calls } = await createAccount({
      mail,
      auditError: true,
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.mail_status, mail);
    assert.equal(body.audit_recorded, false);
    assert.equal(calls.created, 1);
    assert.deepEqual(calls.deleted, []);
  }
});

test("failed membership and unauthorized callers cannot send account email", async () => {
  const failed = await createAccount({ memberError: true });
  assert.equal(failed.status, 400);
  assert.deepEqual(failed.calls.deleted, ["new-user"]);
  assert.deepEqual(failed.calls.mail, []);
  const forbidden = await createAccount({ owner: false });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.calls.created, 0);
  assert.deepEqual(forbidden.calls.mail, []);
});
