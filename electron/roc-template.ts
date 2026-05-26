import { app, shell } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as XLSX from 'xlsx'

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
  fs.copyFileSync(templatePath, outputPath)

  const workbook = XLSX.readFile(outputPath, { cellStyles: true, cellFormula: true })
  const firstSheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheetName]

  const setCell = (address: string, value: string | number) => {
    if (typeof value === 'number') {
      sheet[address] = { t: 'n', v: value }
      return
    }

    sheet[address] = { t: 's', v: value }
  }

  setCell('N4', payload.rocNumber)
  setCell('J7', payload.printDate)
  setCell('C10', payload.fullName)
  setCell('K11', payload.identifier)
  setCell('C14', payload.address)
  setCell('L14', payload.grade)
  setCell('N14', payload.group)
  setCell('O14', payload.shift)

  setCell('E17', payload.totalAmount)
  setCell('F17', `(${payload.amountInWords})`)

  const detailRows = [20, 21, 22]
  for (const row of detailRows) {
    const clearCols = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N']
    for (const col of clearCols) {
      delete sheet[`${col}${row}`]
    }
  }

  for (let i = 0; i < payload.lines.length && i < detailRows.length; i += 1) {
    const row = detailRows[i]
    const line = payload.lines[i]
    setCell(`D${row}`, 1)
    setCell(`E${row}`, line.code)
    setCell(`F${row}`, line.name)
    setCell(`J${row}`, line.amount)
    setCell(`N${row}`, line.amount)
  }

  setCell('N23', payload.totalAmount)

  XLSX.writeFile(workbook, outputPath)

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
