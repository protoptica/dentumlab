import test from "node:test";
import assert from "node:assert/strict";
import {
  cents,
  lineTotal,
  total,
  validateInvoice,
  csv,
} from "../src/domain.ts";
import { demoData } from "../src/demo.ts";
test("money and quantity use exact integer rounding", () => {
  assert.equal(cents("0,29"), 29);
  assert.equal(lineTotal("0.125", 100), 13);
  assert.equal(lineTotal("3.333", 299), 997);
  assert.throws(() => cents("1.001"));
  assert.throws(() => cents("-1"));
  assert.throws(() => cents("1e4"));
});
test("invoice totals include delivery and reject overpayment", () => {
  const i = demoData().invoices[0];
  i.delivery = 9900;
  assert.equal(total(i), i.lines[0].total + 9900);
  i.paid = total(i) + 1;
  assert.throws(() => validateInvoice(i), /Оплата/);
  i.paid = 0;
  i.lines[0].total++;
  assert.throws(() => validateInvoice(i), /Сумма строки/);
});
test("CSV escapes formula injection and preserves supplier names", () => {
  const d = demoData();
  d.invoices[0].lines[0].name = '=HYPERLINK("test")';
  const out = csv(d, [d.invoices[0]]);
  assert.ok(out.includes("'=HYPERLINK"));
  assert.ok(out.includes("Bloomden"));
  assert.ok(out.startsWith("\uFEFF"));
});
