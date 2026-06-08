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
  GroupAssignedRosterRow,
  GroupPreviewRow,
  GroupRosterExportResult,
  GroupRosterImportResult,
  GroupRosterImportRow,
  GroupStat,
  RocCancelInput,
  RocConfigSummary,
  RocConfigUpdateInput,
  RocMonthlyExportInput,
  RocReceiptSummary,
  StudentFormInput,
  StudentSummary,
  TariffUpdateInput,
  DepartmentSummary,
  UserCreateInput,
  UserResetPasswordInput,
  UserSummary,
  UserUpdateInput,
} from '../src/types/domain'
import { prisma } from './prisma'
import { buildPasswordHash } from '../shared/auth-password'

const INTERNAL_FOLIO_PREFIX = '2610701044'
const ROC_INITIAL_SETTING_KEY = 'ROC_INITIAL_NUMBER'

type RemoteActor = {
  id: string
  username: string
  displayName: string
  role: string
}

type DepartmentRecord = {
  id: string
  code: string
  name: string
  description: string | null
  isActive: boolean
}

type UserRecord = {
  id: string
  username: string
  displayName: string
  role: string
  departmentId: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  department: DepartmentRecord | null
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

function departmentSummary(department: DepartmentRecord): DepartmentSummary {
  return {
    id: department.id,
    code: department.code,
    name: department.name,
    description: department.description,
    isActive: department.isActive,
  }
}

function userSummary(user: UserRecord): UserSummary {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as UserSummary['role'],
    departmentId: user.departmentId,
    departmentName: user.department?.name ?? null,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

async function assertActiveDepartment(departmentId: string | null | undefined) {
  if (!departmentId) {
    return null
  }

  const department = await prisma.department.findUnique({ where: { id: departmentId } })
  if (!department || !department.isActive) {
    throw new Error('Selecciona un departamento activo.')
  }

  return department
}

async function assertCanChangeAdminStatus(userId: string, nextRole: UserSummary['role'], nextIsActive: boolean) {
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } })
  if (!current) {
    throw new Error('No se encontro el usuario.')
  }

  const removesActiveAdmin = current.role === 'ADMIN' && current.isActive && (nextRole !== 'ADMIN' || !nextIsActive)
  if (!removesActiveAdmin) {
    return
  }

  const activeAdminCount = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } })
  if (activeAdminCount <= 1) {
    throw new Error('Debe quedar al menos un administrador activo.')
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

const ASSIGNMENT_GROUP_COUNT = 10
const ASSIGNMENT_MAX_CAPACITY = 40
const MATUTINO_SHIFT = 'MATUTINO'

type AssignmentSex = 'MUJER' | 'HOMBRE' | 'NO_ESPECIFICADO'
type AssignmentBand = 'alto' | 'medio' | 'bajo'

function avgBand(value: number | null) {
  if (value == null) return 'medio' as const
  if (value >= 8.5) return 'alto' as const
  if (value >= 7) return 'medio' as const
  return 'bajo' as const
}

function sexBucket(value: string | null) {
  const normalized = (value ?? '').trim().toUpperCase()
  if (normalized.startsWith('M') && normalized !== 'MASCULINO') return 'MUJER' as const
  if (normalized.startsWith('F')) return 'MUJER' as const
  if (normalized.startsWith('H')) return 'HOMBRE' as const
  if (normalized.startsWith('MASC')) return 'HOMBRE' as const
  return 'NO_ESPECIFICADO' as const
}

function buildGroupLabel(index: number) {
  return `1${String.fromCharCode(65 + index)}`
}

function buildPerGroupTargets(total: number, groupCount: number) {
  const base = Math.floor(total / groupCount)
  const remainder = total % groupCount
  return Array.from({ length: groupCount }, (_item, index) => base + (index < remainder ? 1 : 0))
}

function buildProportionalTargets(capacities: number[], totalCount: number) {
  if (capacities.length === 0) return []
  const totalCapacity = capacities.reduce((sum, item) => sum + item, 0)
  if (totalCapacity <= 0 || totalCount <= 0) return capacities.map(() => 0)

  const base = capacities.map((capacity) => Math.floor((capacity / totalCapacity) * totalCount))
  let assigned = base.reduce((sum, item) => sum + item, 0)
  const remainders = capacities.map((capacity, index) => ({
    index,
    remainder: (capacity / totalCapacity) * totalCount - base[index],
  }))
  remainders.sort((left, right) => right.remainder - left.remainder)

  for (const item of remainders) {
    if (assigned >= totalCount) break
    base[item.index] += 1
    assigned += 1
  }

  return base
}

function buildAssignmentStats(groups: Array<{ id: string; label: string; capacity: number; assignments: Array<{ status: string; student: { sex: string | null; secondaryAverage: unknown } }> }>): GroupStat[] {
  return groups.map((group) => {
    const assigned = group.assignments.filter((item) => item.status !== 'NO_SHOW')
    const totals = {
      MUJER: 0,
      HOMBRE: 0,
      NO_ESPECIFICADO: 0,
      alto: 0,
      medio: 0,
      bajo: 0,
    }

    for (const entry of assigned) {
      totals[sexBucket(entry.student.sex)] += 1
      totals[avgBand(entry.student.secondaryAverage == null ? null : Number(entry.student.secondaryAverage))] += 1
    }

    return {
      groupId: group.id,
      label: group.label,
      capacity: group.capacity,
      assignedCount: assigned.length,
      available: group.capacity - assigned.length,
      bands: { alto: totals.alto, medio: totals.medio, bajo: totals.bajo },
      sex: { mujer: totals.MUJER, hombre: totals.HOMBRE, noEspecificado: totals.NO_ESPECIFICADO },
    }
  })
}

function selectTargetGroupByQuota<TGroup extends { id: string; label: string; capacity: number }>(
  groups: TGroup[],
  stats: Map<string, { assigned: number; MUJER: number; HOMBRE: number; NO_ESPECIFICADO: number; alto: number; medio: number; bajo: number }>,
  sexTargets: Map<string, { MUJER: number; HOMBRE: number; NO_ESPECIFICADO: number }>,
  sex: AssignmentSex,
  band: AssignmentBand,
  desiredBandPerGroup: { alto: number; medio: number; bajo: number },
) {
  const candidates = groups.filter((group) => {
    const target = sexTargets.get(group.id)
    const stat = stats.get(group.id)
    if (!target || !stat) return false
    if (stat.assigned >= group.capacity) return false
    return stat[sex] < target[sex]
  })

  const pool = candidates.length > 0 ? candidates : groups.filter((group) => (stats.get(group.id)?.assigned ?? 0) < group.capacity)
  if (pool.length === 0) return null

  pool.sort((left, right) => {
    const leftStats = stats.get(left.id)!
    const rightStats = stats.get(right.id)!
    const leftBandGap = Math.abs((leftStats[band] + 1) - desiredBandPerGroup[band])
    const rightBandGap = Math.abs((rightStats[band] + 1) - desiredBandPerGroup[band])
    if (leftBandGap !== rightBandGap) return leftBandGap - rightBandGap
    if (leftStats.assigned !== rightStats.assigned) return leftStats.assigned - rightStats.assigned
    return left.label.localeCompare(right.label)
  })

  return pool[0]
}

function buildFixedAssignmentPlan<TStudent extends { id: string; sex: string | null; secondaryAverage: unknown }, TGroup extends { id: string; label: string; capacity: number }>(
  students: TStudent[],
  groups: TGroup[],
) {
  const normalizedStudents: Array<{ student: TStudent; band: AssignmentBand; sex: AssignmentSex }> = students.map((student) => ({
    student,
    band: avgBand(student.secondaryAverage == null ? null : Number(student.secondaryAverage)),
    sex: sexBucket(student.sex),
  }))

  const totals = {
    MUJER: normalizedStudents.filter((item) => item.sex === 'MUJER').length,
    HOMBRE: normalizedStudents.filter((item) => item.sex === 'HOMBRE').length,
    NO_ESPECIFICADO: normalizedStudents.filter((item) => item.sex === 'NO_ESPECIFICADO').length,
    alto: normalizedStudents.filter((item) => item.band === 'alto').length,
    medio: normalizedStudents.filter((item) => item.band === 'medio').length,
    bajo: normalizedStudents.filter((item) => item.band === 'bajo').length,
    total: normalizedStudents.length,
  }

  const totalTargets = buildPerGroupTargets(normalizedStudents.length, groups.length)
  const mujerTargets = buildProportionalTargets(totalTargets, totals.MUJER)
  const remainingAfterWomen = totalTargets.map((target, index) => target - mujerTargets[index])
  const hombreTargets = buildProportionalTargets(remainingAfterWomen, totals.HOMBRE)
  const remainingAfterMen = remainingAfterWomen.map((target, index) => target - hombreTargets[index])
  const noTargets = buildProportionalTargets(remainingAfterMen, totals.NO_ESPECIFICADO)
  const desiredBandPerGroup = {
    alto: totals.alto / Math.max(1, groups.length),
    medio: totals.medio / Math.max(1, groups.length),
    bajo: totals.bajo / Math.max(1, groups.length),
  }

  const sexTargets = new Map(
    groups.map((group, index) => [
      group.id,
      {
        MUJER: mujerTargets[index],
        HOMBRE: hombreTargets[index],
        NO_ESPECIFICADO: noTargets[index],
      },
    ]),
  )

  const stats = new Map(
    groups.map((group) => [
      group.id,
      { assigned: 0, MUJER: 0, HOMBRE: 0, NO_ESPECIFICADO: 0, alto: 0, medio: 0, bajo: 0 },
    ]),
  )

  const assignments: Array<{ group: TGroup; student: TStudent; band: AssignmentBand; sex: AssignmentSex }> = []
  for (const item of normalizedStudents) {
    const target = selectTargetGroupByQuota(
      groups.filter((group) => (stats.get(group.id)?.assigned ?? 0) < ((sexTargets.get(group.id)?.MUJER ?? 0) + (sexTargets.get(group.id)?.HOMBRE ?? 0) + (sexTargets.get(group.id)?.NO_ESPECIFICADO ?? 0))),
      stats,
      sexTargets,
      item.sex,
      item.band,
      desiredBandPerGroup,
    )
    if (!target) continue
    assignments.push({ group: target, student: item.student, band: item.band, sex: item.sex })
    const stat = stats.get(target.id)
    if (stat) {
      stat.assigned += 1
      stat[item.sex] += 1
      stat[item.band] += 1
    }
  }

  return assignments
}

function assignedRosterRow(entry: { status: string; student: { enrollmentNumber: string; firstName: string; paternalLastName: string; maternalLastName: string; curp: string; sex: string | null; secondaryAverage: unknown }; group: { label: string } }): GroupAssignedRosterRow {
  const average = entry.student.secondaryAverage == null ? null : Number(entry.student.secondaryAverage)
  return {
    groupLabel: entry.group.label,
    enrollmentNumber: entry.student.enrollmentNumber,
    fullName: `${entry.student.firstName} ${entry.student.paternalLastName} ${entry.student.maternalLastName}`.trim(),
    curp: entry.student.curp,
    sex: entry.student.sex ?? 'N/E',
    secondaryAverage: average,
    averageBand: avgBand(average),
    status: entry.status,
  }
}

function buildAssignedRosterWorkbook(rows: GroupAssignedRosterRow[]) {
  const grouped = new Map<string, string[][]>()
  for (const row of rows) {
    const list = grouped.get(row.groupLabel) ?? []
    list.push([
      row.groupLabel,
      row.enrollmentNumber,
      row.fullName,
      row.curp,
      row.sex,
      row.secondaryAverage == null ? 'N/E' : row.secondaryAverage.toFixed(1),
      row.averageBand.toUpperCase(),
      row.status,
    ])
    grouped.set(row.groupLabel, list)
  }

  const workbook = XLSX.utils.book_new()
  for (const [groupLabel, data] of grouped) {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Grupo', 'Folio interno', 'Alumno', 'CURP', 'Sexo', 'Promedio', 'Banda', 'Estatus'],
      ...data,
    ])
    worksheet['!cols'] = [{ wch: 10 }, { wch: 18 }, { wch: 42 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(workbook, worksheet, groupLabel)
  }
  return workbook
}

function normalizeImportedGroupLabel(value: string) {
  const normalized = value.trim().toUpperCase()
  if (/^[A-Z]$/.test(normalized)) return `1${normalized}`
  return normalized
}

function extractEnrollmentSequenceKey(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  if (!normalized) return null
  if (/^\d{1,4}$/.test(normalized)) {
    return normalized.padStart(4, '0')
  }
  const match = normalized.match(/(\d{4})$/)
  return match ? match[1] : null
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

export async function listDepartments() {
  const departments = await prisma.department.findMany({ orderBy: { name: 'asc' } })
  return departments.map(departmentSummary)
}

export async function listUsers() {
  const users = await prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { username: 'asc' }],
    include: { department: true },
  })
  return users.map(userSummary)
}

