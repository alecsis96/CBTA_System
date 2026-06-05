import { Prisma } from '../prisma/generated/backend-client'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as XLSX from 'xlsx'
import { amountToWords } from '../src/lib/formatters'
import type {
  CashPaymentBatchCreateInput,
  CashPaymentCreateInput,
  CashPaymentSummary,
  ChargeConceptSummary,
  ConceptSuggestionUpdateInput,
  RocCancelInput,
  RocConfigSummary,
  RocConfigUpdateInput,
  RocMonthlyExportInput,
  RocReceiptSummary,
  StudentFormInput,
  StudentSummary,
  TariffUpdateInput,
} from '../src/types/domain'
import { prisma } from './prisma'

const INTERNAL_FOLIO_PREFIX = '2610701044'
const ROC_INITIAL_SETTING_KEY = 'ROC_INITIAL_NUMBER'

type RemoteActor = {
  id: string
  username: string
  displayName: string
  role: string
}

type StudentSummaryRecord = Prisma.StudentGetPayload<{
  include: {
    guardian: true
    admissionPayment: { select: { status: true } }
    groupAssignment: { include: { group: true } }
    cashPayments: { select: { status: true }; orderBy: { createdAt: 'desc' }; take: 1 }
  }
}>

type CashPaymentRecord = Prisma.CashPaymentGetPayload<{
  include: {
    student: true
    lines: { include: { concept: true } }
  }
}>

type ReceiptRecord = Prisma.RocReceiptGetPayload<{
  include: {
    student: true
    lines: { include: { concept: true } }
  }
}>

type OfficialRocPayload = {
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
  lines: Array<{
    code: string
    name: string
    amount: number
  }>
}

function normalizeOptional(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function enrollmentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    PENDIENTE_ASIGNACION: 'Pendiente de asignacion',
    INSCRITO: 'Inscrito',
    EN_PROCESO: 'En proceso',
    BAJA: 'Baja',
  }
  return labels[status] ?? status
}

function studentSummary(student: StudentSummaryRecord): StudentSummary {
  const latestCashPayment = student.cashPayments[0] ?? null
  return {
    id: student.id,
    fullName: `${student.firstName} ${student.paternalLastName} ${student.maternalLastName}`.replace(/\s+/g, ' ').trim(),
    firstName: student.firstName,
    paternalLastName: student.paternalLastName,
    maternalLastName: student.maternalLastName,
    enrollmentNumber: student.enrollmentNumber,
    officialEnrollmentNumber: student.officialEnrollmentNumber,
    curp: student.curp,
    rfc: student.rfc,
    phone: student.phone ?? null,
    email: student.email ?? null,
    address: [student.addressLine, student.neighborhood, student.locality, student.municipality, student.state].filter(Boolean).join(', '),
    guardianFullName: student.guardian?.fullName ?? null,
    guardianPhone: student.guardian?.phone ?? null,
    admissionPaid: Boolean(student.admissionPayment) || Boolean(latestCashPayment),
    admissionPaymentStatus: latestCashPayment?.status ?? student.admissionPayment?.status ?? null,
    documentationStatus: student.documentationStatus,
    statusLabel: enrollmentStatusLabel(student.enrollmentStatus),
    groupLabel: student.groupAssignment?.group.label ?? null,
    shiftLabel: student.groupAssignment?.group.shift ?? null,
  }
}

function conceptSummary(concept: Prisma.ChargeConceptGetPayload<{ include: { tariffs: true } }>): ChargeConceptSummary {
  const latestTariff = concept.tariffs[0] ?? null
  return {
    code: concept.code,
    groupCode: concept.groupCode,
    name: concept.name,
    description: concept.description,
    amount: latestTariff ? Number(latestTariff.amount) : 0,
    periodLabel: latestTariff?.periodLabel ?? 'Sin tarifa',
    isSuggested: concept.isSuggested,
    excludeFromRoc: concept.excludeFromRoc,
    isLifeInsurance: concept.isLifeInsurance,
  }
}

