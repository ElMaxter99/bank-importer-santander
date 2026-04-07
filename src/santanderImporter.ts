import type {
  BankImporter,
  GenericTransaction,
  ImporterContext,
  ParseWarning,
} from "@myorg/bank-statement-parser";

const DATE_HEADERS = ["fecha", "fecha operacion", "fecha valor"] as const;
const DESCRIPTION_HEADERS = ["concepto", "descripcion"] as const;
const AMOUNT_HEADERS = ["importe", "importe eur", "importe eur."] as const;
const DEBIT_HEADERS = ["debe", "cargo", "retirada", "importe debe"] as const;
const CREDIT_HEADERS = ["haber", "abono", "ingreso", "importe haber"] as const;
const SIGN_INDICATOR_HEADERS = [
  "tipo",
  "tipo movimiento",
  "naturaleza",
  "movimiento",
  "debe/haber",
] as const;

const NEGATIVE_HINTS = ["debe", "cargo", "adeudo"] as const;
const POSITIVE_HINTS = ["haber", "abono", "ingreso"] as const;

const BANK = "santander";

const compact = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const normalizeHeadersMap = (
  row: Record<string, unknown>,
  ctx: ImporterContext,
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const key of Object.keys(row)) {
    map.set(ctx.helpers.normalizeHeader(key), key);
  }
  return map;
};

const findField = (
  headerMap: Map<string, string>,
  candidates: readonly string[],
): string | null => {
  for (const c of candidates) {
    const found = headerMap.get(c);
    if (found) return found;
  }
  return null;
};

const warning = (code: string, message: string, rowIndex: number, field?: string): ParseWarning => ({
  code,
  message,
  rowIndex,
  ...(field ? { field } : {}),
});

const parseDate = (value: unknown, ctx: ImporterContext): string | null => {
  const fromHelper = ctx.helpers.normalizeDate(value);
  if (fromHelper) return fromHelper;

  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date: 1 = 1900-01-01 (approx with 25569 offset to Unix epoch)
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (m) {
      const [, d, mo, y] = m;
      if (!d || !mo || !y) return null;
      const dd = d.padStart(2, "0");
      const mm = mo.padStart(2, "0");
      return `${y}-${mm}-${dd}`;
    }
  }

  return null;
};

const parseIndicatorSign = (value: unknown): 1 | -1 | null => {
  if (typeof value !== "string") return null;
  const text = compact(value);

  if (NEGATIVE_HINTS.some((hint) => text.includes(hint))) return -1;
  if (POSITIVE_HINTS.some((hint) => text.includes(hint))) return 1;

  return null;
};

const resolveSignedAmount = (
  row: Record<string, unknown>,
  headerMap: Map<string, string>,
  ctx: ImporterContext,
): { amount: number; sourceField: string } | null => {
  const debitField = findField(headerMap, DEBIT_HEADERS);
  const creditField = findField(headerMap, CREDIT_HEADERS);

  const parsedDebit = debitField ? ctx.helpers.normalizeAmount(row[debitField]) : null;
  const parsedCredit = creditField ? ctx.helpers.normalizeAmount(row[creditField]) : null;

  const hasValidDebit = parsedDebit !== null && Number.isFinite(parsedDebit) && parsedDebit !== 0;
  const hasValidCredit = parsedCredit !== null && Number.isFinite(parsedCredit) && parsedCredit !== 0;

  // Prioridad 1: columnas Debe/Haber separadas
  if (hasValidDebit || hasValidCredit) {
    if (hasValidCredit && !hasValidDebit) {
      return { amount: Math.abs(parsedCredit as number), sourceField: creditField as string };
    }
    if (hasValidDebit && !hasValidCredit) {
      return { amount: -Math.abs(parsedDebit as number), sourceField: debitField as string };
    }
    return {
      amount: Math.abs(parsedCredit as number) - Math.abs(parsedDebit as number),
      sourceField: `${debitField ?? "debe"}/${creditField ?? "haber"}`,
    };
  }

  // Prioridad 2: importe único
  const amountField = findField(headerMap, AMOUNT_HEADERS);
  if (!amountField) return null;

  const parsedAmount = ctx.helpers.normalizeAmount(row[amountField]);
  if (parsedAmount === null || !Number.isFinite(parsedAmount)) return null;

  let signed = parsedAmount;

  // Prioridad 3: indicador textual de signo aplicado sobre valor absoluto
  const indicatorField = findField(headerMap, SIGN_INDICATOR_HEADERS);
  if (indicatorField) {
    const sign = parseIndicatorSign(row[indicatorField]);
    if (sign !== null) {
      signed = Math.abs(parsedAmount) * sign;
    }
  }

  return { amount: signed, sourceField: amountField };
};

