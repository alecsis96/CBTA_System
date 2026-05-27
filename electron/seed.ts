import { prisma, resetPrismaClient, getLocalDbPath, getPackagedTemplateDbPath } from './db'
import { scryptSync, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as XLSX from 'xlsx'

const AUTH_HASH_PREFIX = 'scrypt'

function buildPasswordHash(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, 64).toString('hex')
  return `${AUTH_HASH_PREFIX}$${salt}$${derived}`
}

function isValidPasswordHash(passwordHash: string) {
  if (!passwordHash.startsWith(`${AUTH_HASH_PREFIX}$`)) {
    return false
  }

  const parts = passwordHash.split('$')
  if (parts.length !== 3) {
    return false
  }

  const [prefix, salt, digest] = parts
  if (prefix !== AUTH_HASH_PREFIX || !salt || !digest) {
    return false
  }

  return /^[a-f0-9]+$/i.test(salt) && /^[a-f0-9]+$/i.test(digest)
}

const seedUsers = [
  { username: 'control.escolar.1', displayName: 'Control Escolar 1', role: 'CONTROL_ESCOLAR', password: 'Control123!' },
  { username: 'control.escolar.2', displayName: 'Control Escolar 2', role: 'CONTROL_ESCOLAR', password: 'Control123!' },
  { username: 'control.escolar.3', displayName: 'Control Escolar 3', role: 'CONTROL_ESCOLAR', password: 'Control123!' },
  { username: 'ingresos.propios.1', displayName: 'Ingresos Propios 1', role: 'INGRESOS_PROPIOS', password: 'Ingresos123!' },
  { username: 'ingresos.propios.2', displayName: 'Ingresos Propios 2', role: 'INGRESOS_PROPIOS', password: 'Ingresos123!' },
  { username: 'admin.1', displayName: 'Administrador General', role: 'ADMIN', password: 'Admin123!' },
] as const

const baseConcepts = [
  {
    code: 'A000',
    groupCode: 'A000',
    name: 'Servicios administrativos escolares',
    description: 'Agrupa los ingresos provenientes de la prestacion de servicios administrativos educativos que requieran los estudiantes y egresados del plantel.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    code: 'A001',
    groupCode: 'A000',
    name: 'Acreditacion, certificacion y convalidacion de estudios',
    description: 'Ingresos provenientes de la acreditacion, certificacion y convalidacion de estudios que requieran los alumnos de todos los niveles educativos.',
    amount: 80,
    periodLabel: '2026-A',
  },
  {
    code: 'A002',
    groupCode: 'A000',
    name: 'Expedicion y otorgamiento de documentos oficiales',
    description: 'Ingresos provenientes de la expedicion y otorgamiento de documentos academicos y oficiales como cartas, credenciales, constancias, diplomas, titulos y tramites relacionados.',
    amount: 150,
    periodLabel: '2026-A',
  },
  {
    code: 'A003',
    groupCode: 'A000',
    name: 'Examenes',
    description: 'Ingresos provenientes del pago de derechos por examenes extraordinarios, de regularizacion, recuperacion, especiales y otros tramites de evaluacion.',
    amount: 100,
    periodLabel: '2026-A',
  },
  {
    code: 'A004',
    groupCode: 'A000',
    name: 'Otros',
    description: 'Conceptos de ingreso que no se ubiquen especificamente en los anteriores pero que sean afines al grupo.',
    amount: 50,
    periodLabel: '2026-A',
  },
  {
    code: 'B000',
    groupCode: 'B000',
    name: 'Aportaciones y cuotas de cooperacion voluntaria',
    description: 'Agrupa los ingresos provenientes de estudiantes y particulares que apoyan la labor educativa, la practica escolar y la formacion academica.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    code: 'B001',
    groupCode: 'B000',
    name: 'Cuotas de cooperacion voluntaria',
    description: 'Ingresos provenientes de las cooperaciones voluntarias que aportan los alumnos por cursos normales, especiales o periodicos.',
    amount: 250,
    periodLabel: '2026-A',
  },
  {
    code: 'B002',
    groupCode: 'B000',
    name: 'Aportaciones, cooperaciones y donaciones al plantel',
    description: 'Ingresos provenientes en efectivo y bienes que incrementen el patrimonio de la Secretaria por parte de estudiantes, profesores, particulares o instituciones.',
    amount: 372,
    periodLabel: '2026-A',
  },
  {
    code: 'B003',
    groupCode: 'B000',
    name: 'Beneficios',
    description: 'Ingresos provenientes de porcentajes de utilidad neta y beneficios obtenidos por actividades del plantel, cooperativas o eventos.',
    amount: 120,
    periodLabel: '2026-A',
  },
  {
    code: 'B004',
    groupCode: 'B000',
    name: 'Otros',
    description: 'Conceptos de ingreso no ubicados especificamente en los anteriores pero afines al grupo.',
    amount: 60,
    periodLabel: '2026-A',
  },
  {
    code: 'C000',
    groupCode: 'C000',
    name: 'Servicios generales',
    description: 'Agrupa los ingresos provenientes de la prestacion de servicios de caracter social a estudiantes y comunidad en general.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    code: 'C001',
    groupCode: 'C000',
    name: 'Servicios medicos',
    description: 'Ingresos provenientes del pago de derechos al servicio medico del plantel, como examenes medicos, analisis clinicos y diagnosticos.',
    amount: 90,
    periodLabel: '2026-A',
  },
  {
    code: 'C002',
    groupCode: 'C000',
    name: 'Servicios a personas',
    description: 'Ingresos provenientes de la prestacion de servicios de comedor, higiene, limpieza y otros relacionados brindados a estudiantes y comunidad.',
    amount: 70,
    periodLabel: '2026-A',
  },
  {
    code: 'C003',
    groupCode: 'C000',
    name: 'Servicios de asesoria y orientacion',
    description: 'Ingresos provenientes de servicios de asesoria y orientacion en ramas como construccion, datos, editorial, impresion, fotocopiado y proyectos.',
    amount: 110,
    periodLabel: '2026-A',
  },
]

