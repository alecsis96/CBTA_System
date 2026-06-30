import * as XLSX from 'xlsx'
import type { GroupRosterImportRow } from '@/types/domain'
import {
  normalizeSheetCell,
  normalizeSheetUpper,
  normalizeSheetHeader,
  pickSheetValue,
  normalizeImportedGroupLabel,
} from '@/lib/text-utils'
import {
  GROUP_COLUMN_ALIASES,
  ENROLLMENT_COLUMN_ALIASES,
  CURP_COLUMN_ALIASES,
} from '@/lib/import-constants'

export async function pickRosterWorkbookFile() {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xls'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

export async function parseRosterWorkbook(file: File) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const rows: GroupRosterImportRow[] = []
  const issues: string[] = []
  let skippedCount = 0

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const populatedCells = Object.keys(sheet)
      .filter((key) => !key.startsWith('!'))
      .map((key) => XLSX.utils.decode_cell(key))
    if (populatedCells.length === 0) {
      continue
    }

    const range = populatedCells.reduce(
      (acc, cell) => ({
        s: {
          r: Math.min(acc.s.r, cell.r),
          c: Math.min(acc.s.c, cell.c),
        },
        e: {
          r: Math.max(acc.e.r, cell.r),
          c: Math.max(acc.e.c, cell.c),
        },
      }),
      {
        s: { r: populatedCells[0].r, c: populatedCells[0].c },
        e: { r: populatedCells[0].r, c: populatedCells[0].c },
      },
    )

    const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', range })
    const wideHeaderIndex = sheetRows.findIndex((row) => {
      if (!Array.isArray(row)) return false
      const normalized = row.map((cell) => normalizeSheetHeader(cell))
      const folioCount = normalized.filter((cell) => cell === 'folio').length
      const groupCount = normalized.filter((cell) => cell === 'grupo').length
      return folioCount >= 2 && groupCount >= 2
    })

    if (wideHeaderIndex >= 0) {
      for (let rowIndex = wideHeaderIndex + 1; rowIndex < sheetRows.length; rowIndex += 1) {
        const row = Array.isArray(sheetRows[rowIndex]) ? sheetRows[rowIndex] : []
        let hasAnyValue = false
        for (let columnIndex = 0; columnIndex < row.length; columnIndex += 2) {
          const groupLabel = normalizeImportedGroupLabel(row[columnIndex]) || normalizeImportedGroupLabel(sheetName)
          const enrollmentNumber = normalizeSheetCell(row[columnIndex + 1]) || null
          const rowNumber = rowIndex + 1

          if (!groupLabel && !enrollmentNumber) {
            continue
          }

          hasAnyValue = true

          if (!groupLabel) {
            skippedCount += 1
            issues.push(`Fila ${rowNumber} en ${sheetName}: falta Grupo.`)
            continue
          }

          if (!enrollmentNumber) {
            skippedCount += 1
            issues.push(`Fila ${rowNumber} en ${sheetName}: falta Folio interno.`)
            continue
          }

          rows.push({
            sheetName,
            rowNumber,
            groupLabel,
            enrollmentNumber,
            curp: null,
          })
        }
        if (!hasAnyValue) {
          break
        }
      }
      continue
    }

    const headerRowIndex = sheetRows.findIndex((row) => Array.isArray(row) && row.some((cell) => {
      const header = normalizeSheetHeader(cell)
      return GROUP_COLUMN_ALIASES.includes(header) || header === 'columna1' || ENROLLMENT_COLUMN_ALIASES.includes(header) || CURP_COLUMN_ALIASES.includes(header)
    }))
    if (headerRowIndex < 0) {
      continue
    }

    const headers = (Array.isArray(sheetRows[headerRowIndex]) ? sheetRows[headerRowIndex] : []).map((cell) => normalizeSheetCell(cell))
    for (let rowIndex = headerRowIndex + 1; rowIndex < sheetRows.length; rowIndex += 1) {
      const rawRow = Array.isArray(sheetRows[rowIndex]) ? sheetRows[rowIndex] : []
      const row = Object.fromEntries(headers.map((header, index) => [header, rawRow[index] ?? '']))
      const rowNumber = rowIndex + 1
      const groupLabel = normalizeImportedGroupLabel(pickSheetValue(row, [...GROUP_COLUMN_ALIASES, 'columna1'])) || normalizeImportedGroupLabel(sheetName)
      const enrollmentNumber = normalizeSheetCell(pickSheetValue(row, ENROLLMENT_COLUMN_ALIASES)) || null
      const curp = normalizeSheetUpper(pickSheetValue(row, CURP_COLUMN_ALIASES)) || null

      if (!groupLabel && !enrollmentNumber && !curp) {
        continue
      }

      if (!groupLabel) {
        skippedCount += 1
        issues.push(`Fila ${rowNumber} en ${sheetName}: falta Grupo.`)
        continue
      }

      if (!enrollmentNumber && !curp) {
        skippedCount += 1
        issues.push(`Fila ${rowNumber} en ${sheetName}: agrega CURP o Folio interno.`)
        continue
      }

      rows.push({
        sheetName,
        rowNumber,
        groupLabel,
        enrollmentNumber,
        curp,
      })
    }
  }

  return { rows, skippedCount, issues }
}
