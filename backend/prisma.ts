import { PrismaClient } from '@prisma/client'

declare global {
  var __cbtaSyncServerPrisma: PrismaClient | undefined
}

export const prisma = globalThis.__cbtaSyncServerPrisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__cbtaSyncServerPrisma = prisma
}