export async function listGroupStats(schoolCycle: string): Promise<GroupStat[]> {
  const groups = await prisma.intakeGroup.findMany({
    where: { schoolCycle: schoolCycle.trim(), shift: MATUTINO_SHIFT, isActive: true },
    orderBy: { label: 'asc' },
    include: { assignments: { include: { student: true } } },
  })
  return buildAssignmentStats(groups)
}

export async function previewGroupStats(schoolCycle: string): Promise<GroupStat[]> {
  const students = await prisma.student.findMany({
    where: {
      schoolCycle: schoolCycle.trim(),
      status: { in: ['VALIDADO', 'LISTO_PARA_COBRO', 'COBRADO'] },
      enrollmentStatus: { not: 'NO_SHOW' },
    },
    orderBy: [{ secondaryAverage: 'desc' }, { curp: 'asc' }],
    select: { id: true, sex: true, secondaryAverage: true },
  })

  const buckets = Array.from({ length: ASSIGNMENT_GROUP_COUNT }, (_item, index) => ({
    id: `preview-${index + 1}`,
    groupId: `preview-${index + 1}`,
    label: buildGroupLabel(index),
    capacity: ASSIGNMENT_MAX_CAPACITY,
    assignedCount: 0,
    available: ASSIGNMENT_MAX_CAPACITY,
    bands: { alto: 0, medio: 0, bajo: 0 },
    sex: { mujer: 0, hombre: 0, noEspecificado: 0 },
  }))

  const plan = buildFixedAssignmentPlan(students, buckets)
  for (const entry of plan) {
    entry.group.assignedCount += 1
    entry.group.available = entry.group.capacity - entry.group.assignedCount
    entry.group.bands[entry.band] += 1
    if (entry.sex === 'MUJER') entry.group.sex.mujer += 1
    else if (entry.sex === 'HOMBRE') entry.group.sex.hombre += 1
    else entry.group.sex.noEspecificado += 1
  }

  return buckets
}

