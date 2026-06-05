# Deploy en Render + Supabase para CBTA44_SYS

## Arquitectura recomendada
- **Render** corre el backend híbrido (`sync-server`)
- **Supabase** guarda la base central compartida
- **Windows** y **Mac** corren la app Electron apuntando al mismo backend
- **SQLite local** queda como contingencia offline

## Qué problema resuelve
Esto evita:
- depender de una PC host prendida
- pelear con IP local cambiante
- romper la comunicación entre `Control Escolar` y `Ingresos Propios`

## Archivos preparados
- `E:\Users\Yajashop\Documents\PROGRAMACION\food_system\CBTA_Financieros\render.yaml`
- `E:\Users\Yajashop\Documents\PROGRAMACION\food_system\CBTA_Financieros\.env.backend.example`
- `E:\Users\Yajashop\Documents\PROGRAMACION\food_system\CBTA_Financieros\.env.client.cloud.example`

## Variables del backend en Render
Cargá estas variables en el servicio web:

- `BACKEND_DATABASE_URL`
- `BACKEND_DIRECT_URL`
- `SYNC_API_KEY`
- `SYNC_SERVER_HOST=0.0.0.0`
- `SYNC_SERVER_PORT=8787`
- `SYNC_CORS_ORIGINS=*`

## Variables de clientes Windows y Mac
Las dos apps deben compartir estas variables al empaquetar:

```env
VITE_HYBRID_API_URL="https://TU-SERVICIO.onrender.com"
VITE_HYBRID_API_KEY="TU_SYNC_API_KEY"
VITE_SYNC_API_URL="https://TU-SERVICIO.onrender.com/api/sync/op"
VITE_SYNC_API_KEY="TU_SYNC_API_KEY"
```

## Orden correcto
1. Crear o confirmar proyecto Supabase
2. Crear servicio web en Render
3. Cargar variables del backend
4. Desplegar el backend
5. Verificar:
   - `GET /`
   - `GET /healthz`
6. Aplicar schema backend:
   - `corepack pnpm prisma:push:backend`
7. Seed base:
   - `corepack pnpm seed:backend`
8. Importar alumnos:
   - `corepack pnpm import:students:backend`
9. Generar Windows y Mac con la misma URL del backend

## Endpoints mínimos a probar
- `https://TU-SERVICIO.onrender.com/`
- `https://TU-SERVICIO.onrender.com/healthz`
- `https://TU-SERVICIO.onrender.com/api/hybrid/students`

## Importante sobre Render Free
- el servicio se duerme tras ~15 minutos sin tráfico
- al despertar puede tardar cerca de 1 minuto
- sirve para prueba o piloto
- para operación seria conviene subir el web service a pago

## Recomendación realista
### Para probar
- Render Free + Supabase

### Para operar en serio
- backend Render pago
- Supabase como base central
- clientes Mac/Windows apuntando a esa URL fija
