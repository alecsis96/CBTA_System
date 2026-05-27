import { PrismaClient } from '@prisma/client'
import {
  getLocalDbPath as getLocalDbPathFromBootstrap,
  getPackagedTemplateDbPath as getPackagedTemplateDbPathFromBootstrap,
} from './db-bootstrap'

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${getLocalDbPathFromBootstrap().replace(/\\/g, '/')}`
}

declare global {
  var __cbtaPrisma: PrismaClient | undefined
}

function createPrismaClient() {
  return new PrismaClient()
}

export let prisma = globalThis.__cbtaPrisma ?? createPrismaClient()

export async function resetPrismaClient() {
  await prisma.$disconnect()
  prisma = createPrismaClient()

  if (process.env.NODE_ENV !== 'production') {
    globalThis.__cbtaPrisma = prisma
  }
}

export function getPackagedTemplateDbPath() {
  return getPackagedTemplateDbPathFromBootstrap()
}

export function getLocalDbPath() {
  return getLocalDbPathFromBootstrap()
}

if (process.env.NODE_ENV !== 'production') {
  globalThis.__cbtaPrisma = prisma
}
