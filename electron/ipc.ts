import { app, ipcMain } from 'electron'
import { z } from 'zod'
import { prisma } from './db'
import { openOfficialRocTemplate } from './roc-template'

const studentInputSchema = z.object({
  enrollmentNumber: z.string().min(1),
  curp: z.string().min(18).max(18),
  rfc: z.string().trim().optional().nullable(),
  firstName: z.string().min(1),
  paternalLastName: z.string().min(1),
  maternalLastName: z.string().min(1),
  birthDate: z.string().optional().nullable(),
  age: z.number().int().min(0).max(120).optional().nullable(),
  sex: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  addressLine: z.string().min(1),
  neighborhood: z.string().trim().optional().nullable(),
  locality: z.string().trim().optional().nullable(),
  municipality: z.string().trim().optional().nullable(),
  state: z.string().trim().optional().nullable(),
  postalCode: z.string().trim().optional().nullable(),
  previousSchool: z.string().trim().optional().nullable(),
  secondaryAverage: z.number().min(0).max(10).optional().nullable(),
  schoolCycle: z.string().min(1),
  academicStatus: z.string().trim().optional().nullable(),
  guardianFullName: z.string().min(1),
  guardianRelationship: z.string().trim().optional().nullable(),
  guardianPhone: z.string().min(1),
  guardianEmail: z.string().email().optional().or(z.literal('')).nullable(),
  validateNow: z.boolean().default(false),
})

const receiptInputSchema = z.object({
  rocNumber: z.string().min(1),
  studentId: z.string().min(1),
  conceptCodes: z.array(z.string().min(1)).min(1),
})

const printReceiptSchema = z.object({
  rocNumber: z.string().min(1),
  studentId: z.string().min(1),
  conceptCodes: z.array(z.string().min(1)).min(1),
})

const tariffUpdateSchema = z.object({
  code: z.string().min(1),
  amount: z.number().min(0),
  periodLabel: z.string().min(1),
})

const preRegistrationCreateSchema = z.object({
  firstName: z.string().min(1),
  paternalLastName: z.string().min(1),
  maternalLastName: z.string().min(1),
  curp: z.string().min(18).max(18),
  birthDate: z.string().optional().nullable(),
  sex: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  addressLine: z.string().min(1),
  neighborhood: z.string().trim().optional().nullable(),
  locality: z.string().trim().optional().nullable(),
  municipality: z.string().trim().optional().nullable(),
  state: z.string().trim().optional().nullable(),
  postalCode: z.string().trim().optional().nullable(),
  previousSchool: z.string().trim().optional().nullable(),
  secondaryAverage: z.number().min(0).max(10).optional().nullable(),
  schoolCycle: z.string().min(1),
  guardianFullName: z.string().min(1),
  guardianRelationship: z.string().trim().optional().nullable(),
  guardianPhone: z.string().min(1),
  guardianEmail: z.string().email().optional().or(z.literal('')).nullable(),
})

const preRegistrationStatusUpdateSchema = z.object({
  status: z.enum(['EN_REVISION_CONTROL_ESCOLAR', 'OBSERVADO', 'RECHAZADO', 'VALIDADO_PARA_PAGO', 'PAGADO']),
  observationNotes: z.string().trim().optional(),
})

