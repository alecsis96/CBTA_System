import * as XLSX from 'xlsx'
import type { StudentImportIssueInput } from '../types/domain'
import { normalizeSheetCell, normalizeSheetHeader, normalizeSheetUpper, pickSheetValue } from '@/lib/text-utils'

type StudentDataCompletionFichaRow = {
  sheetName: string
  rowNumber: number
  sourcePath: string
  folio: string | null
  fullName: string
  curp: string
  sex: string | null
  age: number | null
  previousSchool: string | null
  locality: string | null
  phone: string | null
  email: string | null
  motherTongue: string | null
  guardianFullName: string | null
  guardianPhone: string | null
  secondaryAverage: number | null
}

type PropedeuticAreaImportRow = {
  sheetName: string
  rowNumber: number
  sourcePath: string
  controlNumber: string
  fullName: string
  curp: string
  previousGroup: string
  nextGroup: string
  career: string
  area: string
}

const FOLIO_ALIASES = ['no de ficha', 'no', 'folio']
const PATERNAL_LAST_NAME_ALIASES = ['apellido paterno']
const MATERNAL_LAST_NAME_ALIASES = ['apellido materno']
const NAME_ALIASES = ['nombre', 'nombre s']
const CURP_ALIASES = ['curp']
const SEX_ALIASES = ['sexo', 'genero']
const AGE_ALIASES = ['edad']
const PREVIOUS_SCHOOL_ALIASES = ['escuela de procedencia']
const AVERAGE_ALIASES = ['promedio']
const LOCALITY_ALIASES = ['localidad']
const GUARDIAN_NAME_ALIASES = ['nombre del tutor']
const STUDENT_PHONE_ALIASES = ['numero alumno', 'numero del alumno']
const GUARDIAN_PHONE_ALIASES = ['numero tutor', 'numero del tutor']
const EMAIL_ALIASES = ['correo electronico']
const MOTHER_TONGUE_ALIASES = ['lengua materna']

const CONTROL_NUMBER_ALIASES = ['no control', 'no. control', 'numero control', 'numero de control']
const FULL_NAME_ALIASES = ['nombre', 'nombre completo']
const PREVIOUS_GROUP_ALIASES = ['grupo']
const NEXT_GROUP_ALIASES = ['grupo nuevo']
const CAREER_ALIASES = ['carrera']
const AREA_ALIASES = ['area']

export async function pickStudentDataWorkbookFiles(options?: { multiple?: boolean }) {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xls,.xlsm'
    input.multiple = options?.multiple ?? false
    input.onchange = () => resolve(Array.from(input.files ?? []))
    input.oncancel = () => resolve([])
    input.click()
  })
}

function parseAge(value: unknown) {
  const parsed = Number(normalizeSheetCell(value))
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 120 ? parsed : null
}

function parseAverage(value: unknown) {
  const parsed = Number(normalizeSheetCell(value))
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10 ? parsed : null
}

function hasValidCurp(curp: string) {
  return /^[A-Z0-9]{18}$/.test(curp)
}

function rowObject(headers: unknown[], row: unknown[]) {
  return Object.fromEntries(headers.map((header, index) => [normalizeSheetCell(header), row[index] ?? '']))
}

async function readWorkbook(file: File) {
  const buffer = await file.arrayBuffer()
  return XLSX.read(buffer, { type: 'array' })
}

