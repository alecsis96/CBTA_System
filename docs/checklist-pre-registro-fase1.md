# Checklist tecnico sprint-ready: Pre-registro Internet (Fase 1)

## Sprint 1 (semana 1) - Fundaciones operativas

### Prioridad P0 - Backend/Electron IPC
- [ ] Crear modelos `PreRegistration` y `PreRegistrationAudit` en Prisma.
  - Criterio de aceptacion: `prisma validate` pasa y existe `status`, `folio`, timestamps y bitacora relacionada.
- [ ] Exponer IPC para pre-registro interno: `preRegistrations:list`, `preRegistrations:create`, `preRegistrations:updateStatus`.
  - Criterio de aceptacion: desde renderer se puede crear, listar y cambiar estatus de un pre-registro sin recargar app.
- [ ] Vincular aprobacion de Control Escolar con alumno interno.
  - Criterio de aceptacion: al marcar `VALIDADO_PARA_PAGO`, se crea/alinea `Student` para que aparezca en Ingresos Propios.

### Prioridad P0 - Control Escolar inbox
- [ ] Agregar bandeja de pre-registros en pantalla existente de Control Escolar.
  - Criterio de aceptacion: la tabla muestra folio, alumno, CURP, estatus y acciones de cambio de estado.
- [ ] Implementar acciones minimas: revisar, observar, aprobar.
  - Criterio de aceptacion: al ejecutar accion, el estatus cambia en BD y se refleja al refrescar data.

### Prioridad P1 - Voucher basico imprimible
- [ ] Agregar vista de voucher para item seleccionado de bandeja.
  - Criterio de aceptacion: muestra folio, alumno, CURP, fecha de envio, estatus e instruccion operativa.
- [ ] Habilitar impresion simple con `window.print()`.
  - Criterio de aceptacion: usuario puede imprimir desde boton sin dependencia de Excel.

### Prioridad P1 - Financieros
- [ ] Incluir pre-registros validados dentro de la fuente de alumnos para cobro.
  - Criterio de aceptacion: al aprobar en Control Escolar, el registro aparece en lista de seleccion de Ingresos Propios.

### Prioridad P1 - QA y pruebas manuales
- [ ] Validar regresion del flujo ROC actual.
  - Criterio de aceptacion: crear ROC para alumno validado existente sigue funcionando sin cambios de UX criticos.
- [ ] Ejecutar validaciones del repo.
  - Criterio de aceptacion: `corepack pnpm typecheck` y `corepack pnpm exec prisma validate` en verde.

## Sprint 2 (semana 2) - Consolidacion MVP

### Prioridad P1 - Portal publico (sin auth compleja)
- [ ] Implementar formulario web dedicado para alta de pre-registro (si se separa del backoffice).
  - Criterio de aceptacion: crea `PRE_REGISTRO_ENVIADO` y entrega voucher en una sola transaccion.
- [ ] Validaciones de entrada (CURP, correo, requeridos) y manejo de errores.
  - Criterio de aceptacion: inputs invalidos no persisten y muestran mensaje claro.

### Prioridad P2 - Operacion y trazabilidad
- [ ] Expandir bitacora de auditoria para cada transicion de estado.
  - Criterio de aceptacion: cada cambio deja rastro con actor y timestamp en `PreRegistrationAudit`.
- [ ] Agregar filtro por estatus/folio en bandeja.
  - Criterio de aceptacion: Control Escolar encuentra un caso en <= 10 segundos con filtros basicos.

### Prioridad P2 - QA manual guiada
- [ ] Diseñar checklist E2E pre-registro -> aprobacion -> cobro ROC.
  - Criterio de aceptacion: evidencia de prueba manual documentada con resultado por paso.