function cashPaymentSummary(payment: CashPaymentRecord): CashPaymentSummary {
  const studentName = `${payment.student.firstName} ${payment.student.paternalLastName} ${payment.student.maternalLastName}`.replace(/\s+/g, ' ').trim()
  const rocLines = payment.lines.filter((line) => !line.concept.excludeFromRoc)
  const externalLines = payment.lines.filter((line) => line.concept.excludeFromRoc)
  return {
    id: payment.id,
    studentId: payment.studentId,
    studentName,
    enrollmentNumber: payment.student.enrollmentNumber,
    totalAmount: payment.lines.reduce((sum, line) => sum + Number(line.total), 0),
    rocTotalAmount: rocLines.reduce((sum, line) => sum + Number(line.total), 0),
    externalTotalAmount: externalLines.reduce((sum, line) => sum + Number(line.total), 0),
    createdAt: payment.createdAt.toISOString(),
    status: payment.status as CashPaymentSummary['status'],
    conceptLabels: payment.lines.map((line) => `${line.concept.code} ${line.concept.name}`),
    externalConceptLabels: externalLines.map((line) => `${line.concept.code} ${line.concept.name}`),
    notes: payment.notes ?? null,
  }
}

function receiptSummary(receipt: ReceiptRecord): RocReceiptSummary {
  return {
    id: receipt.id,
    rocNumber: receipt.rocNumber,
    studentId: receipt.studentId,
    studentName: `${receipt.student.firstName} ${receipt.student.paternalLastName} ${receipt.student.maternalLastName}`.replace(/\s+/g, ' ').trim(),
    totalAmount: Number(receipt.totalAmount),
    issuedAt: receipt.issuedAt.toISOString(),
    status: receipt.status,
    conceptLabels: receipt.lines.map((line) => `${line.concept.code} ${line.concept.name}`),
  }
}

async function buildStudentInternalFolio(tx: { sequenceCounter: typeof prisma.sequenceCounter }) {
  const sequence = await tx.sequenceCounter.upsert({
    where: { scope: 'STUDENT_INTERNAL_FOLIO' },
    update: { lastValue: { increment: 1 } },
    create: { scope: 'STUDENT_INTERNAL_FOLIO', lastValue: 1 },
  })

  return `${INTERNAL_FOLIO_PREFIX}${String(sequence.lastValue).padStart(4, '0')}`
}

function buildNextRocNumber(base: string, offset: number) {
  const match = base.match(/^(.*?)(\d+)$/)
  if (!match) {
    if (offset === 0) return base
    return `${base}-${offset + 1}`
  }

  const prefix = match[1]
  const digits = match[2]
  const next = String(Number(digits) + offset).padStart(digits.length, '0')
  return `${prefix}${next}`
}

export async function getNextRocNumberSuggestion() {
  const baseSetting = await readRocInitialSetting()
  const lastReceipt = await prisma.rocReceipt.findFirst({
    orderBy: { rocNumber: 'desc' },
    select: { rocNumber: true },
  })

  const lastRocNumber = lastReceipt?.rocNumber ?? null
  const initialRocNumber = baseSetting?.value?.trim() || 'DGETAYCM-ROC-0001'
  const suggestedRocNumber = lastRocNumber ? buildNextRocNumber(lastRocNumber, 1) : initialRocNumber
  return { suggestedRocNumber, lastRocNumber }
}

export async function getRocConfig(): Promise<RocConfigSummary> {
  const baseSetting = await readRocInitialSetting()
  const next = await getNextRocNumberSuggestion()
  const initialRocNumber = baseSetting?.value?.trim() || 'DGETAYCM-ROC-0001'
  return {
    initialRocNumber,
    lastRocNumber: next.lastRocNumber,
    nextSuggestedRocNumber: next.lastRocNumber ? next.suggestedRocNumber : initialRocNumber,
  }
}

export async function updateRocConfig(input: RocConfigUpdateInput): Promise<RocConfigSummary> {
  await prisma.appSetting.upsert({
    where: { key: ROC_INITIAL_SETTING_KEY },
    update: { value: input.initialRocNumber.trim() },
    create: { key: ROC_INITIAL_SETTING_KEY, value: input.initialRocNumber.trim() },
  })
  return getRocConfig()
}

