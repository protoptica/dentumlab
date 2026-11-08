export const vatOptions = [
  "Не указан",
  "Включён в цену",
  "Без НДС / 0%",
  "5%",
  "7%",
  "10%",
  "20%",
  "22%",
];

export function displayVat(value: string): string {
  const text = (value || "").trim();
  if (!text) return "Не указан";
  if (
    /^(?:без ндс(?:\s*\/\s*0%)?|без налога\s*\(ндс\)\s*:?[\s—-]*|ндс не облагается|0(?:[.,]0+)?\s*%)$/i.test(
      text,
    )
  )
    return "Без НДС / 0%";
  if (
    /^(?:включ[её]н в цену|с уч[её]том ндс|ндс сверху\s*[—-]\s*включ[её]н в строки)$/i.test(
      text,
    )
  )
    return "Включён в цену";
  return text;
}