export async function previewGroupRoster(schoolCycle: string): Promise<GroupPreviewRow[]> {
  const students = await prisma.student.findMany({
    where: {
      schoolCycle: schoolCycle.trim(),
      status: { in: ['VALIDADO', 'LISTO_PARA_COBRO', 'COBRADO'] },
      enrollmentStatus: { not: 'NO_SHOW' },
    },
    orderBy: [{ secondaryAverage: 'desc' }, { curp: 'asc' }],
    select: {
      id: true,
      enrollmentNumber: true,
      firstName: true,
      paternalLastName: true,
      maternalLastName: true,
      curp: true,
      sex: true,
      secondaryAverage: true,
    },
  })

  const groups = Array.from({ length: ASSIGNMENT_GROUP_COUNT }, (_item, index) => ({
    id: `preview-${index + 1}`,
    label: buildGroupLabel(index),
    capacity: ASSIGNMENT_MAX_CAPACITY,
  }))

  const rows = buildFixedAssignmentPlan(students, groups).map((entry) => ({
    groupLabel: entry.group.label,
    enrollmentNumber: entry.student.enrollmentNumber,
    fullName: `${entry.student.firstName} ${entry.student.paternalLastName} ${entry.student.maternalLastName}`,
    curp: entry.student.curp,
    sex: entry.student.sex ?? 'N/E',
    averageBand: entry.band,
    secondaryAverage: entry.student.secondaryAverage == null ? null : Number(entry.student.secondaryAverage),
  }))

  return rows.sort((left, right) => {
    if (left.groupLabel !== right.groupLabel) return left.groupLabel.localeCompare(right.groupLabel)
    return left.fullName.localeCompare(right.fullName)
  })
}

