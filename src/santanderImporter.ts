import type {
  BankImporter,
  GenericTransaction,
  ImporterContext,
  ParseWarning,
} from "@myorg/bank-statement-parser";

type SupportedDirection = GenericTransaction["direction"];

const SANTANDER_ID = "santander";
const SANTANDER_NAME = "Santander Importer";
const SANTANDER_VERSION = "1.0.0";

const REQUIRED_HEADER_GROUPS = [
  ["fecha", "date"],
  ["descripcion", "concepto", "detail", "detalle"],
  ["importe", "amount", "monto"],
] as const;

const CANDIDATE_DATE_HEADERS = ["fecha", "date", "fecha operacion", "f. operacion"];
const CANDIDATE_DESCRIPTION_HEADERS = [
  "descripcion",
  "concepto",
  "detalle",
  "description",
  "movimiento",
];
const CANDIDATE_AMOUNT_HEADERS = [
  "importe",
  "monto",
  "amount",
  "cargo",
  "abono",
  "debito",
  "credito",
];
const CANDIDATE_CURRENCY_HEADERS = ["moneda", "currency", "divisa"];
const CANDIDATE_TYPE_HEADERS = ["tipo", "type", "movimiento"];

const INCOME_HINTS = ["abono", "credito", "ingreso", "income", "credit"];
const EXPENSE_HINTS = ["cargo", "debito", "egreso", "expense", "debit"];

const normalize = (value: string, ctx: ImporterContext): string =>
  ctx.helpers.normalizeHeader(value);

const findHeader = (
  row: Record<string, unknown>,
  normalizedCandidates: readonly string[],
  ctx: ImporterContext,
): string | null => {
  const keyByNormalized = new Map<string, string>();
  for (const key of Object.keys(row)) {
    keyByNormalized.set(normalize(key, ctx), key);
  }

  for (const candidate of normalizedCandidates) {
    const found = keyByNormalized.get(candidate);
    if (found) {
      return found;
    }
  }

  return null;
};

const parseDirectionByText = (value: unknown): SupportedDirection | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.toLowerCase();
  if (INCOME_HINTS.some((hint) => normalized.includes(hint))) {
    return "income";
  }
  if (EXPENSE_HINTS.some((hint) => normalized.includes(hint))) {
    return "expense";
  }

  return null;
};

const inferDirection = (
  row: Record<string, unknown>,
  amountHeader: string,
  amountValue: number,
  ctx: ImporterContext,
): SupportedDirection => {
  const normalizedAmountHeader = normalize(amountHeader, ctx);

  if (normalizedAmountHeader.includes("abono") || normalizedAmountHeader.includes("credito")) {
    return "income";
  }

  if (normalizedAmountHeader.includes("cargo") || normalizedAmountHeader.includes("debito")) {
    return "expense";
  }

  const typeHeader = findHeader(row, CANDIDATE_TYPE_HEADERS, ctx);
  if (typeHeader) {
    const byType = parseDirectionByText(row[typeHeader]);
    if (byType) {
      return byType;
    }
  }

  return amountValue >= 0 ? "income" : "expense";
};

const pickCurrency = (row: Record<string, unknown>, ctx: ImporterContext): string => {
  const currencyHeader = findHeader(row, CANDIDATE_CURRENCY_HEADERS, ctx);
  const fromRow = currencyHeader ? row[currencyHeader] : undefined;

  if (typeof fromRow === "string" && fromRow.trim().length > 0) {
    return fromRow.trim().toUpperCase();
  }

  return ctx.options?.defaultCurrency?.trim().toUpperCase() || "EUR";
};

const createWarning = (
  code: string,
  message: string,
  rowIndex: number,
  field?: string,
): ParseWarning => ({
  code,
  message,
  rowIndex,
  ...(field ? { field } : {}),
});

export const santanderImporter: BankImporter = {
  id: SANTANDER_ID,
  name: SANTANDER_NAME,
  version: SANTANDER_VERSION,
  supportedFileTypes: ["csv", "xls", "xlsx"],

  canHandle(headers: string[]): boolean {
    const normalizedHeaders = headers.map((header) => header.toLowerCase().trim());

    return REQUIRED_HEADER_GROUPS.every((group) =>
      group.some((candidate) => normalizedHeaders.includes(candidate)),
    );
  },

  parse(
    rows: Record<string, unknown>[],
    ctx: ImporterContext,
  ): { transactions: GenericTransaction[]; warnings: ParseWarning[] } {
    const transactions: GenericTransaction[] = [];
    const warnings: ParseWarning[] = [];

    rows.forEach((row, rowIndex) => {
      const dateHeader = findHeader(row, CANDIDATE_DATE_HEADERS, ctx);
      const descriptionHeader = findHeader(row, CANDIDATE_DESCRIPTION_HEADERS, ctx);
      const amountHeader = findHeader(row, CANDIDATE_AMOUNT_HEADERS, ctx);

      if (!dateHeader) {
        warnings.push(
          createWarning(
            "MISSING_DATE_COLUMN",
            "No se encontró columna de fecha en la fila.",
            rowIndex,
            "date",
          ),
        );
        return;
      }

      if (!descriptionHeader) {
        warnings.push(
          createWarning(
            "MISSING_DESCRIPTION_COLUMN",
            "No se encontró columna de descripción en la fila.",
            rowIndex,
            "description",
          ),
        );
        return;
      }

      if (!amountHeader) {
        warnings.push(
          createWarning(
            "MISSING_AMOUNT_COLUMN",
            "No se encontró columna de importe en la fila.",
            rowIndex,
            "amount",
          ),
        );
        return;
      }

      const parsedDate = ctx.helpers.normalizeDate(row[dateHeader]);
      if (!parsedDate) {
        warnings.push(
          createWarning("INVALID_DATE", "No se pudo normalizar la fecha.", rowIndex, dateHeader),
        );
        return;
      }

      const rawDescription = row[descriptionHeader];
      if (typeof rawDescription !== "string") {
        warnings.push(
          createWarning(
            "INVALID_DESCRIPTION",
            "La descripción no es un texto válido.",
            rowIndex,
            descriptionHeader,
          ),
        );
        return;
      }

      const description = ctx.helpers.compactWhitespace(rawDescription).trim();
      if (!description) {
        warnings.push(
          createWarning(
            "EMPTY_DESCRIPTION",
            "La descripción está vacía después de normalizar.",
            rowIndex,
            descriptionHeader,
          ),
        );
        return;
      }

      const normalizedAmount = ctx.helpers.normalizeAmount(row[amountHeader]);
      if (normalizedAmount === null || Number.isNaN(normalizedAmount)) {
        warnings.push(
          createWarning(
            "INVALID_AMOUNT",
            "No se pudo normalizar el importe.",
            rowIndex,
            amountHeader,
          ),
        );
        return;
      }

      const direction = inferDirection(row, amountHeader, normalizedAmount, ctx);
      const currency = pickCurrency(row, ctx);
      const amount = Math.abs(normalizedAmount);

      const tx: GenericTransaction = {
        date: parsedDate,
        description,
        amount,
        direction,
        currency,
        source: {
          bank: "santander",
          rowIndex,
          ...(ctx.options?.includeRawRow ? { raw: row } : {}),
        },
      };

      transactions.push(tx);
    });

    return { transactions, warnings };
  },

  getDuplicateKey(tx: Pick<GenericTransaction, "date" | "amount" | "description">): string {
    return [tx.date, tx.amount.toFixed(2), tx.description.toLowerCase().trim()].join("|");
  },
};