async function readRocInitialSetting() {
  try {
    return await prisma.appSetting.findUnique({
      where: { key: ROC_INITIAL_SETTING_KEY },
      select: { value: true },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2021' || error.code === 'P2022')) {
      return null
    }

    throw error
  }
}

async function assertRocNumberAvailable(rocNumber: string) {
  const normalized = rocNumber.trim()
  const existing = await prisma.rocReceipt.findUnique({
    where: { rocNumber: normalized },
    select: { id: true },
  })

  if (existing) {
    throw new Error(`El ROC ${normalized} ya existe. Usa el siguiente consecutivo disponible.`)
  }
}

function cloneSheet<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function sanitizeSheetName(value: string, fallback: string) {
  const cleaned = value.replace(/[\[\]\*\?:\\/]/g, ' ').replace(/\s+/g, ' ').trim()
  const bounded = cleaned.slice(0, 31)
  return bounded || fallback
}

function formatPeriodLabel(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function buildMonthBounds(year: number, month: number) {
  const from = new Date(year, month - 1, 1, 0, 0, 0, 0)
  const to = new Date(year, month, 1, 0, 0, 0, 0)
  return { from, to }
}

function formatRocPrintDate(value: Date) {
  return value.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  })
}

function receiptToOfficialPayload(receipt: ReceiptRecord): OfficialRocPayload {
  return {
    rocNumber: receipt.rocNumber,
    fullName: `${receipt.student.paternalLastName} ${receipt.student.maternalLastName} ${receipt.student.firstName}`.replace(/\s+/g, ' ').trim(),
    identifier: receipt.student.rfc || receipt.student.enrollmentNumber,
    address: [receipt.student.addressLine, receipt.student.neighborhood, receipt.student.locality, receipt.student.municipality, receipt.student.state]
      .filter(Boolean)
      .join(', '),
    grade: '',
    group: '',
    shift: 'MATUTINO',
    printDate: formatRocPrintDate(receipt.issuedAt),
    totalAmount: Number(receipt.totalAmount),
    amountInWords: amountToWords(Number(receipt.totalAmount)),
    lines: receipt.lines.map((line) => ({
      code: line.concept.code,
      name: line.concept.name,
      amount: Number(line.unitAmount),
    })),
  }
}

function sortableConceptKey(conceptLabels: string[]) {
  return [...conceptLabels].sort((left, right) => left.localeCompare(right)).join('||')
}

async function restorePaymentAfterReceiptCancellation(receipt: ReceiptRecord) {
  const receiptConceptKey = sortableConceptKey(
    receipt.lines.map((line) => `${line.concept.code} ${line.concept.name}`),
  )
  const receiptTotal = Number(receipt.totalAmount)

  const candidatePayments = await prisma.cashPayment.findMany({
    where: {
      studentId: receipt.studentId,
      status: 'ROC_GENERADO',
    },
    orderBy: { batchGeneratedAt: 'desc' },
    include: {
      lines: {
        include: {
          concept: true,
        },
      },
    },
  })

  const matchingPayments = candidatePayments.filter((payment) => {
    const printableLines = payment.lines.filter((line) => !line.concept.excludeFromRoc)
    const paymentTotal = printableLines.reduce((sum, line) => sum + Number(line.total), 0)
    if (paymentTotal !== receiptTotal) return false

    const paymentConceptKey = sortableConceptKey(
      printableLines.map((line) => `${line.concept.code} ${line.concept.name}`),
    )

    return paymentConceptKey === receiptConceptKey
  })

  if (matchingPayments.length !== 1) {
    return { restoredPaymentId: null as string | null }
  }

  const targetPayment = matchingPayments[0]
  await prisma.cashPayment.update({
    where: { id: targetPayment.id },
    data: {
      status: 'PENDIENTE_ROC',
      batchGeneratedAt: null,
    },
  })
  await prisma.student.update({
    where: { id: receipt.studentId },
    data: { status: 'LISTO_PARA_COBRO' },
  })

  return { restoredPaymentId: targetPayment.id }
}

function applyOfficialRocPayload(sheet: XLSX.WorkSheet, payload: OfficialRocPayload) {
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
}

function loadOfficialTemplateWorkbook() {
  const templatePath = path.join(process.cwd(), 'roc 2026.xlsx')
  if (!fs.existsSync(templatePath)) {
    throw new Error('No se encontro la plantilla oficial roc 2026.xlsx en la raiz del proyecto.')
  }

  return XLSX.readFile(templatePath, { cellStyles: true, cellFormula: true })
}