export async function autoAssignGroups(schoolCycle: string, actor: RemoteActor) {
  const normalizedCycle = schoolCycle.trim()
  const students = await prisma.student.findMany({
    where: {
      schoolCycle: normalizedCycle,
      status: { in: ['VALIDADO', 'LISTO_PARA_COBRO', 'COBRADO'] },
      enrollmentStatus: { not: 'NO_SHOW' },
    },
    include: { groupAssignment: true },
    orderBy: [{ secondaryAverage: 'desc' }, { curp: 'asc' }],
  })
  const labels = Array.from({ length: ASSIGNMENT_GROUP_COUNT }, (_item, index) => buildGroupLabel(index))
  await prisma.$transaction(labels.map((label) => prisma.intakeGroup.upsert({
    where: { schoolCycle_label_shift: { schoolCycle: normalizedCycle, label, shift: MATUTINO_SHIFT } },
    update: { isActive: true, capacity: ASSIGNMENT_MAX_CAPACITY },
    create: { schoolCycle: normalizedCycle, label, shift: MATUTINO_SHIFT, capacity: ASSIGNMENT_MAX_CAPACITY },
  })))

  const groups = await prisma.intakeGroup.findMany({ where: { schoolCycle: normalizedCycle, shift: MATUTINO_SHIFT, isActive: true }, orderBy: { label: 'asc' } })
  const plannedAssignments = buildFixedAssignmentPlan(students, groups)
  const plannedGroupByStudentId = new Map(plannedAssignments.map((entry) => [entry.student.id, entry.group]))

  await prisma.$transaction(async (tx) => {
    for (const student of students) {
      const target = plannedGroupByStudentId.get(student.id)
      if (!target) throw new Error('No hay cupo disponible para continuar la asignacion.')
      const existing = student.groupAssignment
      const assignment = existing
        ? await tx.studentGroupAssignment.update({ where: { id: existing.id }, data: { groupId: target.id, status: 'ASIGNADO', updatedById: actor.id, reason: 'REMOTE_AUTO_ASIGNACION' } })
        : await tx.studentGroupAssignment.create({ data: { studentId: student.id, groupId: target.id, status: 'ASIGNADO', assignedById: actor.id, updatedById: actor.id, reason: 'REMOTE_AUTO_ASIGNACION' } })
      await tx.student.update({ where: { id: student.id }, data: { enrollmentStatus: 'ASIGNADO' } })
      await tx.groupAssignmentAudit.create({ data: { assignmentId: assignment.id, studentId: student.id, beforeGroupId: existing?.groupId ?? null, afterGroupId: target.id, beforeGroupLabel: null, afterGroupLabel: target.label, actorId: actor.id, actorRole: actor.role, reason: 'REMOTE_AUTO_ASIGNACION' } })
    }
  })

  return { ok: true, assignedCount: students.length, groupCount: groups.length }
}

