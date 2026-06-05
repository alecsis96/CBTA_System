import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const pnpmStoreDir = path.join(projectRoot, 'node_modules', '.pnpm')
const prismaClientStoreEntry = readdirSync(pnpmStoreDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^@prisma\+client@.*_prisma@/.test(entry.name))
  .map((entry) => entry.name)
  .sort()
  .at(-1)

const source = prismaClientStoreEntry
  ? path.join(pnpmStoreDir, prismaClientStoreEntry, 'node_modules', '.prisma', 'client')
  : null

if (!source || !existsSync(source)) {
  throw new Error('Prisma generated client not found under pnpm store.')
}

const prismaRuntimeDir = path.join(projectRoot, 'node_modules', '.prisma')
const target = path.join(prismaRuntimeDir, 'client')

mkdirSync(prismaRuntimeDir, { recursive: true })
rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true, force: true })
