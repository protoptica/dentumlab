import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AuditDetails from "../src/AuditDetails.tsx";
import { emptyData } from "../src/domain.ts";

function renderFactor(factor: unknown) {
  // Database audit snapshots retain numeric factors, unlike invoice list data.
  return renderToStaticMarkup(
    React.createElement(AuditDetails, {
      before: null,
      after: {
        lines: [
          { name: "Материал", quantity: 2, unit: "уп.", total: 10000, factor },
        ],
      },
      data: emptyData(),
    }),
  );
}

test("audit details render numeric packaging factors from database snapshots", () => {
  assert.match(renderFactor(7), /фасовка: 7 ·/);
  assert.match(renderFactor(0.125), /фасовка: 0.125 ·/);
});

test("audit details render string and unknown packaging factors", () => {
  assert.match(renderFactor("7.000"), /фасовка: 7 ·/);
  assert.match(renderFactor("0.1250"), /фасовка: 0.125 ·/);
  for (const factor of [null, undefined, ""]) {
    assert.match(renderFactor(factor), /фасовка: неизвестна ·/);
  }
});
