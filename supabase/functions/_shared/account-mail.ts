export const mailSender = "yaroslavna@dentumclinic.ru";
export const appUrl = "https://protoptica.github.io/dentumlab/";

export function accountMail(email: string, password: string) {
  return {
    from: { name: "Закупки Дентум", address: mailSender },
    to: email,
    subject: "Доступ к приложению «Закупки Дентум»",
    text: [
      "Вам создан аккаунт в приложении «Закупки Дентум».",
      "",
      `Сайт: ${appUrl}`,
      `Логин: ${email}`,
      `Пароль: ${password}`,
      "",
      "После входа вы можете сменить пароль в разделе «Настройки → Мой пароль».",
    ].join("\n"),
  };
}