const enrollmentRequirements = [
  { code: 'CERT_ESTUDIOS', label: 'Certificado de estudios', requiredOriginals: 1, requiredCopies: 2, sortOrder: 10 },
  { code: 'ACTA_NACIMIENTO', label: 'Acta de nacimiento actualizada', requiredOriginals: 1, requiredCopies: 2, sortOrder: 20 },
  { code: 'CARTA_CONDUCTA', label: 'Carta de conducta', requiredOriginals: 1, requiredCopies: 1, sortOrder: 30 },
  { code: 'CURP_COPIAS', label: 'CURP actual', requiredOriginals: 0, requiredCopies: 3, sortOrder: 40 },
  { code: 'NSS', label: 'Numero de seguro social IMSS/ISSSTE/ISSTECH', requiredOriginals: 0, requiredCopies: 2, sortOrder: 50 },
  { code: 'INE_TUTOR', label: 'Copia de credencial de elector del tutor', requiredOriginals: 0, requiredCopies: 1, sortOrder: 60 },
  { code: 'TELEFONOS', label: 'Numero telefonico del alumno y tutor', requiredOriginals: 0, requiredCopies: 0, sortOrder: 70 },
  { code: 'CORREO', label: 'Correo vigente del alumno', requiredOriginals: 0, requiredCopies: 0, sortOrder: 80 },
  { code: 'FOTOS', label: '6 fotografias tamano infantil', requiredOriginals: 0, requiredCopies: 6, sortOrder: 90 },
] as const

const INTERNAL_FOLIO_PREFIX = '2610701044'

type ExcelStudentRow = {
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
    return {
      locality: '',
      municipality: null as string | null,
      state: null as string | null,
    }
  }

  if (rawParts.length === 1) {
    return {
      locality: null,
      municipality: rawParts[0],
      state: null,
    }
  }

  if (rawParts.length === 2) {
    return {
      locality: null,
      municipality: rawParts[0],
      state: rawParts[1],
    }
  }

  return {
    locality: rawParts[0],
    municipality: rawParts[1],
    state: rawParts[rawParts.length - 1],
  }
}

