# @myorg/bank-importer-santander

Plugin de importación para extractos de Santander compatible con `@myorg/bank-statement-parser`.

## Instalación

```bash
npm install @myorg/bank-importer-santander
```

> Este paquete requiere `@myorg/bank-statement-parser` como `peerDependency`.

## Uso

```ts
import santanderImporter, { santanderImporter as namedImporter } from "@myorg/bank-importer-santander";
```

El importer exporta la estructura `BankImporter` esperada por el core y provee:

- `canHandle(headers)` para detectar formatos Santander comunes.
- `parse(rows, ctx)` para mapear filas a `GenericTransaction` y warnings.
- `getDuplicateKey(tx)` para deduplicación consistente.

## Notas de diseño

- No incluye lógica de engine/core.
- Mantiene amounts en positivo y define `direction` por contexto de movimiento.
- Respeta `defaultCurrency` e `includeRawRow` desde `ImporterContext.options`.