function normalizeOptional(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function studentSummary(student: {
  id: string
  enrollmentNumber: string
  curp: string
  rfc: string | null
  firstName: string
  paternalLastName: string
  maternalLastName: string
  phone: string | null
  email: string | null
  addressLine: string
  neighborhood: string | null
  locality: string | null
  municipality: string | null
  state: string | null
  status: string
}) {
  return {
    id: student.id,
    enrollmentNumber: student.enrollmentNumber,
    curp: student.curp,
    rfc: student.rfc,
    phone: student.phone ?? null,
    email: student.email ?? null,
    firstName: student.firstName,
    paternalLastName: student.paternalLastName,
    maternalLastName: student.maternalLastName,
    fullName: `${student.firstName} ${student.paternalLastName} ${student.maternalLastName}`,
    address: [student.addressLine, student.neighborhood, student.locality, student.municipality, student.state]
      .filter(Boolean)
      .join(', '),
    statusLabel: student.status,
  }
}

function studentDetail(student: {
  id: string
  enrollmentNumber: string
  curp: string
  rfc: string | null
  firstName: string
  paternalLastName: string
  maternalLastName: string
  birthDate: Date | null
  age: number | null
  sex: string | null
  phone: string | null
  email: string | null
  addressLine: string
  neighborhood: string | null
  locality: string | null
  municipality: string | null
  state: string | null
  postalCode: string | null
  previousSchool: string | null
  secondaryAverage: unknown
  schoolCycle: string
  academicStatus: string | null
  status: string
  guardian: {
    fullName: string
    relationship: string | null
    phone: string
    email: string | null
  } | null
}) {
  return {
    id: student.id,
    enrollmentNumber: student.enrollmentNumber,
    curp: student.curp,
    rfc: student.rfc ?? '',
    firstName: student.firstName,
    paternalLastName: student.paternalLastName,
    maternalLastName: student.maternalLastName,
    birthDate: student.birthDate ? student.birthDate.toISOString().slice(0, 10) : '',
    age: student.age,
    sex: student.sex ?? '',
    phone: student.phone ?? '',
    email: student.email ?? '',
    addressLine: student.addressLine,
    neighborhood: student.neighborhood ?? '',
    locality: student.locality ?? '',
    municipality: student.municipality ?? '',
    state: student.state ?? '',
    postalCode: student.postalCode ?? '',
    previousSchool: student.previousSchool ?? '',
    secondaryAverage: student.secondaryAverage == null ? null : Number(student.secondaryAverage),
    schoolCycle: student.schoolCycle,
    academicStatus: student.academicStatus ?? '',
    guardianFullName: student.guardian?.fullName ?? '',
    guardianRelationship: student.guardian?.relationship ?? '',
    guardianPhone: student.guardian?.phone ?? '',
    guardianEmail: student.guardian?.email ?? '',
    validateNow: ['VALIDADO', 'LISTO_PARA_COBRO', 'COBRADO'].includes(student.status),
    statusLabel: student.status,
  }
}

function receiptSummary(receipt: {
  id: string
  rocNumber: string
  studentId: string
  status: string
  issuedAt: Date
  totalAmount: unknown
  student: { firstName: string; paternalLastName: string; maternalLastName: string }
  lines: Array<{ concept: { code: string; name: string } }>
}) {
  return {
    id: receipt.id,
    rocNumber: receipt.rocNumber,
    studentId: receipt.studentId,
    studentName: `${receipt.student.firstName} ${receipt.student.paternalLastName} ${receipt.student.maternalLastName}`,
    totalAmount: Number(receipt.totalAmount),
    issuedAt: receipt.issuedAt.toISOString(),
    status: receipt.status,
    conceptLabels: receipt.lines.map((line) => `${line.concept.code} - ${line.concept.name}`),
  }
}

function conceptSummary(concept: {
  code: string
  groupCode: string | null
  name: string
  description: string | null
  tariffs: Array<{ amount: unknown; periodLabel: string }>
}) {
  return {
    code: concept.code,
    groupCode: concept.groupCode,
    name: concept.name,
    description: concept.description,
    amount: concept.tariffs[0] ? Number(concept.tariffs[0].amount) : 0,
    periodLabel: concept.tariffs[0]?.periodLabel ?? 'Sin tarifa',
  }
}

function auditSummary(log: {
  id: string
  action: string
  entityType: string
  entityId: string
  createdAt: Date
  afterJson: string | null
  user: { displayName: string } | null
}) {
  let detail = ''

  if (log.afterJson) {
    try {
      const parsed = JSON.parse(log.afterJson) as { summary?: string }
      detail = parsed.summary ?? ''
    } catch {
      detail = ''
    }
  }

  return {
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    actorName: log.user?.displayName ?? 'Sistema',
    createdAt: log.createdAt.toISOString(),
    detail,
  }
}

function preRegistrationSummary(item: {
  id: string
  folio: string
  firstName: string
  paternalLastName: string
  maternalLastName: string
  curp: string
  schoolCycle: string
  status: string
  submittedAt: Date | null
  createdAt: Date
  reviewedAt: Date | null
  observationNotes: string | null
}) {
  return {
    id: item.id,
    folio: item.folio,
    fullName: `${item.firstName} ${item.paternalLastName} ${item.maternalLastName}`.trim(),
    curp: item.curp,
    schoolCycle: item.schoolCycle,
    status: item.status,
    submittedAt: (item.submittedAt ?? item.createdAt).toISOString(),
    reviewedAt: item.reviewedAt ? item.reviewedAt.toISOString() : null,
    observationNotes: item.observationNotes ?? null,
  }
}

function buildPreRegistrationFolio() {
  const now = new Date()
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const token = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `PR-${ymd}-${token}`
}

function unitsToWords(value: number): string {
  const words = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']
  return words[value] ?? ''
}

function tensToWords(value: number): string {
  const specials: Record<number, string> = {
    10: 'diez',
    11: 'once',
    12: 'doce',
    13: 'trece',
    14: 'catorce',
    15: 'quince',
    16: 'dieciseis',
    17: 'diecisiete',
    18: 'dieciocho',
    19: 'diecinueve',
    20: 'veinte',
  }

  if (value <= 9) return unitsToWords(value)
  if (specials[value]) return specials[value]
  if (value < 30) return `veinti${unitsToWords(value - 20)}`

  const tens = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
  const ten = Math.floor(value / 10)
  const unit = value % 10
  return unit === 0 ? tens[ten] : `${tens[ten]} y ${unitsToWords(unit)}`
}

function hundredsToWords(value: number): string {
  if (value < 100) return tensToWords(value)
  if (value === 100) return 'cien'

  const hundreds: Record<number, string> = {
    1: 'ciento',
    2: 'doscientos',
    3: 'trescientos',
    4: 'cuatrocientos',
    5: 'quinientos',
    6: 'seiscientos',
    7: 'setecientos',
    8: 'ochocientos',
    9: 'novecientos',
  }

  const hundred = Math.floor(value / 100)
  const remainder = value % 100
  return remainder === 0 ? hundreds[hundred] : `${hundreds[hundred]} ${tensToWords(remainder)}`
}

function integerToWords(value: number): string {
  if (value < 1000) return hundredsToWords(value)
  if (value < 1000000) {
    const thousands = Math.floor(value / 1000)
    const remainder = value % 1000
    const thousandText = thousands === 1 ? 'mil' : `${hundredsToWords(thousands)} mil`
    return remainder === 0 ? thousandText : `${thousandText} ${hundredsToWords(remainder)}`
  }

  return String(value)
}

function amountToWords(amount: number) {
  const integer = Math.floor(amount)
  const cents = Math.round((amount - integer) * 100)
  return `${integerToWords(integer).toUpperCase()} PESOS, ${String(cents).padStart(2, '0')}/100 M.N.`
}

async function buildOfficialTemplateFromReceipt(receiptId: string) {
  const receipt = await prisma.rocReceipt.findUnique({
    where: { id: receiptId },
    include: {
      student: true,
      lines: {
        include: {
          concept: true,
        },
      },
    },
  })

  if (!receipt) {
    throw new Error('No se encontro el ROC solicitado.')
  }

  const outputPath = await openOfficialRocTemplate({
    rocNumber: receipt.rocNumber,
    fullName: `${receipt.student.paternalLastName} ${receipt.student.maternalLastName} ${receipt.student.firstName}`,
    identifier: receipt.student.rfc || receipt.student.enrollmentNumber,
    address: [receipt.student.addressLine, receipt.student.neighborhood, receipt.student.locality, receipt.student.municipality, receipt.student.state]
      .filter(Boolean)
      .join(', '),
    grade: '',
    group: '',
    shift: '',
    printDate: new Date().toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    }),
    totalAmount: Number(receipt.totalAmount),
    amountInWords: amountToWords(Number(receipt.totalAmount)),
    lines: receipt.lines.map((line) => ({
      code: line.concept.code,
      name: line.concept.name,
      amount: Number(line.unitAmount),
    })),
  })

  return { receipt, outputPath }
}

