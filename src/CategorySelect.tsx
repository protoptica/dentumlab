import { useState } from "react";
import type { Data } from "./domain";
export default function CategorySelect({
  data,
  value,
  onChange,
  disabled = false,
}: {
  data: Data;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const categories = Array.from(
    new Set(
      [
        "Без категории",
        ...data.materials.map((m) => m.category),
        ...data.invoices.flatMap((i) => i.lines.map((l) => l.category)),
        value,
      ]
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, "ru"));
  return (
    <span className="category-select">
      <select
        aria-label="Категория"
        value={creating ? "__create__" : value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === "__create__") {
            setCreating(true);
            return;
          }
          setCreating(false);
          onChange(e.target.value);
        }}
      >
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value="__create__">Создать новую</option>
      </select>
      {creating && (
        <input
          aria-label="Название новой категории"
          placeholder="Название новой категории"
          autoFocus
          required
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      )}
    </span>
  );
}
