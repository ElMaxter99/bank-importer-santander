import { describe, expect, it } from "vitest";
import { santanderImporter } from "../src/santanderImporter.js";
import type { ImporterContext } from "@myorg/bank-statement-parser";

const ctx: ImporterContext = {
  helpers: {
    normalizeHeader: (value: string) =>
      value
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .trim(),
    normalizeAmount: (value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value !== "string") return null;
      const parsed = Number.parseFloat(value.replace(/\./g, "").replace(",", "."));
      return Number.isFinite(parsed) ? parsed : null;
    },
    normalizeDate: (value: unknown) => {
      if (typeof value !== "string") return null;
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
      if (!m) return null;
      return `${m[3]}-${m[2]}-${m[1]}`;
    },
    compactWhitespace: (value: string) => value.replace(/\s+/g, " "),
  },
  options: {
    defaultCurrency: "EUR",
    includeRawRow: true,
  },
};

describe("santanderImporter", () => {
  it("detecta headers Santander comunes", () => {
    expect(santanderImporter.canHandle(["Fecha", "Descripción", "Importe"]).valueOf()).toBe(true);
    expect(santanderImporter.canHandle(["Date", "Description", "Amount"]).valueOf()).toBe(true);
    expect(santanderImporter.canHandle(["foo", "bar"]).valueOf()).toBe(false);
  });

  it("parsea filas válidas y produce warnings para filas inválidas", () => {
    const rows = [
      { Fecha: "07/04/2026", Descripción: "Nómina abril", Importe: "1.500,00", Moneda: "eur" },
      { Fecha: "07/04/2026", Descripción: "Supermercado", Importe: "-123,45" },
      { Fecha: "sin fecha", Descripción: "inválida", Importe: "10,00" },
    ];

    const result = santanderImporter.parse(rows, ctx);

    expect(result.transactions).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);

    expect(result.transactions[0]).toMatchObject({
      date: "2026-04-07",
      description: "Nómina abril",
      amount: 1500,
      direction: "income",
      currency: "EUR",
      source: {
        bank: "santander",
        rowIndex: 0,
      },
    });

    expect(result.transactions[1]).toMatchObject({
      amount: 123.45,
      direction: "expense",
      currency: "EUR",
    });

    expect(result.warnings[0]?.code).toBe("INVALID_DATE");
  });

  it("crea duplicate key estable", () => {
    const key = santanderImporter.getDuplicateKey?.({
      date: "2026-04-07",
      amount: 123.4,
      description: "  Pago tarjeta  ",
    });

    expect(key).toBe("2026-04-07|123.40|pago tarjeta");
  });
});