function exportOfficialWorkbookBase64(payloads: OfficialRocPayload[]) {
  if (payloads.length === 0) {
    throw new Error('No hay ROC para exportar en el periodo seleccionado.')
  }

  const workbook = loadOfficialTemplateWorkbook()
  const firstSheetName = workbook.SheetNames[0]
  const baseSheet = cloneSheet(workbook.Sheets[firstSheetName])

  workbook.SheetNames = []
  workbook.Sheets = {}

  payloads.forEach((payload, index) => {
    const fallbackName = `ROC ${index + 1}`
    const preferredName = sanitizeSheetName(payload.rocNumber, fallbackName)
    const sheetName = workbook.Sheets[preferredName] ? sanitizeSheetName(`${preferredName}-${index + 1}`, fallbackName) : preferredName
    const sheet = cloneSheet(baseSheet)
    applyOfficialRocPayload(sheet, payload)
    workbook.SheetNames.push(sheetName)
    workbook.Sheets[sheetName] = sheet
  })

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  return Buffer.from(buffer).toString('base64')
}

export async function listStudents(validatedOnly = false) {
  const students = await prisma.student.findMany({
    where: validatedOnly ? { status: { in: ['VALIDADO', 'LISTO_PARA_COBRO', 'COBRADO'] } } : undefined,
    include: {
      guardian: true,
      admissionPayment: { select: { status: true } },
      groupAssignment: { include: { group: true } },
      cashPayments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
  })

  return students.map(studentSummary)
}

export async function getStudent(studentId: string) {
  return prisma.student.findUnique({
    where: { id: studentId },
    include: { guardian: true },
  })
}

export async function getNextInternalFolioPreview() {
  const counter = await prisma.sequenceCounter.findUnique({ where: { scope: 'STUDENT_INTERNAL_FOLIO' } })
  const nextValue = (counter?.lastValue ?? 0) + 1
  return `${INTERNAL_FOLIO_PREFIX}${String(nextValue).padStart(4, '0')}`
}

async function ensurePaymentAnchor(curp: string) {
  return prisma.admissionPayment.findFirst({
    where: { curp: curp.trim().toUpperCase() },
    orderBy: { createdAt: 'desc' },
  })
}

function studentMutationData(input: StudentFormInput, validated: boolean, paymentAnchorId: string) {
  return {
    curp: input.curp.trim().toUpperCase(),
    rfc: normalizeOptional(input.rfc)?.toUpperCase(),
    firstName: input.firstName.trim(),
    paternalLastName: input.paternalLastName.trim(),
    maternalLastName: input.maternalLastName.trim(),
    birthDate: input.birthDate ? new Date(input.birthDate) : null,
    age: input.age ?? null,
    sex: normalizeOptional(input.sex),
    phone: normalizeOptional(input.phone),
    studentPhoneSecondary: normalizeOptional(input.studentPhoneSecondary),
    email: normalizeOptional(input.email),
    motherTongue: normalizeOptional(input.motherTongue),
    addressLine: input.addressLine.trim(),
    neighborhood: normalizeOptional(input.neighborhood),
    locality: normalizeOptional(input.locality),
    municipality: normalizeOptional(input.municipality),
    state: normalizeOptional(input.state),
    postalCode: normalizeOptional(input.postalCode),
    previousSchool: normalizeOptional(input.previousSchool),
    secondaryAverage: input.secondaryAverage ?? null,
    examRoom: normalizeOptional(input.examRoom),
    schoolCycle: input.schoolCycle.trim(),
    academicStatus: normalizeOptional(input.academicStatus),
    documentationStatus: 'PENDIENTE',
    status: validated ? 'LISTO_PARA_COBRO' : 'CAPTURADO',
    validatedAt: validated ? new Date() : null,
    validatedBy: validated ? 'CONTROL_ESCOLAR' : null,
    admissionPaymentId: paymentAnchorId,
  }
}

export async function createStudent(input: StudentFormInput, actor: RemoteActor) {
  const paymentAnchor = await ensurePaymentAnchor(input.curp)
  if (!paymentAnchor) throw new Error('Primero debes registrar el pago de ficha para este CURP.')
  const validated = input.validateNow

  const created = await prisma.$transaction(async (tx) => {
    const student = await tx.student.create({
      data: {
        ...studentMutationData(input, validated, paymentAnchor.id),
        enrollmentNumber: await buildStudentInternalFolio(tx),
        enrollmentStatus: 'INSCRITO',
        guardian: {
          create: {
            fullName: input.guardianFullName.trim(),
            relationship: normalizeOptional(input.guardianRelationship),
            phone: input.guardianPhone.trim(),
            secondaryPhone: normalizeOptional(input.guardianPhoneSecondary),
            email: normalizeOptional(input.guardianEmail),
          },
        },
      },
      include: {
        guardian: true,
        admissionPayment: { select: { status: true } },
        groupAssignment: { include: { group: true } },
        cashPayments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })

    const requirements = await tx.enrollmentRequirement.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })
    if (requirements.length > 0) {
      await tx.studentRequirementStatus.createMany({
        data: requirements.map((requirement) => ({ studentId: student.id, requirementId: requirement.id })),
      })
    }

    await tx.auditLog.create({
      data: {
        userId: actor.id,
        entityType: 'STUDENT',
        entityId: student.id,
        action: 'REMOTE_CREATE_STUDENT',
        afterJson: JSON.stringify({ summary: `${student.enrollmentNumber} - ${student.firstName} ${student.paternalLastName}` }),
      },
    })

    return student
  })

  return studentSummary(created)
}

