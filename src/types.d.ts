declare module "@myorg/bank-statement-parser" {
  export type GenericTransaction = {
    date: string; // YYYY-MM-DD
    description: string;
    amount: number; // siempre positivo
    direction: "income" | "expense";
    currency: string;
    source?: {
      bank: string;
      rowIndex: number;
      raw?: Record<string, unknown>;
    };
  };

  export type ParseWarning = {
    code: string;
    message: string;
    rowIndex?: number;
    field?: string;
  };

  export type ImporterContext = {
    helpers: {
      normalizeHeader(value: string): string;
      normalizeAmount(value: unknown): number | null;
      normalizeDate(value: unknown): string | null;
      compactWhitespace(value: string): string;
    };
    options?: {
      includeRawRow?: boolean;
      defaultCurrency?: string;
    };
  };

  export type BankImporter = {
    id: string;
    name: string;
    version: string;
    supportedFileTypes: ("xls" | "xlsx" | "csv")[];
    canHandle(headers: string[]): boolean;
    parse(
      rows: Record<string, unknown>[],
      ctx: ImporterContext,
    ): { transactions: GenericTransaction[]; warnings: ParseWarning[] };
    getDuplicateKey?(
      tx: Pick<GenericTransaction, "date" | "amount" | "description">,
    ): string;
  };
}
