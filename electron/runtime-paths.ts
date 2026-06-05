import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import * as path from 'node:path'

const APP_OUTPUT_DIRNAME = 'CBTA44_SYS'
const GENERATED_ROCS_DIRNAME = 'generated-rocs'
const PACKAGED_ASSETS_DIRNAME = 'assets'

export function getPackagedAssetPath(fileName: string) {
  const isPackaged = Boolean(app?.isPackaged)
  return isPackaged
    ? path.join(process.resourcesPath, PACKAGED_ASSETS_DIRNAME, fileName)
    : path.join(process.cwd(), fileName)
}

export function getGeneratedRocsDir() {
  const isPackaged = Boolean(app?.isPackaged)
  const outputDir = isPackaged
    ? path.join(app.getPath('documents'), APP_OUTPUT_DIRNAME, GENERATED_ROCS_DIRNAME)
    : path.join(process.cwd(), GENERATED_ROCS_DIRNAME)

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  return outputDir
}