export async function updateStudent(studentId: string, input: StudentFormInput, actor: RemoteActor) {
  const existing = await prisma.student.findUnique({ where: { id: studentId } })
  if (!existing) throw new Error('No se encontro el alumno para actualizar.')
  const paymentAnchor = await ensurePaymentAnchor(input.curp)
  if (!paymentAnchor) throw new Error('Primero debes registrar el pago de ficha para este CURP.')
  const validated = input.validateNow

  const updated = await prisma.$transaction(async (tx) => {
    const student = await tx.student.update({
      where: { id: studentId },
      data: {
        ...studentMutationData(input, validated, paymentAnchor.id),
        enrollmentStatus: existing.enrollmentStatus || 'INSCRITO',
        guardian: {
          upsert: {
            create: {
              fullName: input.guardianFullName.trim(),
              relationship: normalizeOptional(input.guardianRelationship),
              phone: input.guardianPhone.trim(),
              secondaryPhone: normalizeOptional(input.guardianPhoneSecondary),
              email: normalizeOptional(input.guardianEmail),
            },
            update: {
              fullName: input.guardianFullName.trim(),
              relationship: normalizeOptional(input.guardianRelationship),
              phone: input.guardianPhone.trim(),
              secondaryPhone: normalizeOptional(input.guardianPhoneSecondary),
              email: normalizeOptional(input.guardianEmail),
            },
          },
        },
      },
      include: {
        guardian: true,
        admissionPayment: { select: { status: true } },
        groupAssignment: { include: { group: true } },
        cashPayments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })

    await tx.auditLog.create({
      data: {
        userId: actor.id,
        entityType: 'STUDENT',
        entityId: student.id,
        action: 'REMOTE_UPDATE_STUDENT',
        afterJson: JSON.stringify({ summary: `${student.enrollmentNumber} - ${student.firstName} ${student.paternalLastName}` }),
      },
    })

    return student
  })

  return studentSummary(updated)
}

export async function listConcepts() {
  const concepts = await prisma.chargeConcept.findMany({
    where: { isActive: true },
    include: { tariffs: { where: { isActive: true }, orderBy: { id: 'desc' }, take: 1 } },
    orderBy: { code: 'asc' },
  })
  return concepts.map(conceptSummary)
}

export async function updateConceptTariff(input: TariffUpdateInput, actor: RemoteActor) {
  const concept = await prisma.chargeConcept.findUnique({ where: { code: input.code } })
  if (!concept) throw new Error('No se encontro la clave a actualizar.')
  const updated = await prisma.$transaction(async (tx) => {
    await tx.chargeTariff.updateMany({ where: { conceptId: concept.id, isActive: true }, data: { isActive: false } })
    await tx.chargeTariff.create({ data: { conceptId: concept.id, amount: input.amount, periodLabel: input.periodLabel, isActive: true } })
    await tx.auditLog.create({
      data: { userId: actor.id, entityType: 'CHARGE_CONCEPT', entityId: concept.id, action: 'REMOTE_UPDATE_TARIFF', afterJson: JSON.stringify(input) },
    })
    return tx.chargeConcept.findUniqueOrThrow({
      where: { id: concept.id },
      include: { tariffs: { where: { isActive: true }, orderBy: { id: 'desc' }, take: 1 } },
    })
  })
  return conceptSummary(updated)
}

export async function updateConceptSuggested(input: ConceptSuggestionUpdateInput, actor: RemoteActor) {
  const updated = await prisma.chargeConcept.update({
    where: { code: input.code },
    data: { isSuggested: input.isSuggested },
    include: { tariffs: { where: { isActive: true }, orderBy: { id: 'desc' }, take: 1 } },
  })
  await prisma.auditLog.create({
    data: { userId: actor.id, entityType: 'CHARGE_CONCEPT', entityId: updated.id, action: 'REMOTE_UPDATE_SUGGESTED', afterJson: JSON.stringify(input) },
  })
  return conceptSummary(updated)
}

export async function listPayments(status?: CashPaymentSummary['status']) {
  const payments = await prisma.cashPayment.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    include: { student: true, lines: { include: { concept: true } } },
  })
  return payments.map(cashPaymentSummary)
}

