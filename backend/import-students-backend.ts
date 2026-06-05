import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { prisma } from './prisma'

const INTERNAL_FOLIO_PREFIX = '2610701044'
const IMPORT_SCHOOL_CYCLE = process.env.BACKEND_STUDENT_IMPORT_SCHOOL_CYCLE?.trim() || '2026-2027'

type ExcelStudentRow = {
  sourceIndex: number
  enrollmentNumber: string
  curp: string
  firstName: string
  paternalLastName: string
  maternalLastName: string
  age: number | null
  sex: string
  previousSchool: string
  secondaryAverage: number | null
  locality: string
  guardianFullName: string
  phone: string
  guardianPhone: string
  email: string
  motherTongue: string
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function normalizePhone(value: unknown) {
  return normalizeText(value).replace(/\s+/g, '')
}

function normalizeUpper(value: unknown) {
  return normalizeText(value).toUpperCase()
}

function parseDecimal(value: unknown) {
  const text = normalizeText(value).replace(',', '.')
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

function parseInteger(value: unknown) {
  const parsed = Number(normalizeText(value))
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}

function parseLocationParts(localitySource: string) {
  const rawParts = localitySource
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

  if (rawParts.length === 0) {
    return { locality: null as string | null, municipality: null as string | null, state: null as string | null }
  }

  if (rawParts.length === 1) {
    return { locality: null, municipality: rawParts[0], state: null }
  }

  if (rawParts.length === 2) {
    return { locality: null, municipality: rawParts[0], state: rawParts[1] }
  }

  return { locality: rawParts[0], municipality: rawParts[1], state: rawParts[rawParts.length - 1] }
}

function resolveImportWorkbookPath() {
  const configured = process.env.BACKEND_STUDENT_IMPORT_XLSX?.trim()
  if (configured) return resolve(configured)
  return resolve(process.cwd(), 'FICHAS 2026.xlsx')
}

function loadStudentsFromExcel(workbookPath: string): ExcelStudentRow[] {
  if (!existsSync(workbookPath)) {
    throw new Error(`No se encontro el archivo de importacion: ${workbookPath}`)
  }

  const workbook = XLSX.readFile(workbookPath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })

  const students: ExcelStudentRow[] = []
  for (const row of rows.slice(1)) {
    const sequential = parseInteger(row[0])
    const curp = normalizeUpper(row[6])
    const paternalLastName = normalizeUpper(row[3])
    const maternalLastName = normalizeUpper(row[4])
    const firstName = normalizeUpper(row[5])

    if (!sequential || !curp || curp.length < 18 || !firstName || !paternalLastName) {
      continue
    }

    students.push({
      sourceIndex: sequential,
      enrollmentNumber: `${INTERNAL_FOLIO_PREFIX}${String(sequential).padStart(4, '0')}`,
      curp,
      firstName,
      paternalLastName,
      maternalLastName,
      age: parseInteger(row[7]),
      sex: normalizeUpper(row[8]),
      previousSchool: normalizeText(row[9]),
      secondaryAverage: parseDecimal(row[10]),
      locality: normalizeText(row[11]),
      guardianFullName: normalizeText(row[12]),
      phone: normalizePhone(row[13]),
      guardianPhone: normalizePhone(row[14]),
      email: normalizeText(row[15]).toLowerCase(),
      motherTongue: normalizeText(row[16]),
    })
  }

  return students
}

export async function importStudentsToBackend() {
  const workbookPath = resolveImportWorkbookPath()
  const excelStudents = loadStudentsFromExcel(workbookPath)
  const requirementCatalog = await prisma.enrollmentRequirement.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })

  let createdCount = 0
  let updatedCount = 0

  for (const student of excelStudents) {
    const location = parseLocationParts(student.locality)
    const existing = await prisma.student.findUnique({
      where: { curp: student.curp },
      include: { guardian: true, requirementStatuses: true },
    })

    if (!existing) {
      const createdStudent = await prisma.student.create({
        data: {
          enrollmentNumber: student.enrollmentNumber,
          curp: student.curp,
          firstName: student.firstName,
          paternalLastName: student.paternalLastName,
          maternalLastName: student.maternalLastName,
          age: student.age,
          sex: student.sex || null,
          phone: student.phone || null,
          email: student.email || null,
          motherTongue: student.motherTongue || null,
          addressLine: '',
          locality: location.locality,
          municipality: location.municipality,
          state: location.state,
          previousSchool: student.previousSchool || null,
          secondaryAverage: student.secondaryAverage,
          schoolCycle: IMPORT_SCHOOL_CYCLE,
          academicStatus: 'REGULAR',
          documentationStatus: 'PENDIENTE',
          enrollmentStatus: 'FICHA_ENTREGADA',
          status: 'LISTO_PARA_COBRO',
          validatedAt: new Date(),
          validatedBy: 'CONTROL_ESCOLAR',
          guardian: {
            create: {
              fullName: student.guardianFullName || 'SIN TUTOR CAPTURADO',
              phone: student.guardianPhone || 'SIN TELEFONO',
            },
          },
        },
      })

      if (requirementCatalog.length > 0) {
        await prisma.studentRequirementStatus.createMany({
          data: requirementCatalog.map((requirement) => ({ studentId: createdStudent.id, requirementId: requirement.id })),
        })
      }

      createdCount += 1
      continue
    }

    await prisma.student.update({
      where: { id: existing.id },
      data: {
        enrollmentNumber: existing.enrollmentNumber || student.enrollmentNumber,
        firstName: student.firstName,
        paternalLastName: student.paternalLastName,
        maternalLastName: student.maternalLastName,
        age: student.age,
        sex: student.sex || null,
        phone: student.phone || null,
        email: student.email || null,
        motherTongue: student.motherTongue || null,
        locality: location.locality,
        municipality: location.municipality,
        state: location.state,
        previousSchool: student.previousSchool || null,
        secondaryAverage: student.secondaryAverage,
        schoolCycle: existing.schoolCycle || IMPORT_SCHOOL_CYCLE,
        academicStatus: existing.academicStatus || 'REGULAR',
      },
    })

    await prisma.guardian.upsert({
      where: { studentId: existing.id },
      update: {
        fullName: student.guardianFullName || existing.guardian?.fullName || 'SIN TUTOR CAPTURADO',
        phone: student.guardianPhone || existing.guardian?.phone || 'SIN TELEFONO',
      },
      create: {
        studentId: existing.id,
        fullName: student.guardianFullName || 'SIN TUTOR CAPTURADO',
        phone: student.guardianPhone || 'SIN TELEFONO',
      },
    })

    const existingRequirementIds = new Set(existing.requirementStatuses.map((item) => item.requirementId))
    const missingRequirementRows = requirementCatalog
      .filter((requirement) => !existingRequirementIds.has(requirement.id))
      .map((requirement) => ({ studentId: existing.id, requirementId: requirement.id }))

    if (missingRequirementRows.length > 0) {
      await prisma.studentRequirementStatus.createMany({ data: missingRequirementRows })
    }

    updatedCount += 1
  }

  const maxSequential = excelStudents.reduce((max, student) => Math.max(max, student.sourceIndex), 0)
  if (maxSequential > 0) {
    await prisma.sequenceCounter.upsert({
      where: { scope: 'STUDENT_INTERNAL_FOLIO' },
      update: { lastValue: { set: maxSequential } },
      create: { scope: 'STUDENT_INTERNAL_FOLIO', lastValue: maxSequential },
    })
  }

  return {
    workbookPath,
    importedRows: excelStudents.length,
    createdCount,
    updatedCount,
  }
}

async function run() {
  const result = await importStudentsToBackend()
  console.log(`[backend-import-students] Importacion completada. Filas=${result.importedRows} creados=${result.createdCount} actualizados=${result.updatedCount}`)
  console.log(`[backend-import-students] Archivo fuente: ${result.workbookPath}`)
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('[backend-import-students] Error al importar alumnos al backend central.', error)
      process.exitCode = 1
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