export async function parseFichaCompletionWorkbooks(files: File[]) {
  const rows: StudentDataCompletionFichaRow[] = []
  const issues: string[] = []
  const rejectedRows: StudentImportIssueInput[] = []

  const addRejectedRow = (issue: StudentImportIssueInput) => {
    rejectedRows.push(issue)
    issues.push(`Fila ${issue.rowNumber ?? '?'} en ${issue.sheetName ?? issue.importKind ?? 'archivo'}: ${issue.reason}`)
  }

  for (const file of files) {
    const workbook = await readWorkbook(file)
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) continue
      const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
      const headerRowIndex = sheetRows.findIndex((row) =>
        Array.isArray(row) &&
        row.some((cell) => normalizeSheetHeader(cell) === 'curp') &&
        row.some((cell) => normalizeSheetHeader(cell) === 'apellido paterno'),
      )
      if (headerRowIndex < 0) continue

      const headers = Array.isArray(sheetRows[headerRowIndex]) ? sheetRows[headerRowIndex] : []
      for (let rowIndex = headerRowIndex + 1; rowIndex < sheetRows.length; rowIndex += 1) {
        const rawRow = Array.isArray(sheetRows[rowIndex]) ? sheetRows[rowIndex] : []
        const row = rowObject(headers, rawRow)
        const rowNumber = rowIndex + 1
        const folio = normalizeSheetCell(pickSheetValue(row, FOLIO_ALIASES)) || null
        const paternalLastName = normalizeSheetUpper(pickSheetValue(row, PATERNAL_LAST_NAME_ALIASES))
        const maternalLastName = normalizeSheetUpper(pickSheetValue(row, MATERNAL_LAST_NAME_ALIASES))
        const names = normalizeSheetUpper(pickSheetValue(row, NAME_ALIASES))
        const curp = normalizeSheetUpper(pickSheetValue(row, CURP_ALIASES))
        const fullName = `${paternalLastName} ${maternalLastName} ${names}`.trim()

        if (!folio && !fullName && !curp) continue
        if (!curp || !hasValidCurp(curp)) {
          addRejectedRow({
            sheetName,
            rowNumber,
            importKind: 'FICHA_COMPLETAR',
            enrollmentNumber: folio,
            curp: curp || null,
            fullName: fullName || null,
            reason: curp ? 'CURP_INVALIDA' : 'CURP_FALTANTE',
            rawJson: JSON.stringify(row),
          })
          continue
        }

        rows.push({
          sheetName,
          rowNumber,
          sourcePath: file.name,
          folio,
          fullName,
          curp,
          sex: normalizeSheetUpper(pickSheetValue(row, SEX_ALIASES)) || null,
          age: parseAge(pickSheetValue(row, AGE_ALIASES)),
          previousSchool: normalizeSheetCell(pickSheetValue(row, PREVIOUS_SCHOOL_ALIASES)) || null,
          locality: normalizeSheetCell(pickSheetValue(row, LOCALITY_ALIASES)) || null,
          phone: normalizeSheetCell(pickSheetValue(row, STUDENT_PHONE_ALIASES)) || null,
          email: normalizeSheetCell(pickSheetValue(row, EMAIL_ALIASES)) || null,
          motherTongue: normalizeSheetCell(pickSheetValue(row, MOTHER_TONGUE_ALIASES)) || null,
          guardianFullName: normalizeSheetUpper(pickSheetValue(row, GUARDIAN_NAME_ALIASES)) || null,
          guardianPhone: normalizeSheetCell(pickSheetValue(row, GUARDIAN_PHONE_ALIASES)) || null,
          secondaryAverage: parseAverage(pickSheetValue(row, AVERAGE_ALIASES)),
        })
      }
    }
  }

  return { rows, issues, rejectedRows }
}

export async function parsePropedeuticAreaWorkbook(file: File) {
  const workbook = await readWorkbook(file)
  const sheetName = workbook.SheetNames.includes('RepRediSemestral') ? 'RepRediSemestral' : workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows: PropedeuticAreaImportRow[] = []
  const issues: string[] = []
  const rejectedRows: StudentImportIssueInput[] = []

  if (!sheet) {
    return { rows, issues: ['No se encontro una hoja para importar areas propedeuticas.'], rejectedRows }
  }

  const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
  const headerRowIndex = sheetRows.findIndex((row) =>
    Array.isArray(row) &&
    row.some((cell) => normalizeSheetHeader(cell) === 'curp') &&
    row.some((cell) => normalizeSheetHeader(cell) === 'grupo nuevo'),
  )
  if (headerRowIndex < 0) {
    return { rows, issues: ['No se encontro encabezado con CURP y GRUPO NUEVO.'], rejectedRows }
  }

  const headers = Array.isArray(sheetRows[headerRowIndex]) ? sheetRows[headerRowIndex] : []
  for (let rowIndex = headerRowIndex + 1; rowIndex < sheetRows.length; rowIndex += 1) {
    const rawRow = Array.isArray(sheetRows[rowIndex]) ? sheetRows[rowIndex] : []
    const row = rowObject(headers, rawRow)
    const rowNumber = rowIndex + 1
    const controlNumber = normalizeSheetCell(pickSheetValue(row, CONTROL_NUMBER_ALIASES))
    const curp = normalizeSheetUpper(pickSheetValue(row, CURP_ALIASES))
    const fullName = normalizeSheetUpper(pickSheetValue(row, FULL_NAME_ALIASES))
    const previousGroup = normalizeSheetUpper(pickSheetValue(row, PREVIOUS_GROUP_ALIASES))
    const nextGroup = normalizeSheetUpper(pickSheetValue(row, NEXT_GROUP_ALIASES))
    const career = normalizeSheetUpper(pickSheetValue(row, CAREER_ALIASES))
    const area = normalizeSheetUpper(pickSheetValue(row, AREA_ALIASES))

    if (!controlNumber && !curp && !fullName) continue
    if (!controlNumber || !curp || !hasValidCurp(curp) || !nextGroup || !career || !area) {
      rejectedRows.push({
        sheetName,
        rowNumber,
        importKind: 'AREA_PROPEDEUTICA',
        enrollmentNumber: controlNumber || null,
        curp: curp || null,
        fullName: fullName || null,
        groupLabel: nextGroup || null,
        reason: !curp || !hasValidCurp(curp) ? 'CURP_INVALIDA' : 'FALTAN_DATOS_AREA',
        rawJson: JSON.stringify(row),
      })
      issues.push(`Fila ${rowNumber} en ${sheetName}: faltan datos obligatorios o la CURP es invalida.`)
      continue
    }

    rows.push({ sheetName, rowNumber, sourcePath: file.name, controlNumber, fullName, curp, previousGroup, nextGroup, career, area })
  }

  return { rows, issues, rejectedRows }
}