export async function createPayment(input: CashPaymentCreateInput, actor: RemoteActor) {
  const student = await prisma.student.findUnique({ where: { id: input.studentId }, select: { id: true } })
  if (!student) throw new Error('Alumno no encontrado para registrar el cobro.')
  const concepts = await prisma.chargeConcept.findMany({ where: { code: { in: input.conceptItems.map((item) => item.code) }, isActive: true } })
  if (concepts.length !== input.conceptItems.length) throw new Error('Hay claves de cobro invalidas o inactivas.')
  const conceptByCode = new Map(concepts.map((concept) => [concept.code, concept]))

  const created = await prisma.cashPayment.create({
    data: {
      studentId: input.studentId,
      createdById: actor.id,
      notes: input.notes?.trim() || null,
      lines: {
        create: input.conceptItems.map((item) => {
          const concept = conceptByCode.get(item.code)
          if (!concept) throw new Error(`No se encontro la clave ${item.code}.`)
          return { conceptId: concept.id, quantity: 1, unitAmount: item.amount, total: item.amount }
        }),
      },
    },
    include: { student: true, lines: { include: { concept: true } } },
  })

  await prisma.auditLog.create({
    data: { userId: actor.id, entityType: 'CASH_PAYMENT', entityId: created.id, action: 'REMOTE_CREATE_PAYMENT', afterJson: JSON.stringify({ studentId: input.studentId }) },
  })

  return cashPaymentSummary(created)
}

export async function generateBatch(input: CashPaymentBatchCreateInput, actor: RemoteActor) {
  const payments = await prisma.cashPayment.findMany({
    where: { id: { in: input.paymentIds }, status: 'PENDIENTE_ROC' },
    orderBy: { createdAt: 'asc' },
    include: { student: true, lines: { include: { concept: true } } },
  })
  if (payments.length === 0) throw new Error('No hay cobros pendientes seleccionados para generar el ROC masivo.')

  await Promise.all(
    payments.map((payment, index) => assertRocNumberAvailable(buildNextRocNumber(input.startingRocNumber.trim(), index))),
  )

  const createdEntries = await prisma.$transaction(async (tx) => {
    const generated: Array<{ receipt: ReceiptRecord; payment: CashPaymentRecord }> = []
    for (const [index, payment] of payments.entries()) {
      const rocNumber = buildNextRocNumber(input.startingRocNumber.trim(), index)
      const printableLines = payment.lines.filter((line) => !line.concept.excludeFromRoc)
      if (printableLines.length === 0) {
        throw new Error(`El cobro de ${payment.student.firstName} ${payment.student.paternalLastName} no tiene conceptos imprimibles para ROC.`)
      }

      const totalAmount = printableLines.reduce((sum, line) => sum + Number(line.total), 0)
      const receipt = await tx.rocReceipt.create({
        data: {
          rocNumber,
          studentId: payment.studentId,
          createdById: actor.id,
          totalAmount,
          amountInWords: amountToWords(totalAmount),
          status: 'EMITIDO',
          lines: {
            create: printableLines.map((line) => ({ conceptId: line.conceptId, quantity: line.quantity, unitAmount: line.unitAmount, total: line.total })),
          },
        },
        include: { student: true, lines: { include: { concept: true } } },
      })

      await tx.cashPayment.update({ where: { id: payment.id }, data: { status: 'ROC_GENERADO', batchGeneratedAt: new Date() } })
      await tx.student.update({ where: { id: payment.studentId }, data: { status: 'COBRADO' } })
      await tx.auditLog.create({
        data: { userId: actor.id, entityType: 'ROC_BATCH', entityId: payment.id, action: 'REMOTE_CREATE_BATCH_ROC', afterJson: JSON.stringify({ rocNumber }) },
      })

      generated.push({ receipt, payment })
    }
    return generated
  })

  const now = new Date()
  const periodLabel = formatPeriodLabel(now.getFullYear(), now.getMonth() + 1)
  const { from, to } = buildMonthBounds(now.getFullYear(), now.getMonth() + 1)
  const monthlyReceipts = await prisma.rocReceipt.findMany({
    where: {
      status: { not: 'ANULADO' },
      issuedAt: {
        gte: from,
        lt: to,
      },
    },
    orderBy: { issuedAt: 'asc' },
    include: { student: true, lines: { include: { concept: true } } },
  })
  const workbookBase64 = exportOfficialWorkbookBase64(monthlyReceipts.map(receiptToOfficialPayload))
  const first = createdEntries[0].receipt.rocNumber
  const last = createdEntries[createdEntries.length - 1].receipt.rocNumber

  return {
    ok: true,
    outputPath: `roc-mensual-${periodLabel}.xlsx`,
    createdCount: createdEntries.length,
    firstRocNumber: first,
    lastRocNumber: last,
    workbookBase64,
    fileName: `roc-mensual-${periodLabel}.xlsx`,
  }
}

