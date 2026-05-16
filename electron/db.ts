import { PrismaClient } from '@prisma/client'

declare global {
  var __cbtaPrisma: PrismaClient | undefined
}

export const prisma = globalThis.__cbtaPrisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__cbtaPrisma = prisma
}
