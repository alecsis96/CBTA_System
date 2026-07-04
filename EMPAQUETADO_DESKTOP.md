# Generar DMG y EXE portable

Este proyecto usa Electron Builder desde los scripts definidos en `package.json`.
Los artefactos se generan en la carpeta `release/`.

## Requisitos previos

- Tener Node.js con Corepack habilitado.
- Instalar dependencias desde la raiz del repositorio:

```bash
corepack pnpm install
```

- En la primera instalacion despues de clonar, aprobar los scripts nativos requeridos:

```bash
corepack pnpm approve-builds --all
```

- Verificar que existan estos archivos en la raiz antes de empaquetar:
  - `roc 2026.xlsx`
  - `FICHAS 2026.xlsx`
  - `prisma/dev.db`

## Validacion recomendada

Antes de generar paquetes, ejecutar:

```bash
corepack pnpm typecheck
corepack pnpm exec prisma validate
```

Si hubo cambios en `prisma/schema.prisma`, regenerar cliente y actualizar la base local:

```bash
corepack pnpm exec prisma generate
corepack pnpm exec prisma db push
```

## Generar EXE portable para Windows

Ejecutar en Windows:

```bash
corepack pnpm run dist:win:portable
```

Salida esperada:

- `release/CBTA44_SYS-<version>-x64-portable.exe`
- `release/CBTA44_SYS-<version>-ia32-portable.exe`

El script cierra procesos abiertos de `CBTA44_SYS.exe` y `electron.exe`, limpia `release/win-unpacked`, genera Prisma Client, sincroniza el runtime de Prisma, compila Vite/Electron y empaqueta el portable.

## Generar DMG para macOS

Ejecutar en macOS:

```bash
corepack pnpm run dist:mac
```

Salida esperada:

- `release/CBTA44_SYS-<version>.dmg`

Nota: el DMG debe generarse en macOS. Electron Builder no genera DMG de forma confiable desde Windows.

## Archivos incluidos en el paquete

La configuracion de Electron Builder incluye:

- `dist/`
- `dist-electron/`
- Prisma Client y motores necesarios
- `prisma/schema.prisma`
- `prisma/dev.db`
- `roc 2026.xlsx`
- `FICHAS 2026.xlsx`

En la app empaquetada, `prisma/dev.db` se usa como plantilla inicial. La base real de trabajo se copia al perfil del usuario para conservar datos entre ejecuciones o actualizaciones.

## Limpieza opcional

Si se quiere regenerar desde cero, borrar la carpeta `release/` y volver a ejecutar el comando correspondiente.

En Windows, cerrar la app antes de empaquetar si queda una instancia abierta.
