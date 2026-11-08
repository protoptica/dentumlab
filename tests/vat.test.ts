import test from "node:test";
import assert from "node:assert/strict";
import { displayVat } from "../src/vat";
test("VAT aliases share options while mixed rates remain visible", () => {
  for (const value of ["0%", "Без НДС", "Без налога (НДС)", "Без налога (НДС): -"])
    assert.equal(displayVat(value), "Без НДС / 0%");
  for (const value of ["Включён в цену", "НДС сверху — включён в строки", "с учетом НДС"])
    assert.equal(displayVat(value), "Включён в цену");
  assert.equal(displayVat("Без НДС, 22%"), "Без НДС, 22%");
  assert.equal(displayVat("22% и 10%"), "22% и 10%");
});
