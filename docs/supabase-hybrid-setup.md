# Supabase híbrido para CBTA44_SYS

## Objetivo
- **Desktop local** sigue usando SQLite para contingencia offline.
- **Backend central** usa Supabase/Postgres como fuente de verdad compartida.
- **Renderer** habla con el backend híbrido; si no hay internet, cae a SQLite local y encola sync.

## Variables
Tomá como base:

- `E:\Users\Yajashop\Documents\PROGRAMACION\food_system\CBTA_Financieros\.env.backend.example`
- `E:\Users\Yajashop\Documents\PROGRAMACION\food_system\CBTA_Financieros\.env.client.cloud.example`

### Desktop local / cliente empaquetado
- `DATABASE_URL=file:./dev.db`
- `VITE_HYBRID_API_URL`
- `VITE_HYBRID_API_KEY`
- `VITE_SYNC_API_URL`
- `VITE_SYNC_API_KEY`

### Backend central
- `BACKEND_DATABASE_URL` → **pooler Supabase** para runtime Node
- `BACKEND_DIRECT_URL` → **direct connection** para `prisma db push`
- `SYNC_SERVER_PORT`
- `SYNC_SERVER_HOST`
- `SYNC_API_KEY`
- `SYNC_CORS_ORIGINS`

## Archivos clave
- `E:\Users\Yajashop\Documents\PROGRAMACION\food_system\CBTA_Financieros\prisma\schema.prisma` → SQLite local desktop
- `E:\Users\Yajashop\Documents\PROGRAMACION\food_system\CBTA_Financieros\prisma\schema.backend.prisma` → Postgres/Supabase backend
- `E:\Users\Yajashop\Documents\PROGRAMACION\food_system\CBTA_Financieros\backend\prisma.ts` → cliente Prisma backend central
- `E:\Users\Yajashop\Documents\PROGRAMACION\food_system\CBTA_Financieros\backend\sync-server.ts` → API híbrida y sync
- `E:\Users\Yajashop\Documents\PROGRAMACION\food_system\CBTA_Financieros\src\lib\hybrid-api.ts` → wrapper remoto/local del renderer

## Comandos
### Generar cliente Prisma local desktop
```bash
corepack pnpm prisma:generate
```

### Generar cliente Prisma backend
```bash
corepack pnpm prisma:generate:backend
```

### Validar schema backend
```bash
corepack pnpm prisma:validate:backend
```

### Aplicar schema backend a Supabase
```bash
corepack pnpm prisma:push:backend
```

### Seed base del backend central
```bash
corepack pnpm seed:backend
```

### Importación inicial de alumnos al backend central
```bash
corepack pnpm import:students:backend
```

### Levantar backend híbrido
```bash
corepack pnpm start:sync-server
```

## Seed actual del backend
El seed de backend carga de forma idempotente:
- usuarios base
- conceptos y tarifas
- requisitos documentales

La importación histórica de alumnos ya va por un comando separado para poblar la base central una sola vez, sin volver a tratar el Excel como fuente operativa.

## Estrategia operativa
1. **Carga inicial**: importar alumnos históricos a Supabase con `import:students:backend`.
2. **Con internet**: Caja y Control Escolar leen/escriben en Supabase vía backend.
3. **Sin internet**: la app usa SQLite local y mete cambios en `sync-queue`.
4. **Cuando vuelve internet**: `sync-service` empuja pendientes y luego refresca catálogos, cobros y alumnos.

## Nota importante
No le des la `service_role` ni la conexión directa de Supabase al renderer de Electron. Eso queda solo del lado del backend Node.
