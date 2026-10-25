export function loginError(error: {
  code?: string;
  status?: number;
  name?: string;
}): string {
  if (error.code === "invalid_credentials")
    return "Неверная почта или пароль. Если Safari подставил пароль автоматически, введите его заново.";
  if (error.status === 429 || error.code === "over_request_rate_limit")
    return "Слишком много попыток входа. Подождите несколько минут и попробуйте снова.";
  if (error.code === "email_not_confirmed")
    return "Почта не подтверждена. Обратитесь к администратору лаборатории.";
  if (
    !error.status ||
    error.status >= 500 ||
    error.name === "AuthRetryableFetchError"
  )
    return "Не удалось связаться с сервером входа. Проверьте интернет и попробуйте снова.";
  return "Не удалось войти. Попробуйте снова; если ошибка повторится, обратитесь к администратору.";
}
