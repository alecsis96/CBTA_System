# Guia de instalacion - CBTA 44 Sistema

Esta guia instala el sistema en una computadora nueva para operacion local.

## 1) Requisitos previos

- Node.js 20 o superior
- Git
- Internet para instalar dependencias (solo durante instalacion/actualizacion)
- Windows 10/11 o macOS

Nota:
- El sistema trabaja offline una vez instalado.
- La base local usa SQLite (`prisma/dev.db`).

### Requisitos sugeridos en macOS

Si no tenes Node/Git instalados en Mac:

```bash
brew install node git
```

Luego verificar:

```bash
node -v
git --version
```

## 2) Clonar proyecto

```bash
git clone https://github.com/alecsis96/CBTA_System.git
cd CBTA_System
```

Si el nombre de carpeta local cambia, no pasa nada.

## 3) Instalar dependencias

```bash
corepack pnpm install
corepack pnpm approve-builds --all
```

`approve-builds` es necesario en la primera instalacion para Prisma/Electron.

## 4) Configurar variables de entorno

Crear archivo `.env` en la raiz con este contenido minimo:

```env
DATABASE_URL="file:./dev.db"
VITE_SYNC_API_URL=""
VITE_SYNC_API_KEY=""
SYNC_API_KEY=""
SYNC_SERVER_PORT="8787"
```

Notas:
- `DATABASE_URL="file:./dev.db"` apunta a `prisma/dev.db` (correcto para este repo).
- Si no van a usar sync por internet todavia, pueden dejar vacias las variables `SYNC`.

## 5) Preparar base de datos local

```bash
corepack pnpm exec prisma generate
corepack pnpm exec prisma db push
```

Esto crea/actualiza la estructura de la base local.

## 6) Cargar datos base

Al iniciar la app se ejecuta la carga base automaticamente.

Actualmente la semilla toma alumnos desde `FICHAS 2026.xlsx` en la raiz del proyecto.

Si ese archivo no esta, la app sigue abriendo, pero no cargara el padron inicial esperado.

## 7) Iniciar sistema (modo desarrollo operativo)

```bash
corepack pnpm dev
```

Esto abre Electron con el frontend listo para operar.

## 8) Validacion recomendada

Antes de usar en operacion:

```bash
corepack pnpm typecheck
corepack pnpm exec prisma validate
```

Si ambos pasan, la instalacion esta correcta.

## 9) Credenciales de acceso (desarrollo)

Revisar:

- `docs/credenciales-dev.md`

## 10) Actualizar instalacion existente

En la carpeta del proyecto:

```bash
git pull
corepack pnpm install
corepack pnpm exec prisma generate
corepack pnpm exec prisma db push
corepack pnpm dev
```

## 10.1) Notas especificas para macOS

- Los comandos del proyecto son los mismos.
- La ruta de salida en documentos usa la carpeta de usuario de macOS.
- Si Gatekeeper muestra advertencias al abrir Electron por primera vez:
  - abrir una vez desde Finder y confirmar "Abrir"
  - o permitir la app en `Configuracion del Sistema > Privacidad y seguridad`
- Si `corepack` no esta habilitado:

```bash
corepack enable
```

Y volver a correr:

```bash
corepack pnpm install
```

## 11) Respaldo rapido de base local

Para respaldo manual del estado local:

- copiar archivo `prisma/dev.db` a otra ubicacion segura

Para restaurar:

- cerrar app
- reemplazar `prisma/dev.db` por el respaldo
- abrir app de nuevo

## 12) Problemas comunes

1. Error de Prisma/archivo bloqueado
- Cerrar Electron y volver a correr `prisma db push`.

2. No abre ROC oficial
- Verificar que existe `roc 2026.xlsx` en la raiz.

3. No aparecen alumnos iniciales
- Verificar que existe `FICHAS 2026.xlsx` en la raiz.
- Reiniciar app para relanzar carga base.

4. Typecheck falla
- Ejecutar `corepack pnpm install` y repetir `corepack pnpm typecheck`.

5. Electron no abre en Mac por permisos
- Confirmar permisos en `Privacidad y seguridad` y reintentar `corepack pnpm dev`.

## 13) Generar instalador .exe (Windows)

Para crear un instalador para usuarios finales:

```bash
corepack pnpm install
corepack pnpm run dist:win
```

Salida:
- carpeta `release/`
- instalador tipo `CBTA44_SYS-<version>-<arch>.exe`

Opcional (version portable):

```bash
corepack pnpm run dist:win:portable
```

Notas de despliegue:
- El build incluye `roc 2026.xlsx` y `FICHAS 2026.xlsx`.
- En modo instalado, la base SQLite se guarda en el perfil del usuario (`userData`) para no perder datos al actualizar la app.
