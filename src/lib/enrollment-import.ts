import * as XLSX from 'xlsx'
import type { EnrollmentRosterImportRow, SemesterLevel } from '@/types/domain'
import {
  normalizeSheetCell,
  normalizeSheetHeader,
  normalizeSheetUpper,
  pickSheetValue,
} from '@/lib/text-utils'

const ENROLLMENT_ALIASES = ['no control', 'numero control', 'numero de control', 'matricula']
const NAME_ALIASES = ['nombre', 'nombre completo', 'alumno']
const CURP_ALIASES = ['curp']
const SEX_ALIASES = ['genero', 'sexo']
const AGE_ALIASES = ['edad']
const GROUP_ALIASES = ['grupo']
const CAREER_ALIASES = ['carrera', 'especialidad']
const FOLIO_ALIASES = ['no', 'folio']
const PATERNAL_LAST_NAME_ALIASES = ['apellido paterno']
const MATERNAL_LAST_NAME_ALIASES = ['apellido materno']
const PREVIOUS_SCHOOL_ALIASES = ['escuela de procedencia']
const AVERAGE_ALIASES = ['promedio']
const LOCALITY_ALIASES = ['localidad']
const GUARDIAN_NAME_ALIASES = ['nombre del tutor']
const STUDENT_PHONE_ALIASES = ['numero alumno']
const GUARDIAN_PHONE_ALIASES = ['numero tutor']
const EMAIL_ALIASES = ['correo electronico']
const MOTHER_TONGUE_ALIASES = ['lengua materna']

