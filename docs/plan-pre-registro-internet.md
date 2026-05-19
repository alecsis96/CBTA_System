# Plan de Operacion: Pre-registro por Internet + Control Escolar + Financieros

## 1) Objetivo

Implementar un flujo de pre-registro en linea para que tutor/alumno capture datos una sola vez, obtenga un voucher de referencia y la informacion quede disponible para:

- Control Escolar (revision, validacion y exportacion a Excel para SEP)
- Financieros (cobro e impresion ROC)

## 2) Alcance funcional

### Portal web publico (nuevo)

- Formulario de pre-registro (alumno/tutor)
- Validaciones de datos (CURP, telefono, correo, requeridos)
- Generacion de folio/voucher al finalizar
- Estatus inicial: `PRE_REGISTRO_ENVIADO`

### Backoffice Control Escolar (existente)

- Bandeja de pre-registros
- Vista de detalle por folio
- Acciones:
  - Aprobar (`VALIDADO_PARA_PAGO`)
  - Observar (`OBSERVADO`)
  - Rechazar (`RECHAZADO`)
- Exportacion Excel para carga a SEP

### Backoffice Financieros (existente)

- Listar solo pre-registros validados para pago
- Emitir ROC sobre alumno validado
- Marcar estatus a `PAGADO`

## 3) Flujo operativo end-to-end

1. Tutor/alumno captura formulario web.
2. El sistema crea folio de pre-registro y muestra voucher imprimible.
3. Registro entra a Control Escolar como `PRE_REGISTRO_ENVIADO`.
4. Control Escolar revisa datos y aprueba/observa/rechaza.
5. Si aprueba, pasa a `VALIDADO_PARA_PAGO`.
6. Financieros cobra e imprime ROC.
7. Control Escolar exporta a Excel para carga SEP.

## 4) Estados de negocio propuestos

- `PRE_REGISTRO_ENVIADO`
- `EN_REVISION_CONTROL_ESCOLAR`
- `OBSERVADO`
- `RECHAZADO`
- `VALIDADO_PARA_PAGO`
- `PAGADO`
- `INSCRITO_SEP`

## 5) Modelo de datos inicial (nuevo)

### Tabla: `PreRegistration`

- `id` (uuid)
- `folio` (string unico)
- `status` (enum/string)
- `firstName`
- `paternalLastName`
- `maternalLastName`
- `curp` (unico por ciclo, segun regla)
- `birthDate`
- `sex`
- `phone`
- `email`
- `addressLine`
- `neighborhood`
- `locality`
- `municipality`
- `state`
- `postalCode`
- `previousSchool`
- `secondaryAverage`
- `schoolCycle`
- `guardianFullName`
- `guardianRelationship`
- `guardianPhone`
- `guardianEmail`
- `voucherGeneratedAt`
- `submittedAt`
- `reviewedAt`
- `reviewedBy`
- `observationNotes`
- `createdAt`
- `updatedAt`

### Tabla: `PreRegistrationAudit` (bitacora)

- `id`
- `preRegistrationId`
- `action`
- `actorRole`
- `actorName`
- `detail`
- `createdAt`

## 6) Campos minimos del voucher

- Folio
- Nombre completo del alumno
- CURP (completo o enmascarado)
- Fecha/hora de envio
- Estatus inicial
- Instrucciones para presentarse en Control Escolar/Financieros

## 7) Exportacion a Excel para SEP

Definir plantilla de columnas oficiales y generar exportacion desde Control Escolar:

- Nombre(s)
- Apellido paterno
- Apellido materno
- CURP
- Fecha nacimiento
- Sexo
- Domicilio
- Municipio
- Estado
- Codigo postal
- Tutor
- Telefono tutor
- Correo
- Escuela procedencia
- Promedio
- Ciclo
- Estatus

## 8) Arquitectura recomendada

- Backend/API central en internet
- Base de datos central
- Clientes internos (Electron) para Control Escolar/Financieros
- Portal web publico para pre-registro
- Cola local + sincronizacion para continuidad offline en clientes internos

## 9) Seguridad y control de acceso

- Portal publico con anti-spam (captcha/rate-limit)
- Backoffice con roles y autenticacion
- Auditoria de cambios
- HTTPS obligatorio

## 10) Plan por fases

### Fase 1 (MVP operativo)

- Endpoint de creacion de pre-registro
- Formulario web publico
- Voucher imprimible
- Bandeja de Control Escolar con aprobar/observar/rechazar
- Filtro en Financieros por `VALIDADO_PARA_PAGO`

### Fase 2 (control administrativo)

- Exportacion Excel SEP
- Observaciones con reenvio de datos
- Busqueda avanzada por CURP/folio/estatus

### Fase 3 (escalamiento)

- Carga documental
- Notificaciones
- Dashboard por departamento

## 11) Criterios de aceptacion (MVP)

- Tutor/alumno completa formulario y recibe voucher con folio.
- Control Escolar ve nuevo registro sin recaptura manual.
- Control Escolar valida y habilita para pago.
- Financieros encuentra alumno validado y emite ROC.
- Control Escolar exporta Excel con estructura acordada.

## 12) Implementacion temporal actual (Fase 1 publica)

- Se agrego portal minimo en `GET /pre-registro` servido por `backend/sync-server.ts`.
- Endpoints publicos actuales:
  - `POST /api/public/pre-registrations`
  - `GET /api/public/pre-registrations/:folio/voucher`
- Validacion de payload con `zod` para campos requeridos de alumno/tutor.
- El folio se genera en servidor con formato `PR-YYYYMMDDHHMMSS-####`.
- El voucher devuelve CURP enmascarado por defecto (privacy-first).

### Persistencia durable (actual)

- El servidor de sync persiste pre-registros publicos en SQLite via Prisma (`PreRegistration`).
- Los endpoints publicos (`POST` y voucher `GET`) leen/escriben sobre DB y sobreviven reinicios del proceso.
- El folio conserva el formato `PR-YYYYMMDDHHMMSS-####` y la CURP se normaliza a mayusculas por validacion.
- El voucher sigue devolviendo CURP enmascarado por defecto (privacy-first).

### Notas operativas

- Definir `PUBLIC_PRE_REGISTRATION_SCHOOL_CYCLE` para el ciclo escolar del portal publico; si no se define, usa `2026-2027`.
- Mantener `corepack pnpm exec prisma db push` al dia cuando cambie el schema para asegurar que `PreRegistration` exista en la DB local del servidor.

## 13) Uso rapido del portal temporal

- URL local: `http://localhost:8787/pre-registro` (o el puerto definido por `PORT`/`SYNC_SERVER_PORT`).
- Payload JSON esperado por `POST /api/public/pre-registrations`:
  - `firstName` (string, requerido)
  - `paternalLastName` (string, requerido)
  - `maternalLastName` (string, requerido)
  - `curp` (string de 18 caracteres, requerido)
  - `phone` (string, requerido)
  - `addressLine` (string, requerido)
  - `guardianFullName` (string, requerido)
  - `guardianPhone` (string, requerido)