export async function confirmGroupAssignments(schoolCycle: string) {
  const normalizedCycle = schoolCycle.trim()
  const count = await prisma.studentGroupAssignment.updateMany({ where: { student: { schoolCycle: normalizedCycle }, status: 'ASIGNADO' }, data: { status: 'CONFIRMADO', confirmedAt: new Date() } })
  await prisma.student.updateMany({ where: { schoolCycle: normalizedCycle, enrollmentStatus: 'ASIGNADO' }, data: { enrollmentStatus: 'CONFIRMADO' } })
  return { ok: true, confirmed: count.count }
}

export async function listAssignedRoster(schoolCycle: string): Promise<GroupAssignedRosterRow[]> {
  const rows = await prisma.studentGroupAssignment.findMany({
    where: {
      status: { in: ['ASIGNADO', 'CONFIRMADO'] },
      student: { schoolCycle: schoolCycle.trim() },
    },
    include: { student: true, group: true },
    orderBy: [{ group: { label: 'asc' } }, { student: { paternalLastName: 'asc' } }],
  })
  return rows.map(assignedRosterRow)
}

export async function exportAssignedRoster(schoolCycle: string): Promise<GroupRosterExportResult & { workbookBase64: string; fileName: string }> {
  const roster = await listAssignedRoster(schoolCycle)
  const workbook = buildAssignedRosterWorkbook(roster)
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const fileName = `grupos-asignados-${Date.now()}.xlsx`
  return {
    outputPath: fileName,
    exportedCount: roster.length,
    workbookBase64: Buffer.from(buffer).toString('base64'),
    fileName,
  }
}

export async function manualReassignGroup(studentId: string, toGroupId: string, reason: string, actor: RemoteActor) {
  const assignment = await prisma.studentGroupAssignment.findUnique({ where: { studentId }, include: { group: true } })
  if (!assignment) throw new Error('El alumno no tiene grupo asignado.')
  const target = await prisma.intakeGroup.findUnique({ where: { id: toGroupId }, include: { assignments: { where: { status: { not: 'NO_SHOW' } } } } })
  if (!target) throw new Error('Grupo destino no encontrado.')
  if (target.assignments.length >= target.capacity) throw new Error(`El grupo destino ya alcanzo el cupo maximo de ${target.capacity}.`)
  const item = await prisma.studentGroupAssignment.update({ where: { id: assignment.id }, data: { groupId: target.id, status: 'ASIGNADO', updatedById: actor.id, reason: reason.trim() } })
  await prisma.groupAssignmentAudit.create({ data: { assignmentId: assignment.id, studentId, beforeGroupId: assignment.groupId, beforeGroupLabel: assignment.group.label, afterGroupId: target.id, afterGroupLabel: target.label, actorId: actor.id, actorRole: actor.role, reason: reason.trim() } })
  return { ok: true, assignmentId: item.id }
}

