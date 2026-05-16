import { app, shell } from 'electron'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

type RocTemplateLine = {
  code: string
  name: string
  amount: number
}

type RocTemplatePayload = {
  rocNumber: string
  fullName: string
  identifier: string
  address: string
  grade: string
  group: string
  shift: string
  printDate: string
  totalAmount: number
  amountInWords: string
  lines: RocTemplateLine[]
}

export function fillOfficialRocTemplate(payload: RocTemplatePayload) {
  const appPath = app.getAppPath()
  const templatePath = path.join(appPath, 'roc 2026.xlsx')
  const outputDir = path.join(appPath, 'generated-rocs')

  if (!fs.existsSync(templatePath)) {
    throw new Error('No se encontro la plantilla oficial roc 2026.xlsx en la raiz del proyecto.')
  }

  fs.mkdirSync(outputDir, { recursive: true })

  const safeRoc = payload.rocNumber.replace(/[^a-zA-Z0-9-_]/g, '_')
  const outputPath = path.join(outputDir, `${safeRoc}-${Date.now()}.xlsx`)
  const scriptPath = path.join(appPath, 'electron', 'roc-template.ps1')
  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')

  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, templatePath, outputPath, payloadBase64],
    { stdio: 'pipe' },
  )

  return outputPath
}

export async function openOfficialRocTemplate(payload: RocTemplatePayload) {
  const outputPath = fillOfficialRocTemplate(payload)
  const openResult = await shell.openPath(outputPath)

  if (openResult) {
    throw new Error(openResult)
  }

  return outputPath
}
