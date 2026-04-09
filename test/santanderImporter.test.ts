import { describe, expect, it } from "vitest";
import { santanderImporter } from "../src/index.js";
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
      const cleaned = value.replace(/\./g, "").replace(",", ".").trim();
      const parsed = Number.parseFloat(cleaned);
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
    defaultCurrency: "eur",
    includeRawRow: true,
  },
};

describe("santanderImporter", () => {
  it("canHandle detecta headers Santander", () => {
    expect(santanderImporter.canHandle(["Fecha", "Concepto", "Importe EUR"])).toBe(true);
    expect(santanderImporter.canHandle(["Fecha operación", "Descripción", "Debe", "Haber"])).toBe(true);
    expect(santanderImporter.canHandle(["foo", "bar"])).toBe(false);
  });

  it("parse: Importe único positivo/negativo", () => {
    const rows = [
      { Fecha: "07/04/2026", Concepto: "Nómina", Importe: "1500,00" },
      { Fecha: "07/04/2026", Concepto: "Compra", Importe: "123,45", "Debe/Haber": "debe" },
    ];
    const result = santanderImporter.parse(rows, ctx);

    expect(result.warnings).toHaveLength(0);
    expect(result.transactions[0]).toMatchObject({ amount: 1500, direction: "income" });
    expect(result.transactions[1]).toMatchObject({ amount: 123.45, direction: "expense" });
  });

  it("parse: Debe/Haber separado", () => {
    const rows = [
      { Fecha: "07/04/2026", Concepto: "Transferencia", Haber: "80,00" },
      { Fecha: "07/04/2026", Concepto: "Cajero", Debe: "40,00" },
    ];
    const result = santanderImporter.parse(rows, ctx);

    expect(result.warnings).toHaveLength(0);
    expect(result.transactions[0]).toMatchObject({ amount: 80, direction: "income" });
    expect(result.transactions[1]).toMatchObject({ amount: 40, direction: "expense" });
  });

  it("parse: fecha serial Excel y dd/mm/yyyy", () => {
    const rows = [
      { Fecha: 46020, Concepto: "Excel date", Importe: "1,00" },
      { Fecha: "07/04/2026", Concepto: "Date text", Importe: "2,00" },
    ];
    const result = santanderImporter.parse(rows, ctx);

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.transactions[1]?.date).toBe("2026-04-07");
  });

  it("parse: filas inválidas generan warnings", () => {
    const rows = [
      { Fecha: "xx", Concepto: "ok", Importe: "1,00" },
      { Fecha: "07/04/2026", Concepto: "   ", Importe: "1,00" },
      { Fecha: "07/04/2026", Concepto: "ok", Importe: "xxx" },
    ];
    const result = santanderImporter.parse(rows, ctx);

    expect(result.transactions).toHaveLength(0);
    expect(result.warnings.map((w) => w.code)).toEqual(["INVALID_DATE", "EMPTY_DESCRIPTION", "INVALID_AMOUNT"]);
  });

  it("getDuplicateKey normaliza descripción", () => {
    const key = santanderImporter.getDuplicateKey?.({
      amount: 10,
      date: "2026-04-07",
      description: "  Pago   TARJETA  ",
    });

    expect(key).toBe("10.00|2026-04-07|pago tarjeta");
  });
});
