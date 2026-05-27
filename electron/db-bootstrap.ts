import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import * as path from 'node:path'

export function getPackagedTemplateDbPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'prisma', 'dev.db')
    : path.join(process.cwd(), 'prisma', 'dev.db')
}

export function getLocalDbPath() {
  return path.join(app.getPath('userData'), 'cbta44_sys.db')
}

export function initializeDatabaseEnvironment() {
  const localDbPath = getLocalDbPath()
  const packagedTemplateDbPath = getPackagedTemplateDbPath()

  if (app.isPackaged) {
    const shouldCopyTemplate = !existsSync(localDbPath) || statSync(localDbPath).size === 0
    if (shouldCopyTemplate && existsSync(packagedTemplateDbPath)) {
      mkdirSync(path.dirname(localDbPath), { recursive: true })
      copyFileSync(packagedTemplateDbPath, localDbPath)
    }
  }

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = `file:${localDbPath.replace(/\\/g, '/')}`
  }
}
