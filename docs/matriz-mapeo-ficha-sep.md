# Matriz de Mapeo: Sistema -> Ficha 2026 -> Reporte Semestral SEP

## Objetivo

Alinear una sola captura de datos para cubrir tres salidas operativas:

1. Formulario y control interno del sistema
2. Impresion de ficha de examen (`FICHAS 2026.docx`)
3. Exportacion semestral para SEP (`INFORMACION-ALUMNOS_SEMESTRAL ... .xls`)

## Reglas generales

- `CURP` en mayusculas y longitud exacta de 18.
- Telefonos aceptar entrada con separadores (`/`, `,`, espacio), pero normalizar en almacenamiento.
- `promedio` en escala `0` a `10`, con 1 decimal como maximo.
- `sexo` se guarda y exporta como texto descriptivo (`Masculino`, `Femenino`, `Otro`).
- `folio` de pre-registro es el identificador operativo interno para seguimiento.

## Mapeo principal

| Sistema (DB / UI) | Ficha 2026 (DOCX merge) | Semestral SEP (XLS) | Transformacion |
| --- | --- | --- | --- |
| `preRegistration.folio` | `NO` / `No. DE FICHA` | `NO.` | Directo |
| `firstName` + `paternalLastName` + `maternalLastName` | `NOMBRE_` | `NOMBRE`, `APELLIDO PATERNO`, `APELLIDO MATERNO` | Concatenado para ficha, separado para SEP |
| `curp` | `CURP` | `CURP` | Mayusculas, trim |
| `age` | `EDAD` | `EDAD` | Entero derivado de fecha o captura |
| `sex` | `SEXO` | `SEXO` | Exportar como texto (`Masculino`, `Femenino`, `Otro`) |
| `locality` + `municipality` + `state` | `LOCALIDAD` | `LOCALIDAD` | Concatenado para ficha |
| `previousSchool` | `ESCUELA_DE_PROCEDENCIA` | `ESCUELA DE PROCEDENCIA` | Directo |
| `secondaryAverage` | `PROMEDIO_` | `PROMEDIO` | Decimal (0-10) |
| `guardianFullName` | `NOMBRE_DEL_TUTOR` | `NOMBRE DEL TUTOR` | Directo |
| `phone` | `NUMERO TELEFONICO` (si se imprime) | `NUMERO ALUMNO` | Normalizar formato |
| `guardianPhone` | `NUMERO TELEFONICO` (si se imprime) | `NUMERO TUTOR` | Normalizar formato |
| `email` | `CORREO` | `CORREO ELECTRONICO` | Minusculas/trim |
| `motherTongue` (nuevo recomendado) | n/a | `LENGUA MATERNA` | Campo nuevo sugerido |
| `examRoom` (nuevo recomendado) | `SALON` | `SALON` | Campo por convocatoria |

## Campos faltantes recomendados (para cubrir 100% del XLS)

Para cerrar la brecha con `FICHAS 2026.xlsx` y el semestral, agregar en esquema:

- `motherTongue` (string)
- `examRoom` (string)
- `studentPhoneSecondary` (string opcional)
- `guardianPhoneSecondary` (string opcional)

## Estandar de normalizacion

### CURP
- `trim()`
- `toUpperCase()`
- validar regex CURP

### Telefonos
- permitir entrada libre (`9191.../9191...`)
- almacenar version limpia en columna principal
- almacenar alterno en columna secundaria (si existe)

### Promedio
- convertir a numero
- redondear a 1 decimal
- rechazar fuera de rango

## Orden de implementacion recomendado

1. Congelar diccionario oficial de columnas SEP con Control Escolar.
2. Ajustar schema con campos faltantes.
3. Implementar exportador SEP (`.xlsx`) con orden/headers exactos.
4. Integrar impresion de ficha DOCX usando merge fields detectados.
5. Validar E2E con 10 casos reales de aspirantes.

## Criterios de aceptacion

- Un registro capturado una sola vez alimenta ficha y export SEP sin recaptura.
- El archivo exportado mantiene columnas y orden oficial de Control Escolar.
- La ficha impresa conserva formato institucional y datos correctos del alumno/tutor.
