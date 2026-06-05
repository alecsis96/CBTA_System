# Backend en nube para Windows + Mac

## Escenario objetivo
- **Mac** usa la app para `Control Escolar`
- **Windows** usa la app para `Ingresos Propios`
- ambas hablan con el **mismo backend en nube**
- SQLite local queda como respaldo offline, no como fuente principal

## Arquitectura recomendada
```text
Mac app  ----\
              ---> backend híbrido (Node/Express) ---> Supabase/Postgres
Win app  ----/

si no hay internet:
  cada app sigue local y luego sincroniza
```

## Qué va en nube
- `backend/sync-server.ts`
- `prisma/schema.backend.prisma`
- seed base del backend
- importación inicial de alumnos

## Qué queda local en cada equipo
- la app Electron
- la base SQLite local
- la cola offline (`sync-queue`)

## Variables para el backend en nube
Basate en:
- `E:\Users\Yajashop\Documents\PROGRAMACION\food_system\CBTA_Financieros\.env.backend.example`

Valores importantes:
- `BACKEND_DATABASE_URL`
- `BACKEND_DIRECT_URL`
- `SYNC_SERVER_PORT`
- `SYNC_SERVER_HOST=0.0.0.0`
- `SYNC_API_KEY`
- `SYNC_CORS_ORIGINS=*`

## Variables para Windows y Mac
Basate en:
- `E:\Users\Yajashop\Documents\PROGRAMACION\food_system\CBTA_Financieros\.env.client.cloud.example`

Las dos apps deben apuntar a la misma URL:

```env
VITE_HYBRID_API_URL="https://tu-backend-hibrido.example.com"
VITE_HYBRID_API_KEY="tu-clave"
VITE_SYNC_API_URL="https://tu-backend-hibrido.example.com/api/sync/op"
VITE_SYNC_API_KEY="tu-clave"
```

## Orden correcto de despliegue
1. Crear proyecto Supabase
2. Configurar variables del backend
3. Correr:
   - `corepack pnpm prisma:push:backend`
   - `corepack pnpm seed:backend`
   - `corepack pnpm import:students:backend`
4. Desplegar `sync-server` en nube
5. Verificar:
   - `GET /`
   - `GET /healthz`
6. Generar app Windows y app Mac con las mismas variables cliente

## Chequeo funcional mínimo
1. Control Escolar crea/edita alumno en Mac
2. Windows refresca y lo ve
3. Windows registra cobro
4. Mac refresca y ve el cambio
5. Se genera ROC mensual desde Windows

## Riesgos / tradeoffs
### Cloud backend
**Pros**
- URL fija
- no depende de una PC “host”
- sirve mejor para Mac + Windows

**Contras**
- requiere despliegue y credenciales
- si no configurás bien CORS/keys, parece que “no conecta”

### Backend local en una PC
**Pros**
- rápido para pruebas

**Contras**
- frágil
- depende de IP/firewall/encendido de esa PC

## Recomendación
Para operación real:
- **backend en nube**
- **Supabase como base central**
- **Electron local como contingencia offline**