export async function markGroupNoShow(studentId: string, reason: string, actor: RemoteActor) {
  const assignment = await prisma.studentGroupAssignment.findUnique({ where: { studentId } })
  if (!assignment) throw new Error('El alumno no tiene una asignacion previa.')
  await prisma.$transaction(async (tx) => {
    await tx.studentGroupAssignment.update({ where: { id: assignment.id }, data: { status: 'NO_SHOW', updatedById: actor.id, reason: reason.trim() } })
    await tx.student.update({ where: { id: studentId }, data: { enrollmentStatus: 'NO_SHOW' } })
    await tx.groupAssignmentAudit.create({ data: { assignmentId: assignment.id, studentId, beforeGroupId: assignment.groupId, afterGroupId: assignment.groupId, actorId: actor.id, actorRole: actor.role, reason: `REMOTE_NO_SHOW: ${reason.trim()}` } })
  })
  return { ok: true }
}

export async function importAssignedRosterRows(schoolCycle: string, rows: GroupRosterImportRow[], sourcePath: string | null | undefined, actor: RemoteActor): Promise<GroupRosterImportResult> {
  const dedupedRows = new Map<string, GroupRosterImportRow>()
  const issues: string[] = []
  for (const row of rows) {
    const key = row.curp ? `curp:${row.curp}` : `folio:${row.enrollmentNumber}`
    if (dedupedRows.has(key)) {
      issues.push(`Fila ${row.rowNumber} en ${row.sheetName}: se repite el alumno ${row.curp ?? row.enrollmentNumber}; se conserva la ultima asignacion.`)
    }
    dedupedRows.set(key, row)
  }

  const normalizedCycle = schoolCycle.trim()
  const uniqueRows = Array.from(dedupedRows.values()).map((row) => ({
    ...row,
    groupLabel: normalizeImportedGroupLabel(row.groupLabel),
  }))
  const groupLabels = Array.from(new Set(uniqueRows.map((row) => row.groupLabel))).sort((left, right) => left.localeCompare(right))
  const existingGroups = await prisma.intakeGroup.findMany({ where: { schoolCycle: normalizedCycle, shift: MATUTINO_SHIFT, label: { in: groupLabels } }, select: { label: true } })
  const existingGroupLabels = new Set(existingGroups.map((group) => group.label))
  await prisma.$transaction(groupLabels.map((label) => prisma.intakeGroup.upsert({
    where: { schoolCycle_label_shift: { schoolCycle: normalizedCycle, label, shift: MATUTINO_SHIFT } },
    update: { isActive: true, capacity: ASSIGNMENT_MAX_CAPACITY },
    create: { schoolCycle: normalizedCycle, label, shift: MATUTINO_SHIFT, capacity: ASSIGNMENT_MAX_CAPACITY },
  })))

  const groups = await prisma.intakeGroup.findMany({ where: { schoolCycle: normalizedCycle, shift: MATUTINO_SHIFT, label: { in: groupLabels } }, select: { id: true, label: true } })
  const groupByLabel = new Map(groups.map((group) => [group.label, group]))
  const students = await prisma.student.findMany({
    where: {
      schoolCycle: normalizedCycle,
    },
    include: { groupAssignment: { include: { group: true } } },
  })
  const studentByEnrollment = new Map(students.map((student) => [student.enrollmentNumber, student]))
  const studentByCurp = new Map(students.map((student) => [student.curp.toUpperCase(), student]))
  const studentBySequence = new Map(students.map((student) => [extractEnrollmentSequenceKey(student.enrollmentNumber), student] as const).filter((entry): entry is [string, typeof students[number]] => Boolean(entry[0])))
  let importedCount = 0
  let unmatchedCount = 0

  for (const row of uniqueRows) {
    const enrollmentSequenceKey = extractEnrollmentSequenceKey(row.enrollmentNumber)
    const student =
      (row.enrollmentNumber ? studentByEnrollment.get(row.enrollmentNumber) : undefined) ??
      (row.curp ? studentByCurp.get(row.curp) : undefined) ??
      (enrollmentSequenceKey ? studentBySequence.get(enrollmentSequenceKey) : undefined)
    if (!student) {
      unmatchedCount += 1
      issues.push(`Fila ${row.rowNumber} en ${row.sheetName}: no se encontro alumno para ${row.curp ?? row.enrollmentNumber} en el ciclo ${normalizedCycle}.`)
      continue
    }
    const targetGroup = groupByLabel.get(row.groupLabel)
    if (!targetGroup) {
      unmatchedCount += 1
      issues.push(`Fila ${row.rowNumber} en ${row.sheetName}: el grupo ${row.groupLabel} no pudo prepararse para importar.`)
      continue
    }
    const existingAssignment = student.groupAssignment
    await prisma.$transaction(async (tx) => {
      const assignment = existingAssignment
        ? await tx.studentGroupAssignment.update({ where: { id: existingAssignment.id }, data: { groupId: targetGroup.id, status: 'ASIGNADO', updatedById: actor.id, reason: 'REMOTE_IMPORTACION_EXCEL' } })
        : await tx.studentGroupAssignment.create({ data: { studentId: student.id, groupId: targetGroup.id, status: 'ASIGNADO', assignedById: actor.id, updatedById: actor.id, reason: 'REMOTE_IMPORTACION_EXCEL' } })
      await tx.student.update({ where: { id: student.id }, data: { enrollmentStatus: 'ASIGNADO' } })
      await tx.groupAssignmentAudit.create({ data: { assignmentId: assignment.id, studentId: student.id, beforeGroupId: existingAssignment?.groupId ?? null, beforeGroupLabel: existingAssignment?.group.label ?? null, afterGroupId: targetGroup.id, afterGroupLabel: targetGroup.label, actorId: actor.id, actorRole: actor.role, reason: 'REMOTE_IMPORTACION_EXCEL' } })
    })
    importedCount += 1
  }

  return {
    ok: true,
    canceled: false,
    sourcePath: sourcePath ?? null,
    importedCount,
    createdGroupCount: groupLabels.filter((label) => !existingGroupLabels.has(label)).length,
    skippedCount: 0,
    unmatchedCount,
    issues: issues.slice(0, 12),
  }
}

