import { PrismaClient } from '../prisma/generated/backend-client'

declare global {
  var __cbtaSyncServerPrisma: PrismaClient | undefined
}

if (!process.env.BACKEND_DATABASE_URL) {
  throw new Error('[backend] Falta BACKEND_DATABASE_URL para el servidor central Supabase/Postgres.')
}

export const prisma = globalThis.__cbtaSyncServerPrisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__cbtaSyncServerPrisma = prisma
}
