import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'
import { PrismaClient } from '../prisma/generated/backend-client'

type ParsedRow = {
  sheetName: string
  rowNumber: number
  groupLabel: string
  enrollmentNumber: string | null
  curp: string | null
}

function normalizeCell(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeUpper(value: unknown) {
  return normalizeCell(value).toUpperCase()
}

function normalizeHeader(value: unknown) {
  return normalizeCell(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeGroupLabel(value: unknown) {
  const normalized = normalizeUpper(value)
  if (/^[A-Z]$/.test(normalized)) return `1${normalized}`
  if (/^1[A-Z]$/.test(normalized)) return normalized
  return normalized
}

function extractEnrollmentSequenceKey(value: string | null | undefined) {
  if (!value) return null
  const digits = value.replace(/\D+/g, '')
  if (digits.length === 0) return null
  return String(Number.parseInt(digits, 10))
}

function pickValue(row: Record<string, unknown>, aliases: string[]) {
  for (const [rawKey, rawValue] of Object.entries(row)) {
    if (aliases.includes(normalizeHeader(rawKey))) return rawValue
  }
  return ''
}

const GROUP_COLUMN_ALIASES = ['grupo', 'group', 'grupo asignado', 'grupo destino', 'group label']
const ENROLLMENT_COLUMN_ALIASES = ['folio interno', 'matricula', 'matricula interna', 'enrollment number', 'enrollmentnumber', 'numero de control']
const CURP_COLUMN_ALIASES = ['curp']

function parseWorkbook(filePath: string) {
  const workbook = XLSX.readFile(filePath)
  const rows: ParsedRow[] = []
  const issues: string[] = []
  let skippedCount = 0

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const populatedCells = Object.keys(sheet)
      .filter((key) => !key.startsWith('!'))
      .map((key) => XLSX.utils.decode_cell(key))
    if (populatedCells.length === 0) continue

    const range = populatedCells.reduce(
      (acc, cell) => ({
        s: { r: Math.min(acc.s.r, cell.r), c: Math.min(acc.s.c, cell.c) },
        e: { r: Math.max(acc.e.r, cell.r), c: Math.max(acc.e.c, cell.c) },
      }),
      {
        s: { r: populatedCells[0].r, c: populatedCells[0].c },
        e: { r: populatedCells[0].r, c: populatedCells[0].c },
      },
    )

    const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', range })
    const wideHeaderIndex = sheetRows.findIndex((row) => {
      if (!Array.isArray(row)) return false
      const normalized = row.map((cell) => normalizeHeader(cell))
      const folioCount = normalized.filter((cell) => cell === 'folio').length
      const groupCount = normalized.filter((cell) => cell === 'grupo').length
      return folioCount >= 2 && groupCount >= 2
    })

    if (wideHeaderIndex >= 0) {
      for (let rowIndex = wideHeaderIndex + 1; rowIndex < sheetRows.length; rowIndex += 1) {
        const row = Array.isArray(sheetRows[rowIndex]) ? sheetRows[rowIndex] : []
        for (let columnIndex = 0; columnIndex < row.length; columnIndex += 2) {
          const enrollmentNumber = normalizeCell(row[columnIndex]) || null
          const groupLabel = normalizeGroupLabel(row[columnIndex + 1])
          if (!enrollmentNumber && !groupLabel) continue
          if (!groupLabel || !enrollmentNumber) {
            skippedCount += 1
            issues.push(`Fila ${rowIndex + 1} en ${sheetName}: falta folio o grupo.`)
            continue
          }
          rows.push({ sheetName, rowNumber: rowIndex + 1, groupLabel, enrollmentNumber, curp: null })
        }
      }
      continue
    }

    const headerRowIndex = sheetRows.findIndex((row) => Array.isArray(row) && row.some((cell) => {
      const header = normalizeHeader(cell)
      return GROUP_COLUMN_ALIASES.includes(header) || header === 'columna1' || ENROLLMENT_COLUMN_ALIASES.includes(header) || CURP_COLUMN_ALIASES.includes(header)
    }))
    if (headerRowIndex < 0) continue

    const headers = (Array.isArray(sheetRows[headerRowIndex]) ? sheetRows[headerRowIndex] : []).map((cell) => normalizeCell(cell))
    for (let rowIndex = headerRowIndex + 1; rowIndex < sheetRows.length; rowIndex += 1) {
      const rawRow = Array.isArray(sheetRows[rowIndex]) ? sheetRows[rowIndex] : []
      const row = Object.fromEntries(headers.map((header, index) => [header, rawRow[index] ?? '']))
      const groupLabel = normalizeGroupLabel(pickValue(row, [...GROUP_COLUMN_ALIASES, 'columna1'])) || normalizeGroupLabel(sheetName)
      const enrollmentNumber = normalizeCell(pickValue(row, ENROLLMENT_COLUMN_ALIASES)) || null
      const curp = normalizeUpper(pickValue(row, CURP_COLUMN_ALIASES)) || null
      if (!groupLabel && !enrollmentNumber && !curp) continue
      if (!groupLabel) {
        skippedCount += 1
        issues.push(`Fila ${rowIndex + 1} en ${sheetName}: falta Grupo.`)
        continue
      }
      if (!enrollmentNumber && !curp) {
        skippedCount += 1
        issues.push(`Fila ${rowIndex + 1} en ${sheetName}: falta CURP o folio interno.`)
        continue
      }
      rows.push({ sheetName, rowNumber: rowIndex + 1, groupLabel, enrollmentNumber, curp })
    }
  }

  return { rows, issues, skippedCount }
}

async function main() {
  const schoolCycle = process.argv[2]?.trim() || '2026-2027'
  const filePathArg = process.argv[3]?.trim() || 'FICHAS 2026.xlsx'
  const filePath = path.resolve(filePathArg)
  if (!fs.existsSync(filePath)) {
    throw new Error(`No existe el archivo: ${filePath}`)
  }

  const prisma = new PrismaClient()
  try {
    const actor = await prisma.user.findUnique({ where: { username: 'admin.1' }, select: { id: true, role: true } })
    if (!actor) throw new Error('No se encontro el usuario admin.1 en la base central.')

    const parsed = parseWorkbook(filePath)
    const dedupedRows = new Map<string, ParsedRow>()
    const issues = [...parsed.issues]
    for (const row of parsed.rows) {
      const key = row.curp ? `curp:${row.curp}` : `folio:${row.enrollmentNumber}`
      if (dedupedRows.has(key)) {
        issues.push(`Fila ${row.rowNumber} en ${row.sheetName}: repetida ${row.curp ?? row.enrollmentNumber}; se conserva la ultima.`)
      }
      dedupedRows.set(key, row)
    }
    const rows = Array.from(dedupedRows.values())
    const groupLabels = Array.from(new Set(rows.map((row) => row.groupLabel))).sort((a, b) => a.localeCompare(b))

    for (const label of groupLabels) {
      await prisma.intakeGroup.upsert({
        where: { schoolCycle_label_shift: { schoolCycle, label, shift: 'MATUTINO' } },
        update: { isActive: true, capacity: 40 },
        create: { schoolCycle, label, shift: 'MATUTINO', capacity: 40, isActive: true },
      })
    }

    const [groups, students] = await Promise.all([
      prisma.intakeGroup.findMany({ where: { schoolCycle, shift: 'MATUTINO', label: { in: groupLabels } }, select: { id: true, label: true } }),
      prisma.student.findMany({ where: { schoolCycle }, include: { groupAssignment: { include: { group: true } } } }),
    ])

    const groupByLabel = new Map(groups.map((group) => [group.label, group]))
    const studentByEnrollment = new Map(students.map((student) => [student.enrollmentNumber, student]))
    const studentByCurp = new Map(students.map((student) => [student.curp.toUpperCase(), student]))
    const studentBySequence = new Map(
      students
        .map((student) => [extractEnrollmentSequenceKey(student.enrollmentNumber), student] as const)
        .filter((entry): entry is [string, (typeof students)[number]] => Boolean(entry[0])),
    )

    let importedCount = 0
    let unmatchedCount = 0

    for (const row of rows) {
      const enrollmentSequenceKey = extractEnrollmentSequenceKey(row.enrollmentNumber)
      const student =
        (row.enrollmentNumber ? studentByEnrollment.get(row.enrollmentNumber) : undefined) ??
        (row.curp ? studentByCurp.get(row.curp) : undefined) ??
        (enrollmentSequenceKey ? studentBySequence.get(enrollmentSequenceKey) : undefined)

      if (!student) {
        unmatchedCount += 1
        issues.push(`Fila ${row.rowNumber} en ${row.sheetName}: sin alumno para ${row.curp ?? row.enrollmentNumber}.`)
        continue
      }

      const targetGroup = groupByLabel.get(row.groupLabel)
      if (!targetGroup) {
        unmatchedCount += 1
        issues.push(`Fila ${row.rowNumber} en ${row.sheetName}: no existe el grupo ${row.groupLabel}.`)
        continue
      }

      const assignment = student.groupAssignment
        ? await prisma.studentGroupAssignment.update({
          where: { id: student.groupAssignment.id },
          data: { groupId: targetGroup.id, status: 'ASIGNADO', updatedById: actor.id, reason: 'CARGA_UNICA_EXCEL' },
        })
        : await prisma.studentGroupAssignment.create({
          data: { studentId: student.id, groupId: targetGroup.id, status: 'ASIGNADO', assignedById: actor.id, updatedById: actor.id, reason: 'CARGA_UNICA_EXCEL' },
        })

      await prisma.student.update({ where: { id: student.id }, data: { enrollmentStatus: 'ASIGNADO' } })
      await prisma.groupAssignmentAudit.create({
        data: {
          assignmentId: assignment.id,
          studentId: student.id,
          beforeGroupId: student.groupAssignment?.groupId ?? null,
          beforeGroupLabel: student.groupAssignment?.group.label ?? null,
          afterGroupId: targetGroup.id,
          afterGroupLabel: targetGroup.label,
          actorId: actor.id,
          actorRole: actor.role,
          reason: 'CARGA_UNICA_EXCEL',
        },
      })

      importedCount += 1
    }

    const assignmentCount = await prisma.studentGroupAssignment.count()
    console.log(JSON.stringify({
      schoolCycle,
      sourcePath: filePath,
      importedCount,
      unmatchedCount,
      skippedCount: parsed.skippedCount,
      assignmentCount,
      createdGroups: groupLabels,
      issues: issues.slice(0, 20),
    }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('[import-groups-backend] Error', error)
  process.exitCode = 1
})
