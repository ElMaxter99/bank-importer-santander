# @myorg/bank-importer-santander

Importer plugin de Santander para usar junto con `@myorg/bank-statement-parser`.

## Instalación

```bash
npm i @myorg/bank-importer-santander
```

> Requiere instalar también `@myorg/bank-statement-parser` (peer dependency).

## Uso con el core

```ts
import { parseWithImporter } from "@myorg/bank-statement-parser";
import santanderImporter from "@myorg/bank-importer-santander";

const result = parseWithImporter({
  importer: santanderImporter,
  rows: [
    { Fecha: "07/04/2026", Concepto: "Nómina", Importe: "1500,00" },
    { Fecha: "07/04/2026", Concepto: "Compra", Debe: "25,00" }
  ],
  options: { defaultCurrency: "EUR", includeRawRow: true }
});

console.log(result.transactions);
console.log(result.warnings);
```

## Reglas implementadas Santander

- Fecha: `Fecha`, `Fecha operacion`, `Fecha valor`.
- Descripción: `Concepto`, `Descripcion`.
- Importe único: `Importe`, `Importe EUR`, `Importe Eur`.
- Debe/Haber separado:
  - Debe: `Debe`, `Cargo`, `Retirada`, `Importe debe`.
  - Haber: `Haber`, `Abono`, `Ingreso`, `Importe haber`.
- Indicador textual de signo: `Tipo`, `Tipo movimiento`, `Naturaleza`, `Movimiento`, `Debe/Haber`.

Prioridad de signo:
1. Debe/Haber separados.
2. Si no existen, `Importe` único.
3. Si hay indicador textual, aplica el signo sobre el valor absoluto.

Output:
- `amount`: siempre absoluto.
- `direction`: `expense` si signo negativo, `income` si positivo.

## Desarrollo

```bash
npm run typecheck
npm run test
npm run build
```
