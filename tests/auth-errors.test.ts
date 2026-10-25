import test from "node:test";
import assert from "node:assert/strict";
import { loginError } from "../src/auth-errors";
test("login distinguishes credentials, connectivity and rate limits", () => {
  assert.match(
    loginError({ code: "invalid_credentials", status: 400 }),
    /Неверная почта или пароль/,
  );
  assert.match(
    loginError({ name: "AuthRetryableFetchError", status: 0 }),
    /связаться с сервером/,
  );
  assert.match(loginError({ status: 503 }), /связаться с сервером/);
  assert.match(loginError({ status: 429 }), /много попыток/);
  assert.match(
    loginError({ code: "email_not_confirmed", status: 400 }),
    /не подтверждена/,
  );
});