function loadStudentsFromExcel(): ExcelStudentRow[] {
  const workbookPath = join(process.cwd(), 'FICHAS 2026.xlsx')
  if (!existsSync(workbookPath)) {
    return []
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
      enrollmentNumber: `2026${String(sequential).padStart(4, '0')}`,
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

export async function ensureBaseData() {
  async function hasTable(tableName: string) {
    const result = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${tableName}
    `
    return result.length > 0
  }

  const userTable = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'User'
  `

  if (userTable.length === 0) {
    const sourceDbPath = getPackagedTemplateDbPath()
    const targetDbPath = getLocalDbPath()

    if (existsSync(sourceDbPath)) {
      mkdirSync(dirname(targetDbPath), { recursive: true })
      await prisma.$disconnect()
      copyFileSync(sourceDbPath, targetDbPath)
      await resetPrismaClient()
    }
  }

  for (const user of seedUsers) {
    const existing = await prisma.user.findUnique({ where: { username: user.username } })
    const passwordHash = existing?.passwordHash && isValidPasswordHash(existing.passwordHash)
      ? existing.passwordHash
      : buildPasswordHash(user.password)

    await prisma.user.upsert({
      where: { username: user.username },
      update: {
        displayName: user.displayName,
        role: user.role,
        isActive: true,
        passwordHash,
      },
      create: {
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        isActive: true,
        passwordHash,
      },
    })
  }

  for (const concept of baseConcepts) {
    const existing = await prisma.chargeConcept.findUnique({
      where: { code: concept.code },
      include: { tariffs: { where: { isActive: true }, take: 1 } },
    })

    if (!existing) {
      await prisma.chargeConcept.create({
        data: {
          code: concept.code,
          groupCode: concept.groupCode,
          name: concept.name,
          description: concept.description,
          tariffs: {
            create: {
              amount: concept.amount,
              periodLabel: concept.periodLabel,
              isActive: true,
            },
          },
        },
      })
      continue
    }

    await prisma.chargeConcept.update({
      where: { id: existing.id },
      data: {
        groupCode: concept.groupCode,
        name: concept.name,
        description: concept.description,
      },
    })

    if (existing.tariffs.length === 0) {
      await prisma.chargeTariff.create({
        data: {
          conceptId: existing.id,
          amount: concept.amount,
          periodLabel: concept.periodLabel,
          isActive: true,
        },
      })
      continue
    }

    const activeTariff = existing.tariffs[0]
    if (Number(activeTariff.amount) === 0 && concept.amount > 0) {
      await prisma.chargeTariff.update({
        where: { id: activeTariff.id },
        data: {
          amount: concept.amount,
          periodLabel: concept.periodLabel,
        },
      })
    }
  }

  const hasEnrollmentRequirementTable = await hasTable('EnrollmentRequirement')
  const hasStudentRequirementStatusTable = await hasTable('StudentRequirementStatus')
  const hasSequenceCounterTable = await hasTable('SequenceCounter')

  if (!hasEnrollmentRequirementTable || !hasStudentRequirementStatusTable || !hasSequenceCounterTable) {
    console.warn(
      '[seed] Required enrollment tables are missing in local database. Skipping enrollment checklist seed to avoid startup crash.',
    )
    return
  }

  for (const requirement of enrollmentRequirements) {
    await prisma.enrollmentRequirement.upsert({
      where: { code: requirement.code },
      update: {
        label: requirement.label,
        requiredOriginals: requirement.requiredOriginals,
        requiredCopies: requirement.requiredCopies,
        sortOrder: requirement.sortOrder,
        isActive: true,
      },
      create: {
        code: requirement.code,
        label: requirement.label,
        requiredOriginals: requirement.requiredOriginals,
        requiredCopies: requirement.requiredCopies,
        sortOrder: requirement.sortOrder,
        isActive: true,
      },
    })
  }

  const excelStudents = loadStudentsFromExcel()
  if (excelStudents.length === 0) {
    return
  }

  await prisma.$transaction(async (tx) => {
    await tx.groupAssignmentAudit.deleteMany({})
    await tx.studentGroupAssignment.deleteMany({})
    await tx.intakeGroup.deleteMany({})
    await tx.rocReceiptLine.deleteMany({})
    await tx.rocReceipt.deleteMany({})
    await tx.studentRequirementStatus.deleteMany({})
    await tx.preRegistrationAudit.deleteMany({})
    await tx.preRegistration.deleteMany({})
    await tx.admissionPayment.deleteMany({})
    await tx.guardian.deleteMany({})
    await tx.student.deleteMany({})
    await tx.sequenceCounter.upsert({ where: { scope: 'STUDENT_INTERNAL_FOLIO' }, update: { lastValue: 0 }, create: { scope: 'STUDENT_INTERNAL_FOLIO', lastValue: 0 } })
  })

  const requirementCatalog = await prisma.enrollmentRequirement.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })

  for (const [index, student] of excelStudents.entries()) {
    const location = parseLocationParts(student.locality)
    const createdStudent = await prisma.student.create({
      data: {
        enrollmentNumber: `${INTERNAL_FOLIO_PREFIX}${String(index + 1).padStart(4, '0')}`,
        curp: student.curp,
        firstName: student.firstName,
        paternalLastName: student.paternalLastName,
        maternalLastName: student.maternalLastName,
        age: student.age,
        sex: student.sex,
        phone: student.phone || null,
        email: student.email || null,
        motherTongue: student.motherTongue || null,
        addressLine: '',
        locality: location.locality || null,
        municipality: location.municipality,
        state: location.state,
        previousSchool: student.previousSchool || null,
        secondaryAverage: student.secondaryAverage,
        schoolCycle: '2026-2027',
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
        data: requirementCatalog.map((requirement) => ({
          studentId: createdStudent.id,
          requirementId: requirement.id,
        })),
      })
    }
  }

  await prisma.sequenceCounter.upsert({
    where: { scope: 'STUDENT_INTERNAL_FOLIO' },
    update: { lastValue: excelStudents.length },
    create: { scope: 'STUDENT_INTERNAL_FOLIO', lastValue: excelStudents.length },
  })
}
