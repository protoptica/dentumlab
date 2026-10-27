import test from "node:test";
import assert from "node:assert/strict";
import { demoData } from "../src/demo.ts";
import { applyDiscount, prepareDiscount } from "../src/discount.ts";
import { total, validateInvoice } from "../src/domain.ts";
test("discount percent and rubles affect goods only, persist without double subtraction", () => {
  const i = demoData().invoices[0];
  i.discount = 0;
  i.paid = 0;
  i.delivery = 46025;
  i.lines = [
    { ...i.lines[0], quantity: "1", unit_price: 829000, total: 829000 },
  ];
  const d = applyDiscount(i, 0, 21);
  assert.equal(d.discount, 174090);
  assert.equal(total(d), 700935);
  assert.equal(d.lines[0].unit_price, 654910);
  validateInvoice(d);
  assert.deepEqual(applyDiscount(prepareDiscount(d), 174090), {
    ...d,
    discount_percent: null,
  });
  assert.equal(total(applyDiscount(d, 0)), 875025);
  i.lines.push({
    ...i.lines[0],
    id: "shipping",
    name: "Услуги доставки",
    total: 46025,
    unit_price: 46025,
  });
  i.delivery = 0;
  const full = applyDiscount(i, 0, 100);
  assert.equal(total(full), 46025);
  assert.equal(full.lines[1].discount_amount, 0);
  assert.throws(() => applyDiscount(i, 829001));
});
test("fractional quantities and allocation preserve every cent", () => {
  const i = demoData().invoices[0];
  i.discount = 0;
  i.paid = 0;
  i.delivery = 0;
  i.lines = [
    { ...i.lines[0], quantity: "3", total: 100, unit_price: 33 },
    { ...i.lines[0], id: "b", quantity: "1", total: 100, unit_price: 100 },
  ];
  const d = applyDiscount(i, 1);
  assert.equal(total(d), 199);
  validateInvoice(d);
  assert.deepEqual(
    d.lines.map((l) => l.discount_amount),
    [1, 0],
  );
});