export function registerIpcHandlers() {
  ipcMain.handle('preRegistrations:list', async () => {
    const items = await prisma.preRegistration.findMany({
      orderBy: { createdAt: 'desc' },
    })

    return items.map(preRegistrationSummary)
  })

  ipcMain.handle('preRegistrations:create', async (_event, payload) => {
    const input = preRegistrationCreateSchema.parse(payload)
    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.preRegistration.create({
        data: {
          folio: buildPreRegistrationFolio(),
          status: 'PRE_REGISTRO_ENVIADO',
          firstName: input.firstName.trim(),
          paternalLastName: input.paternalLastName.trim(),
          maternalLastName: input.maternalLastName.trim(),
          curp: input.curp.trim().toUpperCase(),
          birthDate: input.birthDate ? new Date(input.birthDate) : null,
          sex: normalizeOptional(input.sex),
          phone: normalizeOptional(input.phone),
          email: normalizeOptional(input.email),
          addressLine: input.addressLine.trim(),
          neighborhood: normalizeOptional(input.neighborhood),
          locality: normalizeOptional(input.locality),
          municipality: normalizeOptional(input.municipality),
          state: normalizeOptional(input.state),
          postalCode: normalizeOptional(input.postalCode),
          previousSchool: normalizeOptional(input.previousSchool),
          secondaryAverage: input.secondaryAverage ?? null,
          schoolCycle: input.schoolCycle.trim(),
          guardianFullName: input.guardianFullName.trim(),
          guardianRelationship: normalizeOptional(input.guardianRelationship),
          guardianPhone: input.guardianPhone.trim(),
          guardianEmail: normalizeOptional(input.guardianEmail),
          voucherGeneratedAt: new Date(),
          submittedAt: new Date(),
        },
      })

      await tx.preRegistrationAudit.create({
        data: {
          preRegistrationId: item.id,
          action: 'PRE_REGISTRO_ENVIADO',
          actorRole: 'PORTAL_PUBLICO',
          actorName: 'Portal internet',
          detail: `Folio ${item.folio}`,
        },
      })

      return item
    })

    return preRegistrationSummary(created)
  })

  ipcMain.handle('preRegistrations:updateStatus', async (_event, preRegistrationId, payload) => {
    const id = z.string().min(1).parse(preRegistrationId)
    const input = preRegistrationStatusUpdateSchema.parse(payload)

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.preRegistration.findUnique({ where: { id } })
      if (!existing) {
        throw new Error('No se encontro el pre-registro solicitado.')
      }

      let linkedStudentId: string | null = null
      if (input.status === 'VALIDADO_PARA_PAGO') {
        const alreadyLinked = await tx.student.findFirst({ where: { preRegistrationId: existing.id } })
        linkedStudentId = alreadyLinked?.id ?? null
        if (!alreadyLinked) {
          const student = await tx.student.create({
            data: {
              enrollmentNumber: existing.folio,
              curp: existing.curp,
              firstName: existing.firstName,
              paternalLastName: existing.paternalLastName,
              maternalLastName: existing.maternalLastName,
              birthDate: existing.birthDate,
              sex: existing.sex,
              phone: existing.phone,
              email: existing.email,
              addressLine: existing.addressLine,
              neighborhood: existing.neighborhood,
              locality: existing.locality,
              municipality: existing.municipality,
              state: existing.state,
              postalCode: existing.postalCode,
              previousSchool: existing.previousSchool,
              secondaryAverage: existing.secondaryAverage,
              schoolCycle: existing.schoolCycle,
              status: 'LISTO_PARA_COBRO',
              validatedAt: new Date(),
              validatedBy: 'CONTROL_ESCOLAR',
              preRegistrationId: existing.id,
              guardian: {
                create: {
                  fullName: existing.guardianFullName,
                  relationship: existing.guardianRelationship,
                  phone: existing.guardianPhone,
                  email: existing.guardianEmail,
                },
              },
            },
          })

          linkedStudentId = student.id
        }
      }

      const item = await tx.preRegistration.update({
        where: { id },
        data: {
          status: input.status,
          reviewedAt: new Date(),
          reviewedBy: 'control.escolar',
          observationNotes: normalizeOptional(input.observationNotes),
        },
      })

      await tx.preRegistrationAudit.create({
        data: {
          preRegistrationId: item.id,
          action: input.status,
          actorRole: 'CONTROL_ESCOLAR',
          actorName: 'Control Escolar',
          detail: normalizeOptional(input.observationNotes) ?? undefined,
        },
      })

      if (input.status === 'PAGADO' && linkedStudentId) {
        await tx.student.update({
          where: { id: linkedStudentId },
          data: { status: 'COBRADO' },
        })
      }

      return item
    })

    return preRegistrationSummary(updated)
  })

  ipcMain.handle('students:list', async () => {
    const students = await prisma.student.findMany({
      orderBy: { createdAt: 'desc' },
    })

    return students.map(studentSummary)
  })

  ipcMain.handle('students:listValidated', async () => {
    const students = await prisma.student.findMany({
      where: { status: { in: ['VALIDADO', 'LISTO_PARA_COBRO', 'COBRADO'] } },
      orderBy: { createdAt: 'desc' },
    })

    return students.map(studentSummary)
  })

  ipcMain.handle('students:get', async (_event, studentId) => {
    const student = await prisma.student.findUnique({
      where: { id: z.string().min(1).parse(studentId) },
      include: { guardian: true },
    })

    if (!student) {
      throw new Error('No se encontro el alumno solicitado.')
    }

    return studentDetail(student)
  })

  ipcMain.handle('students:create', async (_event, payload) => {
    const input = studentInputSchema.parse(payload)
    const validated = input.validateNow

    const controlEscolarUser = await prisma.user.findUnique({
      where: { username: 'control.escolar' },
    })

    const student = await prisma.$transaction(async (tx) => {
      const createdStudent = await tx.student.create({
        data: {
          enrollmentNumber: input.enrollmentNumber.trim(),
          curp: input.curp.trim().toUpperCase(),
          rfc: normalizeOptional(input.rfc)?.toUpperCase(),
          firstName: input.firstName.trim(),
          paternalLastName: input.paternalLastName.trim(),
          maternalLastName: input.maternalLastName.trim(),
          birthDate: input.birthDate ? new Date(input.birthDate) : null,
          age: input.age ?? null,
          sex: normalizeOptional(input.sex),
          phone: normalizeOptional(input.phone),
          email: normalizeOptional(input.email),
          addressLine: input.addressLine.trim(),
          neighborhood: normalizeOptional(input.neighborhood),
          locality: normalizeOptional(input.locality),
          municipality: normalizeOptional(input.municipality),
          state: normalizeOptional(input.state),
          postalCode: normalizeOptional(input.postalCode),
          previousSchool: normalizeOptional(input.previousSchool),
          secondaryAverage: input.secondaryAverage ?? null,
          schoolCycle: input.schoolCycle.trim(),
          academicStatus: normalizeOptional(input.academicStatus),
          status: validated ? 'LISTO_PARA_COBRO' : 'CAPTURADO',
          validatedAt: validated ? new Date() : null,
          validatedBy: validated ? 'CONTROL_ESCOLAR' : null,
          guardian: {
            create: {
              fullName: input.guardianFullName.trim(),
              relationship: normalizeOptional(input.guardianRelationship),
              phone: input.guardianPhone.trim(),
              email: normalizeOptional(input.guardianEmail),
            },
          },
        },
      })

      await tx.auditLog.create({
        data: {
          userId: controlEscolarUser?.id ?? null,
          entityType: 'STUDENT',
          entityId: createdStudent.id,
          action: 'CREATE_STUDENT',
          afterJson: JSON.stringify({
            summary: `${createdStudent.enrollmentNumber} - ${createdStudent.firstName} ${createdStudent.paternalLastName}`,
          }),
        },
      })

      return createdStudent
    })

    return studentSummary(student)
  })

  ipcMain.handle('students:update', async (_event, studentId, payload) => {
    const id = z.string().min(1).parse(studentId)
    const input = studentInputSchema.parse(payload)
    const validated = input.validateNow

    const controlEscolarUser = await prisma.user.findUnique({
      where: { username: 'control.escolar' },
    })

    const existing = await prisma.student.findUnique({
      where: { id },
      include: { guardian: true },
    })

    if (!existing) {
      throw new Error('No se encontro el alumno para actualizar.')
    }

    const student = await prisma.$transaction(async (tx) => {
      const updatedStudent = await tx.student.update({
        where: { id },
        data: {
          enrollmentNumber: input.enrollmentNumber.trim(),
          curp: input.curp.trim().toUpperCase(),
          rfc: normalizeOptional(input.rfc)?.toUpperCase(),
          firstName: input.firstName.trim(),
          paternalLastName: input.paternalLastName.trim(),
          maternalLastName: input.maternalLastName.trim(),
          birthDate: input.birthDate ? new Date(input.birthDate) : null,
          age: input.age ?? null,
          sex: normalizeOptional(input.sex),
          phone: normalizeOptional(input.phone),
          email: normalizeOptional(input.email),
          addressLine: input.addressLine.trim(),
          neighborhood: normalizeOptional(input.neighborhood),
          locality: normalizeOptional(input.locality),
          municipality: normalizeOptional(input.municipality),
          state: normalizeOptional(input.state),
          postalCode: normalizeOptional(input.postalCode),
          previousSchool: normalizeOptional(input.previousSchool),
          secondaryAverage: input.secondaryAverage ?? null,
          schoolCycle: input.schoolCycle.trim(),
          academicStatus: normalizeOptional(input.academicStatus),
          status: validated ? 'LISTO_PARA_COBRO' : 'CAPTURADO',
          validatedAt: validated ? existing.validatedAt ?? new Date() : null,
          validatedBy: validated ? existing.validatedBy ?? 'CONTROL_ESCOLAR' : null,
          guardian: {
            upsert: {
              create: {
                fullName: input.guardianFullName.trim(),
                relationship: normalizeOptional(input.guardianRelationship),
                phone: input.guardianPhone.trim(),
                email: normalizeOptional(input.guardianEmail),
              },
              update: {
                fullName: input.guardianFullName.trim(),
                relationship: normalizeOptional(input.guardianRelationship),
                phone: input.guardianPhone.trim(),
                email: normalizeOptional(input.guardianEmail),
              },
            },
          },
        },
      })

      await tx.auditLog.create({
        data: {
          userId: controlEscolarUser?.id ?? null,
          entityType: 'STUDENT',
          entityId: updatedStudent.id,
          action: 'UPDATE_STUDENT',
          beforeJson: JSON.stringify({
            summary: `${existing.enrollmentNumber} - ${existing.firstName} ${existing.paternalLastName}`,
          }),
          afterJson: JSON.stringify({
            summary: `${updatedStudent.enrollmentNumber} - ${updatedStudent.firstName} ${updatedStudent.paternalLastName}`,
          }),
        },
      })

      return updatedStudent
    })

    return studentSummary(student)
  })

  ipcMain.handle('concepts:listActive', async () => {
    const concepts = await prisma.chargeConcept.findMany({
      where: { isActive: true },
      include: {
        tariffs: {
          where: { isActive: true },
          orderBy: { id: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ groupCode: 'asc' }, { code: 'asc' }],
    })

    return concepts.map(conceptSummary)
  })

  ipcMain.handle('concepts:updateTariff', async (_event, payload) => {
    const input = tariffUpdateSchema.parse(payload)
    const createdBy = await prisma.user.findUnique({
      where: { username: 'ingresos.propios' },
    })

    const concept = await prisma.chargeConcept.findUnique({
      where: { code: input.code },
      include: {
        tariffs: {
          where: { isActive: true },
          orderBy: { id: 'desc' },
          take: 1,
        },
      },
    })

    if (!concept) {
      throw new Error('No se encontro la clave para actualizar la tarifa.')
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (concept.tariffs[0]) {
        await tx.chargeTariff.update({
          where: { id: concept.tariffs[0].id },
          data: { isActive: false },
        })
      }

      await tx.chargeTariff.create({
        data: {
          conceptId: concept.id,
          amount: input.amount,
          periodLabel: input.periodLabel,
          isActive: true,
        },
      })

      await tx.auditLog.create({
        data: {
          userId: createdBy?.id ?? null,
          entityType: 'CHARGE_CONCEPT',
          entityId: concept.id,
          action: 'UPDATE_TARIFF',
          afterJson: JSON.stringify({
            summary: `${concept.code} - ${concept.name} - $${input.amount.toFixed(2)} (${input.periodLabel})`,
          }),
        },
      })

      return tx.chargeConcept.findUniqueOrThrow({
        where: { id: concept.id },
        include: {
          tariffs: {
            where: { isActive: true },
            orderBy: { id: 'desc' },
            take: 1,
          },
        },
      })
    })

    return conceptSummary(updated)
  })

  ipcMain.handle('receipts:create', async (_event, payload) => {
    const input = receiptInputSchema.parse(payload)

    const createdBy = await prisma.user.findUnique({
      where: { username: 'ingresos.propios' },
    })

    if (!createdBy) {
      throw new Error('No existe el usuario base de Ingresos Propios.')
    }

    const concepts = await prisma.chargeConcept.findMany({
      where: { code: { in: input.conceptCodes }, isActive: true },
      include: {
        tariffs: {
          where: { isActive: true },
          orderBy: { id: 'desc' },
          take: 1,
        },
      },
    })

    if (concepts.length !== input.conceptCodes.length) {
      throw new Error('Hay claves de cobro invalidas o inactivas.')
    }

    const totalAmount = concepts.reduce((sum, concept) => sum + Number(concept.tariffs[0]?.amount ?? 0), 0)

    const receipt = await prisma.$transaction(async (tx) => {
      const created = await tx.rocReceipt.create({
        data: {
          rocNumber: input.rocNumber.trim(),
          studentId: input.studentId,
          createdById: createdBy.id,
          totalAmount,
          status: 'EMITIDO',
          lines: {
            create: concepts.map((concept) => {
              const amount = Number(concept.tariffs[0]?.amount ?? 0)
              return {
                conceptId: concept.id,
                quantity: 1,
                unitAmount: amount,
                total: amount,
              }
            }),
          },
        },
        include: {
          student: true,
          lines: {
            include: {
              concept: true,
            },
          },
        },
      })

      await tx.student.update({
        where: { id: input.studentId },
        data: { status: 'COBRADO' },
      })

      await tx.auditLog.create({
        data: {
          userId: createdBy.id,
          entityType: 'ROC_RECEIPT',
          entityId: created.id,
          action: 'CREATE_ROC',
          afterJson: JSON.stringify({
            summary: `${created.rocNumber} - ${created.student.firstName} ${created.student.paternalLastName}`,
          }),
        },
      })

      return created
    })

    return receiptSummary(receipt)
  })

  ipcMain.handle('receipts:listByStudent', async (_event, studentId) => {
    const parsedStudentId = z.string().min(1).parse(studentId)
    const receipts = await prisma.rocReceipt.findMany({
      where: { studentId: parsedStudentId },
      orderBy: { issuedAt: 'desc' },
      include: {
        student: true,
        lines: {
          include: {
            concept: true,
          },
        },
      },
    })

    return receipts.map(receiptSummary)
  })

  ipcMain.handle('receipts:listAll', async () => {
    const receipts = await prisma.rocReceipt.findMany({
      orderBy: { issuedAt: 'desc' },
      include: {
        student: true,
        lines: {
          include: {
            concept: true,
          },
        },
      },
    })

    return receipts.map(receiptSummary)
  })

  ipcMain.handle('receipts:openOfficialTemplate', async (_event, payload) => {
    const input = printReceiptSchema.parse(payload)

    const student = await prisma.student.findUnique({
      where: { id: input.studentId },
    })

    if (!student) {
      throw new Error('Alumno no encontrado para generar el ROC oficial.')
    }

    const concepts = await prisma.chargeConcept.findMany({
      where: { code: { in: input.conceptCodes }, isActive: true },
      include: {
        tariffs: {
          where: { isActive: true },
          orderBy: { id: 'desc' },
          take: 1,
        },
      },
    })

    const totalAmount = concepts.reduce((sum, concept) => sum + Number(concept.tariffs[0]?.amount ?? 0), 0)
    const outputPath = await openOfficialRocTemplate({
      rocNumber: input.rocNumber,
      fullName: `${student.paternalLastName} ${student.maternalLastName} ${student.firstName}`,
      identifier: student.rfc || student.enrollmentNumber,
      address: [student.addressLine, student.neighborhood, student.locality, student.municipality, student.state]
        .filter(Boolean)
        .join(', '),
      grade: '',
      group: '',
      shift: '',
      printDate: new Date().toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
        year: '2-digit',
      }),
      totalAmount,
      amountInWords: amountToWords(totalAmount),
      lines: concepts.map((concept) => ({
        code: concept.code,
        name: concept.name,
        amount: Number(concept.tariffs[0]?.amount ?? 0),
      })),
    })

    return { outputPath, mode: app.isPackaged ? 'electron-packaged' : 'electron-dev' }
  })

  ipcMain.handle('receipts:reprint', async (_event, receiptId) => {
    const parsedReceiptId = z.string().min(1).parse(receiptId)
    const createdBy = await prisma.user.findUnique({
      where: { username: 'ingresos.propios' },
    })

    const { receipt, outputPath } = await buildOfficialTemplateFromReceipt(parsedReceiptId)

    await prisma.$transaction(async (tx) => {
      await tx.rocReceipt.update({
        where: { id: parsedReceiptId },
        data: { status: 'REIMPRESO' },
      })

      await tx.auditLog.create({
        data: {
          userId: createdBy?.id ?? null,
          entityType: 'ROC_RECEIPT',
          entityId: parsedReceiptId,
          action: 'REPRINT_ROC',
          afterJson: JSON.stringify({
            summary: `${receipt.rocNumber} - ${receipt.student.firstName} ${receipt.student.paternalLastName}`,
          }),
        },
      })
    })

    return { outputPath, mode: app.isPackaged ? 'electron-packaged' : 'electron-dev' }
  })

  ipcMain.handle('audit:listRecent', async () => {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 12,
      include: {
        user: {
          select: {
            displayName: true,
          },
        },
      },
    })

    return logs.map(auditSummary)
  })
}