export async function pickEnrollmentWorkbookFile() {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xls'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

function inferSemesterFromSheet(sheetName: string): SemesterLevel | null {
  const normalized = normalizeSheetHeader(sheetName)
  if (normalized.includes('segundo')) return 2
  if (normalized.includes('cuarto')) return 4
  if (normalized.includes('sexto')) return 6
  if (normalized.includes('primero')) return 1
  if (normalized.includes('tercero')) return 3
  if (normalized.includes('quinto')) return 5
  return null
}

function parseAge(value: unknown) {
  const parsed = Number(normalizeSheetCell(value))
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 120 ? parsed : null
}

function buildGroupLabel(semesterLevel: SemesterLevel, group: string, career: string | null) {
  const normalizedGroup = normalizeSheetUpper(group)
  const normalizedCareer = normalizeSheetUpper(career)
  return [String(semesterLevel) + normalizedGroup, normalizedCareer].filter(Boolean).join('-')
}

function parseNumber(value: unknown) {
  const parsed = Number(normalizeSheetCell(value))
  return Number.isFinite(parsed) ? parsed : null
}

function buildFichaEnrollmentNumber(schoolYear: string, folio: string) {
  return `FICHA-${schoolYear}-${folio.padStart(4, '0')}`
}

function hasValidCurpLength(curp: string) {
  return curp.length === 18
}

export async function parseEnrollmentWorkbook(file: File) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const rows: EnrollmentRosterImportRow[] = []
  const issues: string[] = []
  let skippedCount = 0

  for (const sheetName of workbook.SheetNames) {
    const semesterLevel = inferSemesterFromSheet(sheetName)
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
    const fichaHeaderRowIndex = sheetRows.findIndex((row) => Array.isArray(row) && row.some((cell) => normalizeSheetHeader(cell) === 'apellido paterno') && row.some((cell) => normalizeSheetHeader(cell) === 'curp'))
    if (fichaHeaderRowIndex >= 0) {
      const headers = (Array.isArray(sheetRows[fichaHeaderRowIndex]) ? sheetRows[fichaHeaderRowIndex] : []).map((cell) => normalizeSheetCell(cell))
      for (let rowIndex = fichaHeaderRowIndex + 1; rowIndex < sheetRows.length; rowIndex += 1) {
        const rawRow = Array.isArray(sheetRows[rowIndex]) ? sheetRows[rowIndex] : []
        const row = Object.fromEntries(headers.map((header, index) => [header, rawRow[index] ?? '']))
        const rowNumber = rowIndex + 1
        const folio = normalizeSheetCell(pickSheetValue(row, FOLIO_ALIASES))
        const paternalLastName = normalizeSheetUpper(pickSheetValue(row, PATERNAL_LAST_NAME_ALIASES))
        const maternalLastName = normalizeSheetUpper(pickSheetValue(row, MATERNAL_LAST_NAME_ALIASES))
        const names = normalizeSheetUpper(pickSheetValue(row, NAME_ALIASES))
        const curp = normalizeSheetUpper(pickSheetValue(row, CURP_ALIASES))
        const group = normalizeSheetUpper(pickSheetValue(row, ['columna1', ...GROUP_ALIASES]))

        if (!folio && !paternalLastName && !names && !curp) continue

        if (!folio || !paternalLastName || !names || !curp || !group) {
          skippedCount += 1
          issues.push(`Fila ${rowNumber} en ${sheetName}: faltan folio, nombre, CURP o grupo de ficha.`)
          continue
        }

        if (!hasValidCurpLength(curp)) {
          skippedCount += 1
          issues.push(`Fila ${rowNumber} en ${sheetName}: CURP invalida para folio ${folio} (${curp.length} caracteres).`)
          continue
        }

        rows.push({
          sheetName,
          rowNumber,
          enrollmentNumber: buildFichaEnrollmentNumber('2026', folio),
          officialEnrollmentNumber: null,
          importKind: 'FICHA',
          fullName: `${paternalLastName} ${maternalLastName} ${names}`.trim(),
          curp,
          sex: normalizeSheetUpper(pickSheetValue(row, SEX_ALIASES)) || null,
          age: parseAge(pickSheetValue(row, AGE_ALIASES)),
          groupLabel: buildGroupLabel(1, group, null),
          career: null,
          semesterLevel: 1,
          previousSchool: normalizeSheetCell(pickSheetValue(row, PREVIOUS_SCHOOL_ALIASES)) || null,
          locality: normalizeSheetCell(pickSheetValue(row, LOCALITY_ALIASES)) || null,
          phone: normalizeSheetCell(pickSheetValue(row, STUDENT_PHONE_ALIASES)) || null,
          email: normalizeSheetCell(pickSheetValue(row, EMAIL_ALIASES)) || null,
          motherTongue: normalizeSheetCell(pickSheetValue(row, MOTHER_TONGUE_ALIASES)) || null,
          guardianFullName: normalizeSheetUpper(pickSheetValue(row, GUARDIAN_NAME_ALIASES)) || null,
          guardianPhone: normalizeSheetCell(pickSheetValue(row, GUARDIAN_PHONE_ALIASES)) || null,
          secondaryAverage: parseNumber(pickSheetValue(row, AVERAGE_ALIASES)),
        })
      }
      continue
    }

    if (!semesterLevel) continue

    const headerRowIndex = sheetRows.findIndex((row) => Array.isArray(row) && row.some((cell) => NAME_ALIASES.includes(normalizeSheetHeader(cell))))
    if (headerRowIndex < 0) {
      skippedCount += 1
      issues.push(`${sheetName}: no se encontro encabezado de alumnos.`)
      continue
    }

    const headers = (Array.isArray(sheetRows[headerRowIndex]) ? sheetRows[headerRowIndex] : []).map((cell) => normalizeSheetCell(cell))
    for (let rowIndex = headerRowIndex + 1; rowIndex < sheetRows.length; rowIndex += 1) {
      const rawRow = Array.isArray(sheetRows[rowIndex]) ? sheetRows[rowIndex] : []
      const row = Object.fromEntries(headers.map((header, index) => [header, rawRow[index] ?? '']))
      const rowNumber = rowIndex + 1
      const enrollmentNumber = normalizeSheetCell(pickSheetValue(row, ENROLLMENT_ALIASES))
      const fullName = normalizeSheetUpper(pickSheetValue(row, NAME_ALIASES))
      const curp = normalizeSheetUpper(pickSheetValue(row, CURP_ALIASES))
      const sex = normalizeSheetUpper(pickSheetValue(row, SEX_ALIASES)) || null
      const age = parseAge(pickSheetValue(row, AGE_ALIASES))
      const group = normalizeSheetUpper(pickSheetValue(row, GROUP_ALIASES))
      const career = normalizeSheetUpper(pickSheetValue(row, CAREER_ALIASES)) || null

      if (!enrollmentNumber && !fullName && !curp) continue

      if (!enrollmentNumber || !fullName || !curp || !group) {
        skippedCount += 1
        issues.push(`Fila ${rowNumber} en ${sheetName}: faltan No. Control, Nombre, CURP o Grupo.`)
        continue
      }

      if (!hasValidCurpLength(curp)) {
        skippedCount += 1
        issues.push(`Fila ${rowNumber} en ${sheetName}: CURP invalida para ${enrollmentNumber} (${curp.length} caracteres).`)
        continue
      }

      rows.push({
        sheetName,
        rowNumber,
        enrollmentNumber,
        officialEnrollmentNumber: enrollmentNumber,
        importKind: 'MATRICULA',
        fullName,
        curp,
        sex,
        age,
        groupLabel: buildGroupLabel(semesterLevel, group, career),
        career,
        semesterLevel,
      })
    }
  }

  return { rows, skippedCount, issues }
}
