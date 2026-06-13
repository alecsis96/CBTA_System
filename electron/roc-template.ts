import { shell } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildOfficialRocWorkbookBuffer, type OfficialRocPayload } from '../shared/roc-template-workbook'
import { getGeneratedRocsDir, getPackagedAssetPath } from './runtime-paths'

export type RocTemplateLine = OfficialRocPayload['lines'][number]
export type RocTemplatePayload = OfficialRocPayload

function getOfficialTemplatePath() {
  const templatePath = getPackagedAssetPath('roc 2026.xlsx')

  if (!fs.existsSync(templatePath)) {
    throw new Error('No se encontro la plantilla oficial roc 2026.xlsx en los recursos de la aplicacion.')
  }

  return templatePath
}

async function saveOfficialWorkbook(buffer: Buffer, outputFileName: string) {
  const outputDir = getGeneratedRocsDir()
  await fs.promises.mkdir(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, outputFileName)
  await fs.promises.writeFile(outputPath, buffer)
  return outputPath
}

function safeFileLabel(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]/g, '_')
}

export async function fillOfficialRocTemplate(payload: RocTemplatePayload) {
  const safeRoc = safeFileLabel(payload.rocNumber)
  const buffer = await buildOfficialRocWorkbookBuffer(getOfficialTemplatePath(), [payload])
  return saveOfficialWorkbook(buffer, `${safeRoc}-${Date.now()}.xlsx`)
}

export async function exportOfficialRocTemplateBatch(payloads: RocTemplatePayload[], fileLabel: string) {
  const safeLabel = safeFileLabel(fileLabel)
  const buffer = await buildOfficialRocWorkbookBuffer(getOfficialTemplatePath(), payloads)
  return saveOfficialWorkbook(buffer, `${safeLabel}-${Date.now()}.xlsx`)
}

export async function openOfficialRocTemplate(payload: RocTemplatePayload) {
  const outputPath = await fillOfficialRocTemplate(payload)
  const openResult = await shell.openPath(outputPath)

  if (openResult) {
    throw new Error(openResult)
  }

  return outputPath
}
