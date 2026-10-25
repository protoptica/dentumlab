import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const lab = "11111111-1111-1111-1111-111111111111",
  user = "22222222-2222-2222-2222-222222222222",
  other = "33333333-3333-3333-3333-333333333333",
  supplier = "44444444-4444-4444-4444-444444444444",
  inv = "55555555-5555-5555-5555-555555555555";
test("migrations, RLS, exact money, audit, optimistic locking, queue leases and webhook idempotency", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text,owner_id text,metadata jsonb);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`,
    );
    for (const file of [
      "001_core.sql",
      "002_processing.sql",
      "003_material_operations.sql",
      "004_telegram_commands.sql",
      "005_archive.sql",
      "006_telegram_interactions.sql",
      "007_invoice_presentation.sql",
      "008_payment_checkbox.sql",
      "009_declined_invoices.sql",
    ])
      await db.exec(
        (
          await readFile(
            new URL("../supabase/migrations/" + file, import.meta.url),
            "utf8",
          )
        ).replace("create extension if not exists pgcrypto;", ""),
      );
    await db.exec(
      `insert into auth.users values('${user}'),('${other}');insert into lab values('${lab}','Test');insert into lab_member values('${lab}','${user}','admin');insert into supplier(id,lab_id,name) values('${supplier}','${lab}','Test supplier');set role authenticated;set request.jwt.claim.sub='${other}';`,
    );
    assert.equal((await db.query("select * from supplier")).rows.length, 0);
    await assert.rejects(
      () => db.query("select app_snapshot($1)", [lab]),
      /Нет доступа/,
    );
    await assert.rejects(
      () => db.query("select claim_job('extract')"),
      /permission denied/,
    );
    await db.exec(`set request.jwt.claim.sub='${user}';`);
    const invoice = {
      id: inv,
      number: "A-1",
      date: "2026-10-17",
      supplier_id: supplier,
      version: 0,
      delivery: 5,
      discount: 100,
      vat: "Без НДС",
      paid: 0,
      received: false,
      lines: [
        {
          id: crypto.randomUUID(),
          name: "Материал",
          material_id: null,
          quantity: "0.125",
          unit: "шт.",
          unit_price: 100,
          total: 13,
          factor: "",
          category: "Тест",
          page: 1,
        },
      ],
    };
    await db.query("select save_invoice($1,$2,true)", [
      lab,
      JSON.stringify(invoice),
    ]);
    const snapshot = (
      await db.query<{ app_snapshot: any }>("select app_snapshot($1)", [lab])
    ).rows[0].app_snapshot;
    assert.equal(snapshot.invoices[0].lines[0].total, 13);
    assert.equal(snapshot.materials.length, 1);
    assert.equal(snapshot.audit.length, 1);
    const mid = snapshot.materials[0].id;
    const lineId = snapshot.invoices[0].lines[0].id;
    const moved = (
      await db.query<{ move_material_lines: string }>(
        "select move_material_lines($1,$2,null,$3,$4,$5,10)",
        [
          lab,
          mid,
          "Отдельная карточка",
          [lineId],
          JSON.stringify({ [inv]: 1 }),
        ],
      )
    ).rows[0].move_material_lines;
    assert.equal(
      (
        await db.query<any>(
          "select material_id from invoice_line where id=$1",
          [lineId],
        )
      ).rows[0].material_id === mid,
      false,
    );
    await db.query("select undo_material_move($1,$2)", [lab, moved]);
    assert.equal(
      (
        await db.query<any>(
          "select material_id from invoice_line where id=$1",
          [lineId],
        )
      ).rows[0].material_id,
      mid,
    );
    await assert.rejects(
      () => db.query("select undo_material_move($1,$2)", [lab, moved]),
      /уже отменена/,
    );

    await assert.rejects(
      () =>
        db.query("select save_invoice($1,$2,true)", [
          lab,
          JSON.stringify(invoice),
        ]),
      /уже изменён/,
    );
    await assert.rejects(
      () => db.query("update invoice set paid=0"),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.exec(`insert into telegram_user values(123,'${lab}','${user}');`);
    await db.query(
      "select ingest_telegram_command(100,123,123,'/find Материал','https://example.com')",
    );
    await db.query(
      "select ingest_telegram_command(100,123,123,'/find Материал','https://example.com')",
    );
    assert.equal(
      (await db.query("select * from job where kind='reply'")).rows.length,
      1,
    );
    for (let n = 0; n < 2; n++)
      await db.query(
        "select ingest_telegram(1,123,123,10,'file','unique','test.pdf',100)",
      );
    assert.equal((await db.query("select * from document")).rows.length, 1);
    const j = (
      await db.query<{ claim_job: any }>("select claim_job('archive')")
    ).rows[0].claim_job;
    assert.ok(j.lease_token);
    assert.equal(
      (await db.query<{ claim_job: any }>("select claim_job('archive')"))
        .rows[0].claim_job,
      null,
    );
    assert.equal(
      (
        await db.query<{ finish_job: boolean }>("select finish_job($1,$2)", [
          j.id,
          crypto.randomUUID(),
        ])
      ).rows[0].finish_job,
      false,
    );
    assert.equal(
      (
        await db.query<{ complete_archive: boolean }>(
          "select complete_archive($1,$2,'archived',-123,99)",
          [j.id, j.lease_token],
        )
      ).rows[0].complete_archive,
      true,
    );
    const x = (
      await db.query<{ claim_job: any }>("select claim_job('extract')")
    ).rows[0].claim_job;
    const parsed = {
      kind: "invoice",
      supplier: "Test supplier",
      number: "B-2",
      date: "2026-10-17",
      delivery: 0,
      lines: invoice.lines,
    };
    await db.query("select complete_extraction($1,$2,$3,$4)", [
      x.id,
      x.lease_token,
      "a".repeat(64),
      JSON.stringify(parsed),
    ]);
    assert.equal((await db.query("select * from invoice")).rows.length, 2);
    assert.equal(
      (await db.query("select * from job where state='done'")).rows.length,
      2,
    );
    // Stale workers cannot commit twice.
    assert.equal(
      (
        await db.query<{ complete_extraction: boolean }>(
          "select complete_extraction($1,$2,$3,$4)",
          [x.id, x.lease_token, "a".repeat(64), JSON.stringify(parsed)],
        )
      ).rows[0].complete_extraction,
      false,
    );

    assert.equal(
      (await db.query<{ v: string }>("select telegram_money(558700) v")).rows[0]
        .v,
      "5587,00",
    );
    assert.equal(
      (
        await db.query<{ discount: number }>(
          "select discount from invoice where id=$1",
          [inv],
        )
      ).rows[0].discount,
      100,
    );
    // Checkbox payment represents the full current total.
    const paidVersion = (
      await db.query<{ version: number }>(
        "select version from invoice where id=$1",
        [inv],
      )
    ).rows[0].version;
    await db.query("select save_invoice($1,$2,false)", [
      lab,
      JSON.stringify({ ...invoice, version: paidVersion, paid: 1 }),
    ]);
    assert.equal(
      (
        await db.query<{ paid: number }>(
          "select paid from invoice where id=$1",
          [inv],
        )
      ).rows[0].paid,
      18,
    );
    // Telegram flows use the same operations as the site, without a model.
    const tg = 998877;
    await db.exec(
      `insert into telegram_user values(${tg},'${lab}','${user}') on conflict do nothing`,
    );
    let update = 900000;
    const command = async (text: string, id = ++update) => {
      await db.query("select ingest_telegram_command($1,$2,$3,$4,$5)", [
        id,
        tg,
        tg,
        text,
        "https://example.com",
      ]);
      return (
        await db.query<{ payload: any }>(
          "select payload from job where kind='reply' order by created_at desc,id desc limit 1",
        )
      ).rows[0].payload;
    };
    const latestPayload = async () =>
      (
        await db.query<{ payload: any }>(
          "select payload from job where kind='reply' and payload->>'chat_id'=$1 order by created_at desc limit 1",
          [String(tg)],
        )
      ).rows[0].payload;
    await command("/status");
    assert.match((await latestPayload()).text, /Статус:/);
    const mat = (
      await db.query<{ id: string; version: number }>(
        "select id,version from material where lab_id=$1 limit 1",
        [lab],
      )
    ).rows[0];
    await command("/material " + mat.id);

    assert.match(
      JSON.stringify((await latestPayload()).reply_markup),
      /Изменить карточку/,
    );
    await command("/set " + mat.id + " name " + mat.version);
    await command("Исправлено из Telegram");
    assert.equal(
      (
        await db.query<{ name: string }>(
          "select name from material where id=$1",
          [mat.id],
        )
      ).rows[0].name,
      "Исправлено из Telegram",
    );
    const current = (
      await db.query<{ version: number }>(
        "select version from material where id=$1",
        [mat.id],
      )
    ).rows[0].version;
    await command("/set " + mat.id + " name " + current);
    await db.query("update material set version=version+1 where id=$1", [
      mat.id,
    ]);
    await command("Устаревшее изменение");
    assert.equal(
      (
        await db.query<{ name: string }>(
          "select name from material where id=$1",
          [mat.id],
        )
      ).rows[0].name,
      "Исправлено из Telegram",
    );
    await command("/cancel");
    const countBefore = (
      await db.query<{ n: number }>("select count(*)::int n from job")
    ).rows[0].n;
    await command("/documents", 999999);
    await command("/documents", 999999);
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from job")).rows[0]
        .n,
      countBefore + 1,
    );
    await assert.rejects(
      () =>
        db.query(
          "select ingest_telegram_command(1000000,123456,123456,'/status','')",
        ),
      /Нет доступа/,
    );
    const pending = (
      await db.query<{ id: string; version: number }>(
        "select id,version from invoice where status='review' limit 1",
      )
    ).rows[0];
    await command("/invoice " + pending.id);
    assert.match(
      JSON.stringify((await latestPayload()).reply_markup),
      /Подтвердить счёт/,
    );
    await command("/confirm " + pending.id + " " + pending.version);
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from invoice where id=$1",
          [pending.id],
        )
      ).rows[0].status,
      "confirmed",
    );
    // Rejection is versioned, scoped to membership, and cannot be undone by stale controls.
    await command("/invoice " + pending.id);
    const keyboard = JSON.stringify((await latestPayload()).reply_markup);
    assert.match(keyboard, /Отклонить счёт/);
    assert.match(keyboard, /✅ Оплачено/);
    assert.match(keyboard, /📦 Получено/);
    assert.match(keyboard, /https:\/\/example.com#\/review/);
    await assert.rejects(
      () =>
        db.query("select decline_invoice($1,$2,$3)", [
          lab,
          pending.id,
          pending.version,
        ]),
      /уже изменён/,
    );
    await db.exec("set request.jwt.claim.sub='" + other + "'");
    await assert.rejects(
      () =>
        db.query("select decline_invoice($1,$2,$3)", [
          lab,
          pending.id,
          pending.version + 1,
        ]),
      /Нет доступа/,
    );
    await db.exec("set request.jwt.claim.sub='" + user + "'");
    await command("/decline " + pending.id + " " + (pending.version + 1));
    const rejected = (
      await db.query<any>(
        "select i.*,d.sha256,d.status document_status from invoice i join document d on d.id=i.document_id where i.id=$1",
        [pending.id],
      )
    ).rows[0];
    assert.equal(rejected.status, "declined");
    assert.equal(rejected.document_status, "declined");
    assert.equal(rejected.sha256, "a".repeat(64));
    assert.equal(
      (
        await db.query(
          "select id from invoice where status='confirmed' and id=$1",
          [pending.id],
        )
      ).rows.length,
      0,
    );
    await command("/invoice " + pending.id);
    assert.doesNotMatch(
      JSON.stringify((await latestPayload()).reply_markup),
      /\/confirm |\/paid |\/received |\/decline /,
    );
    await assert.rejects(
      () =>
        db.query("update invoice set status='review' where id=$1", [
          pending.id,
        ]),
      /отклонён/,
    );
    // Both web and Telegram uploads go through this archive completion, before the model runs.
    const duplicate = crypto.randomUUID(),
      archiveJob = crypto.randomUUID(),
      lease = crypto.randomUUID();
    await db.query(
      "insert into document(id,lab_id,name,source) values($1,$2,'duplicate.pdf','web')",
      [duplicate, lab],
    );
    await db.query(
      "insert into job(id,lab_id,document_id,kind,state,lease_token,lease_until) values($1,$2,$3,'archive','running',$4,now()+interval '5 minutes')",
      [archiveJob, lab, duplicate, lease],
    );
    await db.query("select complete_archive_checked($1,$2,'file',-1,1,$3)", [
      archiveJob,
      lease,
      "a".repeat(64),
    ]);
    assert.equal(
      (
        await db.query<any>(
          "select status,archive_status from document where id=$1",
          [duplicate],
        )
      ).rows[0].status,
      "declined",
    );
    assert.equal(
      (
        await db.query(
          "select id from job where document_id=$1 and kind='extract'",
          [duplicate],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select id from invoice where document_id=$1", [
          duplicate,
        ])
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