export const santanderImporter: BankImporter = {
  id: BANK,
  name: "Santander Importer",
  version: "1.1.0",
  supportedFileTypes: ["csv", "xls", "xlsx"],

  canHandle(headers: string[]): boolean {
    const normalized = headers.map((h) => compact(h.normalize("NFD").replace(/\p{Diacritic}/gu, "")));

    const hasDate = DATE_HEADERS.some((h) => normalized.includes(h));
    const hasDescription = DESCRIPTION_HEADERS.some((h) => normalized.includes(h));
    const hasSingleAmount = AMOUNT_HEADERS.some((h) => normalized.includes(h));
    const hasSplitAmount =
      DEBIT_HEADERS.some((h) => normalized.includes(h)) || CREDIT_HEADERS.some((h) => normalized.includes(h));

    return hasDate && hasDescription && (hasSingleAmount || hasSplitAmount);
  },

  parse(rows: Record<string, unknown>[], ctx: ImporterContext) {
    const transactions: GenericTransaction[] = [];
    const warnings: ParseWarning[] = [];

    rows.forEach((row, rowIndex) => {
      const headerMap = normalizeHeadersMap(row, ctx);

      const dateField = findField(headerMap, DATE_HEADERS);
      const descriptionField = findField(headerMap, DESCRIPTION_HEADERS);

      if (!dateField) {
        warnings.push(warning("MISSING_DATE", "No se encontró columna de fecha", rowIndex, "date"));
        return;
      }
      if (!descriptionField) {
        warnings.push(
          warning("MISSING_DESCRIPTION", "No se encontró columna de descripción", rowIndex, "description"),
        );
        return;
      }

      const date = parseDate(row[dateField], ctx);
      if (!date) {
        warnings.push(warning("INVALID_DATE", "Fecha inválida", rowIndex, dateField));
        return;
      }

      const rawDescription = row[descriptionField];
      const description =
        typeof rawDescription === "string" ? ctx.helpers.compactWhitespace(rawDescription).trim() : "";
      if (!description) {
        warnings.push(warning("EMPTY_DESCRIPTION", "Descripción vacía", rowIndex, descriptionField));
        return;
      }

      const signed = resolveSignedAmount(row, headerMap, ctx);
      if (!signed || !Number.isFinite(signed.amount) || signed.amount === 0) {
        warnings.push(warning("INVALID_AMOUNT", "Importe inválido", rowIndex, signed?.sourceField ?? "amount"));
        return;
      }

      const direction: GenericTransaction["direction"] = signed.amount < 0 ? "expense" : "income";
      const tx: GenericTransaction = {
        date,
        description,
        amount: Math.abs(signed.amount),
        direction,
        currency: ctx.options?.defaultCurrency?.toUpperCase() || "EUR",
        source: {
          bank: BANK,
          rowIndex,
          ...(ctx.options?.includeRawRow ? { raw: row } : {}),
        },
      };

      transactions.push(tx);
    });

    return { transactions, warnings };
  },

  getDuplicateKey(tx: Pick<GenericTransaction, "amount" | "date" | "description">): string {
    return `${tx.amount.toFixed(2)}|${tx.date}|${compact(tx.description)}`;
  },
};

export default santanderImporter;