export async function exportMonthlyReceipts(input: RocMonthlyExportInput) {
  const { from, to } = buildMonthBounds(input.year, input.month)
  const receipts = await prisma.rocReceipt.findMany({
    where: {
      status: { not: 'ANULADO' },
      issuedAt: {
        gte: from,
        lt: to,
      },
    },
    orderBy: { issuedAt: 'asc' },
    include: { student: true, lines: { include: { concept: true } } },
  })

  if (receipts.length === 0) {
    throw new Error('No hay ROC generados en el mes seleccionado.')
  }

  const periodLabel = formatPeriodLabel(input.year, input.month)
  return {
    ok: true,
    outputPath: `roc-mensual-${periodLabel}.xlsx`,
    exportedCount: receipts.length,
    periodLabel,
    workbookBase64: exportOfficialWorkbookBase64(receipts.map(receiptToOfficialPayload)),
    fileName: `roc-mensual-${periodLabel}.xlsx`,
  }
}

export async function listReceipts() {
  const receipts = await prisma.rocReceipt.findMany({
    orderBy: { issuedAt: 'desc' },
    include: { student: true, lines: { include: { concept: true } } },
  })
  return receipts.map(receiptSummary)
}

export async function listReceiptsByStudent(studentId: string) {
  const receipts = await prisma.rocReceipt.findMany({
    where: { studentId },
    orderBy: { issuedAt: 'desc' },
    include: { student: true, lines: { include: { concept: true } } },
  })
  return receipts.map(receiptSummary)
}

export async function cancelReceipt(input: RocCancelInput, actor: RemoteActor) {
  const receipt = await prisma.rocReceipt.findUnique({
    where: { id: input.receiptId },
    include: { student: true, lines: { include: { concept: true } } },
  })

  if (!receipt) {
    throw new Error('No se encontro el ROC que queres anular.')
  }

  if (receipt.status === 'ANULADO') {
    throw new Error(`El ROC ${receipt.rocNumber} ya estaba anulado.`)
  }

  const restored = await restorePaymentAfterReceiptCancellation(receipt)

  const updated = await prisma.rocReceipt.update({
    where: { id: input.receiptId },
    data: { status: 'ANULADO' },
    include: { student: true, lines: { include: { concept: true } } },
  })

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      entityType: 'ROC_RECEIPT',
      entityId: input.receiptId,
      action: 'REMOTE_CANCEL_ROC',
      beforeJson: JSON.stringify({ rocNumber: receipt.rocNumber, status: receipt.status }),
      afterJson: JSON.stringify({
        rocNumber: updated.rocNumber,
        status: 'ANULADO',
        reason: input.reason.trim(),
        restoredPaymentId: restored.restoredPaymentId,
      }),
    },
  })

  return receiptSummary(updated)
}

export async function listRecentAuditLogs(limit = 12) {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit, include: { user: true } })
  return logs.map((log) => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    actorName: log.user?.displayName ?? 'Sistema remoto',
    createdAt: log.createdAt.toISOString(),
    detail: (() => {
      try {
        const after = log.afterJson ? JSON.parse(log.afterJson) : null
        return typeof after?.summary === 'string' ? after.summary : log.action
      } catch {
        return log.action
      }
    })(),
  }))
}