export async function createUser(input: UserCreateInput, actor: RemoteActor) {
  const username = input.username.trim().toLowerCase()
  const department = await assertActiveDepartment(input.departmentId ?? null)

  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          displayName: input.displayName.trim(),
          role: input.role,
          departmentId: department?.id ?? null,
          isActive: input.isActive,
          passwordHash: buildPasswordHash(input.password),
        },
        include: { department: true },
      })

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          entityType: 'USER',
          entityId: user.id,
          action: 'REMOTE_CREATE_USER',
          afterJson: JSON.stringify({ summary: `${user.username} - ${user.displayName}`, role: user.role }),
        },
      })

      return user
    })

    return userSummary(created)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error('El nombre de usuario ya existe.')
    }

    throw error
  }
}

export async function updateUser(userId: string, input: UserUpdateInput, actor: RemoteActor) {
  const department = await assertActiveDepartment(input.departmentId ?? null)
  await assertCanChangeAdminStatus(userId, input.role, input.isActive)

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        displayName: input.displayName.trim(),
        role: input.role,
        departmentId: department?.id ?? null,
        isActive: input.isActive,
      },
      include: { department: true },
    })

    await tx.auditLog.create({
      data: {
        userId: actor.id,
        entityType: 'USER',
        entityId: user.id,
        action: 'REMOTE_UPDATE_USER',
        afterJson: JSON.stringify({ summary: `${user.username} - ${user.displayName}`, role: user.role, isActive: user.isActive }),
      },
    })

    return user
  })

  return userSummary(updated)
}

export async function resetUserPassword(userId: string, input: UserResetPasswordInput, actor: RemoteActor) {
  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { passwordHash: buildPasswordHash(input.password) },
      include: { department: true },
    })

    await tx.auditLog.create({
      data: {
        userId: actor.id,
        entityType: 'USER',
        entityId: user.id,
        action: 'REMOTE_RESET_USER_PASSWORD',
        afterJson: JSON.stringify({ summary: `${user.username} - ${user.displayName}` }),
      },
    })

    return user
  })

  return userSummary(updated)
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
