import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import * as XLSX from 'xlsx'
import { prisma } from './db'
import { exportOfficialRocTemplateBatch, openOfficialRocTemplate, type RocTemplatePayload } from './roc-template'
import { getGeneratedRocsDir } from './runtime-paths'
import { buildPasswordHash, verifyPassword } from '../shared/auth-password'

type AppRole = 'CONTROL_ESCOLAR' | 'INGRESOS_PROPIOS' | 'SECRETARIA' | 'ADMIN'

type SessionUser = {
  id: string
  username: string
  displayName: string
  role: AppRole
}

let currentSession: SessionUser | null = null
const ROC_INITIAL_SETTING_KEY = 'ROC_INITIAL_NUMBER'
const appRoleSchema = z.enum(['CONTROL_ESCOLAR', 'INGRESOS_PROPIOS', 'SECRETARIA', 'ADMIN'])
const semesterLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)])
const studentDailyStatusSchema = z.enum(['PRESENTE', 'PERMISO', 'AUSENTE'])
const studentPermissionKindSchema = z.enum(['PERMISO_GENERAL', 'SALIDA_ANTICIPADA', 'DIA_COMPLETO', 'JUSTIFICANTE_MEDICO'])
const studentPermissionStatusSchema = z.enum(['PROGRAMADO', 'ACTIVO', 'CERRADO', 'CANCELADO'])

const authLoginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
})

const saveWorkbookSchema = z.object({
  fileName: z.string().trim().min(1),
  base64: z.string().min(1),
})

const adminUserCreateSchema = z.object({
  username: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  role: appRoleSchema,
  departmentId: z.string().trim().min(1).nullable().optional(),
  isActive: z.boolean().default(true),
  password: z.string().min(8),
})

const adminUserUpdateSchema = z.object({
  displayName: z.string().trim().min(1),
  role: appRoleSchema,
  departmentId: z.string().trim().min(1).nullable().optional(),
  isActive: z.boolean(),
})

const adminUserResetPasswordSchema = z.object({
  password: z.string().min(8),
})

function authSessionSummary() {
  return currentSession
}

function requireAuth() {
  if (!currentSession) {
    throw new Error('No autorizado: inicia sesion para continuar.')
  }

  return currentSession
}

function requireRole(allowedRoles: AppRole[], actionLabel: string) {
  const session = requireAuth()
  if (!allowedRoles.includes(session.role)) {
    throw new Error(`No autorizado: ${session.role} no puede ${actionLabel}.`)
  }

  return session
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

function departmentSummary(department: DepartmentRecord) {
  return {
    id: department.id,
    code: department.code,
    name: department.name,
    description: department.description,
    isActive: department.isActive,
  }
}

function userSummary(user: UserRecord) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as AppRole,
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

async function assertCanChangeAdminStatus(userId: string, nextRole: AppRole, nextIsActive: boolean) {
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

const studentInputSchema = z.object({
  enrollmentNumber: z.string().trim().optional().or(z.literal('')),
  curp: z.string().min(18).max(18),
  rfc: z.string().trim().optional().nullable(),
  firstName: z.string().min(1),
  paternalLastName: z.string().min(1),
  maternalLastName: z.string().min(1),
  birthDate: z.string().optional().nullable(),
  age: z.number().int().min(0).max(120).optional().nullable(),
  sex: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  studentPhoneSecondary: z.string().trim().optional().nullable(),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  motherTongue: z.string().trim().optional().nullable(),
  addressLine: z.string().min(1),
  neighborhood: z.string().trim().optional().nullable(),
  locality: z.string().trim().optional().nullable(),
  municipality: z.string().trim().optional().nullable(),
  state: z.string().trim().optional().nullable(),
  postalCode: z.string().trim().optional().nullable(),
  previousSchool: z.string().trim().optional().nullable(),
  secondaryAverage: z.number().min(0).max(10).optional().nullable(),
  examRoom: z.string().trim().optional().nullable(),
  schoolCycle: z.string().min(1),
  schoolPeriod: z.number().int().min(1).max(2).default(1),
  semesterLevel: semesterLevelSchema.default(1),
  academicStatus: z.string().trim().optional().nullable(),
  guardianFullName: z.string().min(1),
  guardianRelationship: z.string().trim().optional().nullable(),
  guardianPhone: z.string().min(1),
  guardianPhoneSecondary: z.string().trim().optional().nullable(),
  guardianEmail: z.string().email().optional().or(z.literal('')).nullable(),
  validateNow: z.boolean().default(false),
})

const studentListFiltersSchema = z.object({
  schoolCycle: z.string().trim().optional(),
  schoolPeriod: z.number().int().min(1).max(2).optional(),
  semesterLevel: z.union([semesterLevelSchema, z.literal('all')]).optional(),
  enrollmentStatus: z.string().trim().optional(),
  documentationStatus: z.string().trim().optional(),
  query: z.string().trim().optional(),
}).optional()

const studentGroupChangeSchema = z.object({
  studentId: z.string().min(1),
  toGroupId: z.string().min(1),
  reasonCode: z.string().trim().min(1),
  notes: z.string().trim().optional(),
})

const studentWithdrawalSchema = z.object({
  studentId: z.string().min(1),
  reasonCode: z.string().trim().min(1),
  notes: z.string().trim().optional(),
  effectiveDate: z.string().trim().optional(),
})

const studentGradeEnrollmentSchema = z.object({
  studentId: z.string().min(1),
  schoolCycle: z.string().trim().min(1),
  schoolPeriod: z.number().int().min(1).max(2).default(1),
  semesterLevel: semesterLevelSchema,
  toGroupId: z.string().trim().min(1).nullable().optional(),
  reasonCode: z.string().trim().min(1),
  notes: z.string().trim().optional(),
})

const studentMovementListSchema = z.object({
  studentId: z.string().trim().optional(),
  schoolCycle: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).optional()

const enrollmentRosterImportSchema = z.object({
  schoolCycle: z.string().trim().min(1),
  sourcePath: z.string().trim().nullable().optional(),
  rows: z.array(z.object({
    sheetName: z.string().trim().min(1),
    rowNumber: z.number().int().min(1),
    enrollmentNumber: z.string().trim().min(1),
    officialEnrollmentNumber: z.string().trim().nullable().optional(),
    importKind: z.enum(['MATRICULA', 'FICHA']).optional(),
    fullName: z.string().trim().min(1),
    curp: z.string().trim().min(18).max(18),
    sex: z.string().trim().nullable().optional(),
    age: z.number().int().min(0).max(120).nullable().optional(),
    groupLabel: z.string().trim().min(1),
    career: z.string().trim().nullable().optional(),
    semesterLevel: semesterLevelSchema,
    previousSchool: z.string().trim().nullable().optional(),
    locality: z.string().trim().nullable().optional(),
    phone: z.string().trim().nullable().optional(),
    email: z.string().trim().nullable().optional(),
    motherTongue: z.string().trim().nullable().optional(),
    guardianFullName: z.string().trim().nullable().optional(),
    guardianPhone: z.string().trim().nullable().optional(),
    secondaryAverage: z.number().min(0).max(10).nullable().optional(),
  })).min(1),
})

const permissionListFiltersSchema = z
  .object({
    query: z.string().trim().optional(),
    status: z.string().trim().optional(),
    activeOn: z.string().trim().optional(),
  })
  .optional()

const permissionCreateSchema = z.object({
  studentId: z.string().min(1),
  kind: studentPermissionKindSchema.default('PERMISO_GENERAL'),
  reason: z.string().trim().min(3),
  notes: z.string().trim().optional(),
  startsAt: z.string().trim().min(1),
  endsAt: z.string().trim().min(1),
})

const permissionCancelSchema = z.object({
  permissionId: z.string().min(1),
  notes: z.string().trim().optional(),
})

const formalizeEnrollmentSchema = z.object({
  studentId: z.string().min(1),
  allowPendingDocuments: z.boolean().default(false),
  notes: z.string().trim().optional(),
})

const reinscribeForPeriodSchema = z.object({
  studentId: z.string().min(1),
  targetSchoolCycle: z.string().trim().min(1),
  targetPeriod: z.number().int().min(1).max(2).default(1),
  targetSemesterLevel: semesterLevelSchema,
  toGroupId: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().optional(),
})

const graduatePeriodSchema = z.object({
  studentId: z.string().min(1).optional(),
  studentIds: z.array(z.string().min(1)).optional(),
  fromSchoolCycle: z.string().trim().min(1),
  fromPeriod: z.number().int().min(1).max(2).optional(),
  notes: z.string().trim().optional(),
}).refine((input) => Boolean(input.studentId) || Boolean(input.studentIds?.length), {
  message: 'Selecciona al menos un alumno para egresar.',
})

const dailyStatusSetSchema = z.object({
  studentId: z.string().min(1),
  date: z.string().trim().min(1),
  status: z.enum(['AUSENTE', 'PRESENTE']),
  notes: z.string().trim().optional(),
})

const dailyStatusClearSchema = z.object({
  studentId: z.string().min(1),
  date: z.string().trim().min(1),
})

const receiptInputSchema = z.object({
  rocNumber: z.string().min(1),
  studentId: z.string().min(1),
  conceptCodes: z.array(z.string().min(1)).min(1),
  conceptItems: z.array(z.object({ code: z.string().min(1), amount: z.number().min(0) })).optional(),
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

const conceptSuggestionUpdateSchema = z.object({
  code: z.string().min(1),
  isSuggested: z.boolean(),
})

const cancelReceiptSchema = z.object({
  receiptId: z.string().min(1),
  reason: z.string().trim().min(3),
})

const cashPaymentCreateSchema = z.object({
  studentId: z.string().min(1),
  conceptItems: z.array(z.object({ code: z.string().min(1), amount: z.number().min(0) })).min(1),
  notes: z.string().trim().optional(),
})

const cashPaymentListFiltersSchema = z
  .object({
    status: z.enum(['PENDIENTE_ROC', 'ROC_GENERADO']).optional(),
  })
  .optional()

const cashPaymentBatchCreateSchema = z.object({
  paymentIds: z.array(z.string().min(1)).min(1),
  startingRocNumber: z.string().min(1),
})

const rocConfigSchema = z.object({
  initialRocNumber: z.string().trim().min(1),
})

const monthlyReceiptExportSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
})

const preRegistrationCreateSchema = z.object({
  firstName: z.string().min(1),
  paternalLastName: z.string().min(1),
  maternalLastName: z.string().min(1),
  curp: z.string().min(18).max(18),
  birthDate: z.string().optional().nullable(),
  sex: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  studentPhoneSecondary: z.string().trim().optional().nullable(),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  motherTongue: z.string().trim().optional().nullable(),
  addressLine: z.string().min(1),
  neighborhood: z.string().trim().optional().nullable(),
  locality: z.string().trim().optional().nullable(),
  municipality: z.string().trim().optional().nullable(),
  state: z.string().trim().optional().nullable(),
  postalCode: z.string().trim().optional().nullable(),
  previousSchool: z.string().trim().optional().nullable(),
  secondaryAverage: z.number().min(0).max(10).optional().nullable(),
  examRoom: z.string().trim().optional().nullable(),
  schoolCycle: z.string().min(1),
  guardianFullName: z.string().min(1),
  guardianRelationship: z.string().trim().optional().nullable(),
  guardianPhone: z.string().min(1),
  guardianPhoneSecondary: z.string().trim().optional().nullable(),
  guardianEmail: z.string().email().optional().or(z.literal('')).nullable(),
})

const preRegistrationStatusUpdateSchema = z.object({
  status: z.enum(['EN_REVISION_CONTROL_ESCOLAR', 'OBSERVADO', 'RECHAZADO', 'VALIDADO_PARA_PAGO', 'PAGADO']),
  observationNotes: z.string().trim().optional(),
  motherTongue: z.string().trim().optional().nullable(),
  examRoom: z.string().trim().optional().nullable(),
  studentPhoneSecondary: z.string().trim().optional().nullable(),
  guardianPhoneSecondary: z.string().trim().optional().nullable(),
})

const admissionPaymentCreateSchema = z.object({
  folio: z.string().trim().optional(),
  curp: z.string().min(18).max(18),
  fullName: z.string().min(1),
  insurancePaid: z.boolean().default(false),
})

const admissionListFiltersSchema = z
  .object({
    status: z.string().trim().optional(),
    query: z.string().trim().optional(),
  })
  .optional()

const admissionPrintSchema = z.object({
  id: z.string().min(1).optional(),
  folio: z.string().min(1),
  curp: z.string().min(18).max(18),
  fullName: z.string().min(1),
  paidAt: z.string().min(1),
  status: z.string().min(1),
  updatedAt: z.string().min(1),
})

const sepExportSchema = z.object({
  ids: z.array(z.string().min(1)).optional(),
  status: z.string().trim().optional(),
})

const createIntakeGroupSchema = z.object({
  schoolCycle: z.string().min(1),
  semesterLevel: semesterLevelSchema.default(1),
  labels: z.array(z.string().regex(/^1[A-Z]$/)).min(1),
})

const listIntakeGroupsSchema = z.object({
  schoolCycle: z.string().min(1),
  semesterLevel: semesterLevelSchema.default(1),
})

const runAssignmentSchema = z.object({
  schoolCycle: z.string().min(1),
  semesterLevel: semesterLevelSchema.default(1),
})

const confirmAssignmentSchema = z.object({
  schoolCycle: z.string().min(1),
  semesterLevel: semesterLevelSchema.default(1),
})

const manualReassignSchema = z.object({
  studentId: z.string().min(1),
  toGroupId: z.string().min(1),
  reason: z.string().trim().min(5),
})

const updateGroupAdvisorSchema = z.object({
  groupId: z.string().min(1),
  advisorName: z.string().trim().max(120).nullable().optional(),
})

const markNoShowSchema = z.object({
  studentId: z.string().min(1),
  reason: z.string().trim().min(5),
})

const saveRequirementChecklistSchema = z.object({
  items: z.array(z.object({
    requirementId: z.string().min(1),
    isDelivered: z.boolean(),
    missingJustification: z.string().trim().optional(),
    deadlineAt: z.string().trim().optional(),
    notes: z.string().trim().optional(),
  })),
})

const groupAssignedRosterSchema = z.object({
  schoolCycle: z.string().min(1),
  semesterLevel: semesterLevelSchema.default(1),
})

const importAssignedRosterSchema = z.object({
  schoolCycle: z.string().min(1),
  sourcePath: z.string().trim().nullable().optional(),
  rows: z.array(z.object({
    sheetName: z.string().trim().min(1),
    rowNumber: z.number().int().min(1),
    groupLabel: z.string().trim().min(1),
    semesterLevel: semesterLevelSchema.nullable().optional(),
    enrollmentNumber: z.string().trim().nullable(),
    curp: z.string().trim().nullable(),
  })).min(1),
})

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function paymentReceiptHtml(admission: z.infer<typeof admissionPrintSchema>) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Recibo de pago ${escapeHtml(admission.folio)}</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#111}h1{margin:0 0 12px}p{margin:8px 0}.divider{border-top:1px solid #888;margin:16px 0}</style></head><body><h1>Recibo de pago de ficha</h1><div class='divider'></div><p><strong>Folio:</strong> ${escapeHtml(admission.folio)}</p><p><strong>CURP:</strong> ${escapeHtml(admission.curp)}</p><p><strong>Nombre:</strong> ${escapeHtml(admission.fullName)}</p><p><strong>Fecha de pago:</strong> ${escapeHtml(new Date(admission.paidAt).toLocaleString('es-MX'))}</p><p><strong>Estatus:</strong> ${escapeHtml(admission.status)}</p><div class='divider'></div><p>Presentar este recibo en Control Escolar para alta completa del alumno.</p></body></html>`
}

function admissionFichaHtml(admission: z.infer<typeof admissionPrintSchema>) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ficha ${escapeHtml(admission.folio)}</title><style>body{font-family:Arial,sans-serif;margin:18px}.row{border:1px solid #666;padding:12px;margin-bottom:12px}h2{margin:0 0 10px;font-size:20px}.cut{border-top:2px dashed #000;margin:12px 0}</style></head><body><div class='row'><h2>Ficha de admision - Alumno</h2><p><strong>Folio:</strong> ${escapeHtml(admission.folio)}</p><p><strong>CURP:</strong> ${escapeHtml(admission.curp)}</p><p><strong>Nombre:</strong> ${escapeHtml(admission.fullName)}</p><p><strong>Pago:</strong> ${escapeHtml(new Date(admission.paidAt).toLocaleString('es-MX'))}</p></div><div class='cut'></div><div class='row'><h2>Ficha de admision - Archivo</h2><p><strong>Folio:</strong> ${escapeHtml(admission.folio)}</p><p><strong>CURP:</strong> ${escapeHtml(admission.curp)}</p><p><strong>Nombre:</strong> ${escapeHtml(admission.fullName)}</p><p><strong>Estatus:</strong> ${escapeHtml(admission.status)}</p><p><strong>Actualizado:</strong> ${escapeHtml(new Date(admission.updatedAt).toLocaleString('es-MX'))}</p></div></body></html>`
}

async function printHtmlWithFallback(html: string, fileName: string) {
  const printWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      sandbox: true,
    },
  })

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

    const printed = await new Promise<boolean>((resolve) => {
      printWindow.webContents.print({ silent: false, printBackground: true }, (success) => {
        resolve(success)
      })
    })

    if (printed) {
      return { ok: true, mode: 'browser-window-print' }
    }

    const outputPath = join(app.getPath('documents'), fileName)
    const pdf = await printWindow.webContents.printToPDF({ printBackground: true })
    await writeFile(outputPath, pdf)
    return { ok: true, mode: 'print-to-pdf-fallback', outputPath }
  } finally {
    printWindow.destroy()
  }
}

function preRegistrationAuditDetail(action: string, observationNotes: string | null) {
  if (observationNotes && observationNotes.trim().length > 0) {
    return `${action}: ${observationNotes.trim()}`
  }

  return `${action}: sin observaciones`
}

function csvCell(value: string | number | null | undefined) {
  const text = `${value ?? ''}`.replace(/"/g, '""')
  return `"${text}"`
}

async function exportSepCsv(input: z.infer<typeof sepExportSchema>) {
  const whereByStatus = input.status && input.status.length > 0 ? { status: input.status } : { status: 'VALIDADO_PARA_PAGO' }
  const whereByIds = input.ids && input.ids.length > 0 ? { id: { in: input.ids } } : {}
  const rows = await prisma.preRegistration.findMany({
    where: {
      ...whereByStatus,
      ...whereByIds,
    },
    orderBy: { createdAt: 'desc' },
  })

  const headers = [
    'Nombre(s)',
    'Apellido paterno',
    'Apellido materno',
    'CURP',
    'Fecha nacimiento',
    'Sexo',
    'Domicilio',
    'Municipio',
    'Estado',
    'Codigo postal',
    'Tutor',
    'Telefono tutor',
    'Correo',
    'Escuela procedencia',
    'Promedio',
    'Ciclo',
    'Estatus',
  ]

  const lines = rows.map((item) => {
    const values = [
      item.firstName,
      item.paternalLastName,
      item.maternalLastName,
      item.curp,
      item.birthDate ? item.birthDate.toISOString().slice(0, 10) : '',
      item.sex ?? '',
      item.addressLine,
      item.municipality ?? '',
      item.state ?? '',
      item.postalCode ?? '',
      item.guardianFullName,
      item.guardianPhone,
      item.email ?? '',
      item.previousSchool ?? '',
      item.secondaryAverage != null ? Number(item.secondaryAverage).toString() : '',
      item.schoolCycle,
      item.status,
    ]

    return values.map(csvCell).join(',')
  })

  const csvContent = [headers.map(csvCell).join(','), ...lines].join('\n')
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  const outputPath = join(app.getPath('documents'), `sep-export-${stamp}.csv`)
  await writeFile(outputPath, csvContent, 'utf8')

  return { outputPath, exportedCount: rows.length }
}

function hasOwn<T extends object, K extends PropertyKey>(value: T, key: K): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function normalizeOptional(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function startOfLocalDay(value?: string | Date) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day, 0, 0, 0, 0)
  }

  const base = value ? new Date(value) : new Date()
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0)
}

function endOfLocalDay(value?: string | Date) {
  const start = startOfLocalDay(value)
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999)
}

function normalizePermissionStatus(permission: {
  status: string
  startsAt: Date
  endsAt: Date
}, now = new Date()) {
  if (permission.status === 'CANCELADO') {
    return 'CANCELADO' as const
  }

  if (now > permission.endsAt) {
    return 'CERRADO' as const
  }

  if (now >= permission.startsAt && now <= permission.endsAt) {
    return 'ACTIVO' as const
  }

  return 'PROGRAMADO' as const
}

function deriveStudentDailyStatus(student: {
  dailyStatuses?: Array<{ status: string }>
  permissions?: Array<{ status: string; startsAt: Date; endsAt: Date; reason: string }>
}, now = new Date()) {
  const activePermission = student.permissions?.find((permission) => normalizePermissionStatus(permission, now) === 'ACTIVO') ?? null
  if (activePermission) {
    return {
      dailyStatus: 'PERMISO' as const,
      dailyStatusLabel: 'Permiso',
      activePermissionSummary: activePermission.reason,
    }
  }

  const override = student.dailyStatuses?.[0] ?? null
  if (override?.status === 'AUSENTE') {
    return {
      dailyStatus: 'AUSENTE' as const,
      dailyStatusLabel: 'Ausente',
      activePermissionSummary: null,
    }
  }

  return {
    dailyStatus: 'PRESENTE' as const,
    dailyStatusLabel: 'Presente',
    activePermissionSummary: null,
  }
}

function enrollmentStatusLabel(enrollmentStatus: string | null | undefined) {
  switch (enrollmentStatus) {
    case 'FICHA_ENTREGADA':
      return 'Ficha entregada'
    case 'INSCRITO':
      return 'Inscrito'
    case 'BAJA':
      return 'Baja'
    case 'BAJA_TEMPORAL':
      return 'Baja temporal'
    case 'BAJA_DEFINITIVA':
      return 'Baja definitiva'
    case 'PORTABILIDAD':
      return 'Portabilidad'
    case 'RECURSADOR':
      return 'Recursador'
    case 'NO_SHOW':
      return 'No presentado'
    case 'ASIGNADO':
      return 'Asignado a grupo'
    case 'CONFIRMADO':
      return 'Inscrito'
    case 'EGRESADO':
      return 'Egresado'
    default:
      return 'Ficha entregada'
  }
}

function studentSummary(student: {
  id: string
  enrollmentNumber: string
  officialEnrollmentNumber: string | null
  curp: string
  rfc: string | null
  firstName: string
  paternalLastName: string
  maternalLastName: string
  phone: string | null
  studentPhoneSecondary: string | null
  email: string | null
  motherTongue: string | null
  addressLine: string
  neighborhood: string | null
  locality: string | null
  municipality: string | null
  state: string | null
  schoolCycle: string
  schoolPeriod?: number | null
  semesterLevel: number
  academicStatus: string | null
  status: string
  documentationStatus: string
  enrollmentStatus?: string | null
  admissionPayment?: {
    status: string
  } | null
  cashPayments?: Array<{
    status: string
  }>
  guardian?: {
    fullName: string
    phone: string
  } | null
  dailyStatuses?: Array<{
    status: string
  }>
  permissions?: Array<{
    status: string
    startsAt: Date
    endsAt: Date
    reason: string
  }>
  groupAssignment?: {
    groupId: string
    group: {
      label: string
      advisorName: string | null
      shift: string
    }
  } | null
}) {
  const latestCashPayment = student.cashPayments?.[0] ?? null
  const dayStatus = deriveStudentDailyStatus(student)

  return {
    id: student.id,
    enrollmentNumber: student.enrollmentNumber,
    officialEnrollmentNumber: student.officialEnrollmentNumber,
    curp: student.curp,
    rfc: student.rfc,
    phone: student.phone ?? null,
    email: student.email ?? null,
    guardianFullName: student.guardian?.fullName ?? null,
    guardianPhone: student.guardian?.phone ?? null,
    admissionPaid: Boolean(student.admissionPayment) || Boolean(latestCashPayment),
    admissionPaymentStatus: latestCashPayment?.status ?? student.admissionPayment?.status ?? null,
    schoolCycle: student.schoolCycle,
    schoolPeriod: student.schoolPeriod ?? 1,
    semesterLevel: normalizeSemesterLevel(student.semesterLevel),
    academicStatus: student.academicStatus ?? null,
    documentationStatus: student.documentationStatus,
    enrollmentStatus: student.enrollmentStatus ?? 'INSCRITO',
    firstName: student.firstName,
    paternalLastName: student.paternalLastName,
    maternalLastName: student.maternalLastName,
    fullName: `${student.firstName} ${student.paternalLastName} ${student.maternalLastName}`,
    address: [student.addressLine, student.neighborhood, student.locality, student.municipality, student.state]
      .filter(Boolean)
      .join(', '),
    statusLabel: enrollmentStatusLabel(student.enrollmentStatus),
    groupId: student.groupAssignment?.groupId ?? null,
    groupLabel: student.groupAssignment?.group.label ?? null,
    groupAdvisorName: student.groupAssignment?.group.advisorName ?? null,
    shiftLabel: student.groupAssignment?.group.shift ?? null,
    dailyStatus: dayStatus.dailyStatus,
    dailyStatusLabel: dayStatus.dailyStatusLabel,
    activePermissionSummary: dayStatus.activePermissionSummary,
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
  studentPhoneSecondary: string | null
  email: string | null
  motherTongue: string | null
  addressLine: string
  neighborhood: string | null
  locality: string | null
  municipality: string | null
  state: string | null
  postalCode: string | null
  previousSchool: string | null
  secondaryAverage: unknown
  examRoom: string | null
  schoolCycle: string
  schoolPeriod?: number | null
  semesterLevel: number
  academicStatus: string | null
  status: string
  documentationStatus: string
  enrollmentStatus?: string | null
  guardian: {
    fullName: string
    relationship: string | null
    phone: string
    secondaryPhone: string | null
    email: string | null
  } | null
  groupAssignment?: {
    group: {
      label: string
      advisorName: string | null
      shift: string
    }
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
    studentPhoneSecondary: student.studentPhoneSecondary ?? '',
    email: student.email ?? '',
    motherTongue: student.motherTongue ?? '',
    addressLine: student.addressLine,
    neighborhood: student.neighborhood ?? '',
    locality: student.locality ?? '',
    municipality: student.municipality ?? '',
    state: student.state ?? '',
    postalCode: student.postalCode ?? '',
    previousSchool: student.previousSchool ?? '',
    secondaryAverage: student.secondaryAverage == null ? null : Number(student.secondaryAverage),
    examRoom: student.examRoom ?? '',
    schoolCycle: student.schoolCycle,
    schoolPeriod: student.schoolPeriod ?? 1,
    semesterLevel: normalizeSemesterLevel(student.semesterLevel),
    academicStatus: student.academicStatus ?? '',
    guardianFullName: student.guardian?.fullName ?? '',
    guardianRelationship: student.guardian?.relationship ?? '',
    guardianPhone: student.guardian?.phone ?? '',
    guardianPhoneSecondary: student.guardian?.secondaryPhone ?? '',
    guardianEmail: student.guardian?.email ?? '',
    validateNow: ['VALIDADO', 'LISTO_PARA_COBRO', 'COBRADO'].includes(student.status),
    documentationStatus: student.documentationStatus,
    enrollmentStatus: student.enrollmentStatus ?? 'INSCRITO',
    statusLabel: enrollmentStatusLabel(student.enrollmentStatus),
    groupLabel: student.groupAssignment?.group.label ?? null,
    groupAdvisorName: student.groupAssignment?.group.advisorName ?? null,
    shiftLabel: student.groupAssignment?.group.shift ?? null,
  }
}

function academicMovementSummary(item: {
  id: string
  studentId: string
  movementType: string
  reasonCode: string
  reasonLabel: string
  notes: string | null
  previousSemesterLevel: number | null
  nextSemesterLevel: number | null
  previousGroupLabel: string | null
  nextGroupLabel: string | null
  previousEnrollmentStatus: string | null
  nextEnrollmentStatus: string | null
  createdAt: Date
  actorRole: string
  student: { enrollmentNumber: string; firstName: string; paternalLastName: string; maternalLastName: string }
  actor: { displayName: string } | null
}) {
  return {
    id: item.id,
    studentId: item.studentId,
    studentName: `${item.student.firstName} ${item.student.paternalLastName} ${item.student.maternalLastName}`.replace(/\s+/g, ' ').trim(),
    studentEnrollmentNumber: item.student.enrollmentNumber,
    movementType: item.movementType,
    reasonCode: item.reasonCode,
    reasonLabel: item.reasonLabel,
    notes: item.notes ?? null,
    previousSemesterLevel: item.previousSemesterLevel == null ? null : normalizeSemesterLevel(item.previousSemesterLevel),
    nextSemesterLevel: item.nextSemesterLevel == null ? null : normalizeSemesterLevel(item.nextSemesterLevel),
    previousGroupLabel: item.previousGroupLabel ?? null,
    nextGroupLabel: item.nextGroupLabel ?? null,
    previousEnrollmentStatus: item.previousEnrollmentStatus ?? null,
    nextEnrollmentStatus: item.nextEnrollmentStatus ?? null,
    actorName: item.actor?.displayName ?? 'Sistema',
    createdAt: item.createdAt.toISOString(),
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
  isSuggested: boolean
  excludeFromRoc: boolean
  isLifeInsurance: boolean
  tariffs: Array<{ amount: unknown; periodLabel: string }>
}) {
  return {
    code: concept.code,
    groupCode: concept.groupCode,
    name: concept.name,
    description: concept.description,
    amount: concept.tariffs[0] ? Number(concept.tariffs[0].amount) : 0,
    periodLabel: concept.tariffs[0]?.periodLabel ?? 'Sin tarifa',
    isSuggested: concept.isSuggested,
    excludeFromRoc: concept.excludeFromRoc,
    isLifeInsurance: concept.isLifeInsurance,
  }
}

function cashPaymentSummary(payment: {
  id: string
  status: string
  notes: string | null
  createdAt: Date
  student: { id: string; enrollmentNumber: string; firstName: string; paternalLastName: string; maternalLastName: string }
  lines: Array<{ total: unknown; concept: { code: string; name: string; excludeFromRoc: boolean } }>
}) {
  const rocLines = payment.lines.filter((line) => !line.concept.excludeFromRoc)
  const externalLines = payment.lines.filter((line) => line.concept.excludeFromRoc)
  return {
    id: payment.id,
    studentId: payment.student.id,
    studentName: `${payment.student.firstName} ${payment.student.paternalLastName} ${payment.student.maternalLastName}`,
    enrollmentNumber: payment.student.enrollmentNumber,
    totalAmount: payment.lines.reduce((sum, line) => sum + Number(line.total), 0),
    rocTotalAmount: rocLines.reduce((sum, line) => sum + Number(line.total), 0),
    externalTotalAmount: externalLines.reduce((sum, line) => sum + Number(line.total), 0),
    createdAt: payment.createdAt.toISOString(),
    status: payment.status,
    conceptLabels: payment.lines.map((line) => `${line.concept.code} - ${line.concept.name}`),
    externalConceptLabels: externalLines.map((line) => `${line.concept.code} - ${line.concept.name}`),
    notes: payment.notes ?? null,
  }
}

function buildNextRocNumber(baseRocNumber: string, offset: number) {
  const match = baseRocNumber.match(/^(.*?)(\d+)$/)
  if (!match) {
    if (offset === 0) {
      return baseRocNumber
    }

    return `${baseRocNumber}-${offset + 1}`
  }

  const [, prefix, digits] = match
  const next = String(Number(digits) + offset).padStart(digits.length, '0')
  return `${prefix}${next}`
}

async function getNextRocNumberSuggestion() {
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

async function getRocConfigSummary() {
  const baseSetting = await readRocInitialSetting()
  const next = await getNextRocNumberSuggestion()
  const initialRocNumber = baseSetting?.value?.trim() || 'DGETAYCM-ROC-0001'
  return {
    initialRocNumber,
    lastRocNumber: next.lastRocNumber,
    nextSuggestedRocNumber: next.lastRocNumber ? next.suggestedRocNumber : initialRocNumber,
  }
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

function admissionSummary(item: {
  id: string
  folio: string
  curp: string
  fullName: string
  insurancePaid: boolean
  paidAt: Date
  status: string
  student: { id: string } | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: item.id,
    folio: item.folio,
    curp: item.curp,
    fullName: item.fullName,
    insurancePaid: item.insurancePaid,
    paidAt: item.paidAt.toISOString(),
    status: item.status,
    studentId: item.student?.id ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}

const INTERNAL_FOLIO_PREFIX = '2610701044'

async function buildStudentInternalFolio(tx: { sequenceCounter: typeof prisma.sequenceCounter }) {
  const sequence = await tx.sequenceCounter.upsert({
    where: { scope: 'STUDENT_INTERNAL_FOLIO' },
    update: { lastValue: { increment: 1 } },
    create: { scope: 'STUDENT_INTERNAL_FOLIO', lastValue: 1 },
  })

  return `${INTERNAL_FOLIO_PREFIX}${String(sequence.lastValue).padStart(4, '0')}`
}

function checklistStatusLabel(items: Array<{ isDelivered: boolean; deadlineAt: Date | null }>) {
  if (items.length === 0) return 'PENDIENTE'
  if (items.every((item) => item.isDelivered)) return 'COMPLETA'
  if (items.some((item) => item.deadlineAt && item.deadlineAt.getTime() < Date.now() && !item.isDelivered)) return 'VENCIDA'
  return 'PENDIENTE'
}

function requirementChecklistSummary(student: { id: string; firstName: string; paternalLastName: string; maternalLastName: string; documentationStatus: string; requirementStatuses: Array<{ isDelivered: boolean; missingJustification: string | null; deadlineAt: Date | null; notes: string | null; requirement: { id: string; code: string; label: string; requiredOriginals: number; requiredCopies: number; sortOrder: number } }> }) {
  return {
    studentId: student.id,
    studentName: `${student.firstName} ${student.paternalLastName} ${student.maternalLastName}`.trim(),
    documentationStatus: student.documentationStatus,
    items: student.requirementStatuses
      .sort((left, right) => left.requirement.sortOrder - right.requirement.sortOrder)
      .map((item) => ({
        requirementId: item.requirement.id,
        code: item.requirement.code,
        label: item.requirement.label,
        requiredOriginals: item.requirement.requiredOriginals,
        requiredCopies: item.requirement.requiredCopies,
        isDelivered: item.isDelivered,
        missingJustification: item.missingJustification ?? '',
        deadlineAt: item.deadlineAt ? item.deadlineAt.toISOString().slice(0, 10) : '',
        notes: item.notes ?? '',
      })),
  }
}

function assignedRosterRow(entry: { status: string; student: { enrollmentNumber: string; firstName: string; paternalLastName: string; maternalLastName: string; curp: string; sex: string | null; secondaryAverage: unknown }; group: { label: string } }) {
  const average = entry.student.secondaryAverage == null ? null : Number(entry.student.secondaryAverage)
  return {
    groupLabel: entry.group.label,
    enrollmentNumber: entry.student.enrollmentNumber,
    fullName: `${entry.student.firstName} ${entry.student.paternalLastName} ${entry.student.maternalLastName}`.trim(),
    curp: entry.student.curp,
    sex: entry.student.sex ?? 'N/E',
    averageBand: avgBand(average),
    secondaryAverage: average,
    status: entry.status,
  }
}

function buildPreRegistrationFolio() {
  const now = new Date()
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const token = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `PR-${ymd}-${token}`
}

async function buildAdmissionFolio() {
  const year = new Date().getFullYear()
  const prefix = `FIC-${year}-`
  const latest = await prisma.admissionPayment.findFirst({
    where: { folio: { startsWith: prefix } },
    orderBy: { createdAt: 'desc' },
  })

  const rawSequence = latest?.folio?.replace(prefix, '') ?? '0'
  const parsedSequence = Number(rawSequence)
  const nextSequence = Number.isFinite(parsedSequence) ? parsedSequence + 1 : 1
  return `${prefix}${String(nextSequence).padStart(5, '0')}`
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
      student: {
        include: {
          groupAssignment: {
            include: {
              group: true
            }
          }
        }
      },
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

  if (receipt.status === 'ANULADO') {
    throw new Error(`El ROC ${receipt.rocNumber} esta anulado y no se puede reimprimir. Si fue un error, genera uno nuevo desde pendientes.`)
  }

  const outputPath = await openOfficialRocTemplate(receiptToTemplatePayload(receipt))

  return { receipt, outputPath }
}

type ReceiptForTemplate = Prisma.RocReceiptGetPayload<{
  include: {
    student: {
      include: {
        groupAssignment: {
          include: {
            group: true
          }
        }
      }
    }
    lines: {
      include: {
        concept: true
      }
    }
  }
}>

function formatRocPrintDate(value: Date) {
  return value.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  })
}

function rocGradeLabel(semesterLevel: number) {
  return String(normalizeSemesterLevel(semesterLevel))
}

function rocGroupLabel(groupLabel: string | null | undefined) {
  return (groupLabel ?? '').trim().replace(/^\d+\s*/u, '')
}

function buildRocStudentPayloadFields(student: ReceiptForTemplate['student']) {
  return {
    fullName: `${student.paternalLastName} ${student.maternalLastName} ${student.firstName}`.replace(/\s+/g, ' ').trim(),
    identifier: student.rfc || student.enrollmentNumber,
    address: [student.addressLine, student.neighborhood, student.locality, student.municipality, student.state]
      .filter(Boolean)
      .join(', '),
    grade: rocGradeLabel(student.semesterLevel),
    group: rocGroupLabel(student.groupAssignment?.group?.label),
    shift: student.groupAssignment?.group?.shift ?? 'MATUTINO',
  }
}

async function ensureStudentRequirementStatuses(tx: Pick<typeof prisma, 'enrollmentRequirement' | 'studentRequirementStatus'>, studentId: string) {
  const requirements = await tx.enrollmentRequirement.findMany({ where: { isActive: true }, select: { id: true } })
  for (const requirement of requirements) {
    await tx.studentRequirementStatus.upsert({
      where: { studentId_requirementId: { studentId, requirementId: requirement.id } },
      update: {},
      create: { studentId, requirementId: requirement.id },
    })
  }
}

function missingRequiredRequirementLabels(statuses: Array<{ isDelivered: boolean; missingJustification: string | null; deadlineAt: Date | null; requirement: { label: string; requiredOriginals: number; requiredCopies: number } }>) {
  return statuses
    .filter((item) => {
      const required = item.requirement.requiredOriginals > 0 || item.requirement.requiredCopies > 0
      return required && !item.isDelivered && (!item.missingJustification?.trim() || !item.deadlineAt)
    })
    .map((item) => item.requirement.label)
}

function summaryStudentInclude(referenceDate?: string | Date) {
  const dayStart = startOfLocalDay(referenceDate)
  const dayEnd = endOfLocalDay(referenceDate)

  return {
    groupAssignment: { include: { group: true } },
    guardian: true,
    admissionPayment: { select: { status: true } },
    cashPayments: { select: { status: true }, orderBy: { createdAt: 'desc' as const }, take: 1 },
    dailyStatuses: {
      where: { date: dayStart },
      select: { status: true },
      take: 1,
    },
    permissions: {
      where: {
        status: { in: ['PROGRAMADO', 'ACTIVO'] as string[] },
        startsAt: { lte: dayEnd },
        endsAt: { gte: dayStart },
      },
      select: { status: true, startsAt: true, endsAt: true, reason: true },
      orderBy: { startsAt: 'asc' as const },
      take: 1,
    },
  }
}

async function loadStudentSummaryById(studentId: string, referenceDate?: string | Date) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: summaryStudentInclude(referenceDate),
  })

  if (!student) {
    throw new Error('No se encontro el alumno solicitado.')
  }

  return studentSummary(student)
}

function receiptToTemplatePayload(receipt: ReceiptForTemplate): RocTemplatePayload {
  const studentFields = buildRocStudentPayloadFields(receipt.student)

  return {
    rocNumber: receipt.rocNumber,
    ...studentFields,
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

async function restorePaymentAfterReceiptCancellation(tx: Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>, receipt: ReceiptForTemplate) {
  const receiptConceptKey = sortableConceptKey(
    receipt.lines.map((line) => `${line.concept.code} - ${line.concept.name}`),
  )
  const receiptTotal = Number(receipt.totalAmount)

  const candidatePayments = await tx.cashPayment.findMany({
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
    if (paymentTotal !== receiptTotal) {
      return false
    }

    const paymentConceptKey = sortableConceptKey(
      printableLines.map((line) => `${line.concept.code} - ${line.concept.name}`),
    )

    return paymentConceptKey === receiptConceptKey
  })

  if (matchingPayments.length !== 1) {
    return { restoredPaymentId: null as string | null, studentStatus: null as string | null }
  }

  const targetPayment = matchingPayments[0]

  await tx.cashPayment.update({
    where: { id: targetPayment.id },
    data: {
      status: 'PENDIENTE_ROC',
      batchGeneratedAt: null,
    },
  })

  await tx.student.update({
    where: { id: receipt.studentId },
    data: { status: 'LISTO_PARA_COBRO' },
  })

  return { restoredPaymentId: targetPayment.id, studentStatus: 'LISTO_PARA_COBRO' }
}

function buildMonthBounds(year: number, month: number) {
  const from = new Date(year, month - 1, 1, 0, 0, 0, 0)
  const to = new Date(year, month, 1, 0, 0, 0, 0)
  return { from, to }
}

function formatPeriodLabel(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

const ASSIGNMENT_GROUP_COUNT = 10
const ASSIGNMENT_MAX_CAPACITY = 40
const MATUTINO_SHIFT = 'MATUTINO'
const movementReasonLabels = {
  CAMBIO_GRUPO: {
    AJUSTE_CUPO: 'Ajuste de cupo',
    SOLICITUD_ALUMNO: 'Solicitud del alumno',
    AJUSTE_ACADEMICO: 'Ajuste academico',
    AJUSTE_ADMINISTRATIVO: 'Ajuste administrativo',
  },
  BAJA: {
    CAMBIO_PLANTEL: 'Cambio de plantel',
    MOTIVOS_PERSONALES: 'Motivos personales',
    BAJA_ACADEMICA: 'Baja academica',
    BAJA_ADMINISTRATIVA: 'Baja administrativa',
  },
  ALTA_GRADO: {
    REGULARIZACION: 'Regularizacion',
    PROMOCION: 'Promocion',
    REASIGNACION_ESCOLAR: 'Reasignacion escolar',
  },
} as const

function avgBand(value: number | null) {
  if (value == null) return 'medio'
  if (value >= 9) return 'alto'
  if (value < 7) return 'bajo'
  return 'medio'
}

function sexBucket(value: string | null) {
  const normalized = value?.trim().toUpperCase()
  if (!normalized) return 'NO_ESPECIFICADO'
  if (normalized.startsWith('M') || normalized.startsWith('F')) return 'MUJER'
  if (normalized.startsWith('H')) return 'HOMBRE'
  return 'NO_ESPECIFICADO'
}

type AssignmentSex = 'MUJER' | 'HOMBRE' | 'NO_ESPECIFICADO'
type AssignmentBand = 'alto' | 'medio' | 'bajo'

type ImportedGroupRow = {
  sheetName: string
  rowNumber: number
  groupLabel: string
  semesterLevel?: 1 | 2 | 3 | 4 | 5 | 6 | null
  enrollmentNumber: string | null
  curp: string | null
}

const GROUP_COLUMN_ALIASES = ['grupo', 'group', 'grupo asignado', 'grupo destino', 'group label']
const ENROLLMENT_COLUMN_ALIASES = ['folio interno', 'matricula', 'matricula interna', 'enrollment number', 'enrollmentnumber', 'numero de control']
const CURP_COLUMN_ALIASES = ['curp']

function normalizeSheetCell(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeSheetUpper(value: unknown) {
  return normalizeSheetCell(value).toUpperCase()
}

function normalizeSheetHeader(value: unknown) {
  return normalizeSheetCell(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function pickSheetValue(row: Record<string, unknown>, aliases: string[]) {
  for (const [rawKey, rawValue] of Object.entries(row)) {
    const normalizedKey = normalizeSheetHeader(rawKey)
    if (aliases.includes(normalizedKey)) {
      return rawValue
    }
  }

  return ''
}

function parseImportedRosterWorkbook(workbookPath: string) {
  const workbook = XLSX.readFile(workbookPath)
  const rows: ImportedGroupRow[] = []
  const issues: string[] = []
  let skippedCount = 0

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    for (const [index, row] of sheetRows.entries()) {
      const rowNumber = index + 2
      const groupCandidate = normalizeSheetUpper(pickSheetValue(row, GROUP_COLUMN_ALIASES)) || normalizeSheetUpper(sheetName)
      const enrollmentNumber = normalizeSheetCell(pickSheetValue(row, ENROLLMENT_COLUMN_ALIASES)) || null
      const curp = normalizeSheetUpper(pickSheetValue(row, CURP_COLUMN_ALIASES)) || null

      if (!groupCandidate && !enrollmentNumber && !curp) {
        continue
      }

      if (!groupCandidate) {
        skippedCount += 1
        issues.push(`Fila ${rowNumber} en ${sheetName}: falta la columna o valor de Grupo.`)
        continue
      }

      if (!enrollmentNumber && !curp) {
        skippedCount += 1
        issues.push(`Fila ${rowNumber} en ${sheetName}: agrega CURP o Folio interno para localizar al alumno.`)
        continue
      }

      rows.push({
        sheetName,
        rowNumber,
        groupLabel: groupCandidate,
        enrollmentNumber,
        curp,
      })
    }
  }

  return {
    rows,
    skippedCount,
    issues,
  }
}

function normalizeImportedGroupLabel(value: string) {
  const normalized = value.trim().toUpperCase()
  if (/^[A-Z]$/.test(normalized)) return `1${normalized}`
  return normalized
}

function normalizeSemesterLevel(value: number | null | undefined): 1 | 2 | 3 | 4 | 5 | 6 {
  if (value === 2 || value === 3 || value === 4 || value === 5 || value === 6) return value
  return 1
}

function inferSemesterLevelFromGroupLabel(groupLabel: string | null | undefined): 1 | 2 | 3 | 4 | 5 | 6 {
  const match = groupLabel?.trim().match(/^(\d+)/)
  if (!match) return 1
  return normalizeSemesterLevel(Number(match[1]))
}

function splitImportedFullName(fullName: string) {
  const parts = fullName.trim().replace(/\s+/g, ' ').split(' ')
  if (parts.length <= 1) {
    return { firstName: fullName.trim(), paternalLastName: 'SIN APELLIDO', maternalLastName: 'SIN APELLIDO' }
  }

  if (parts.length === 2) {
    return { firstName: parts[1], paternalLastName: parts[0], maternalLastName: 'SIN APELLIDO' }
  }

  return {
    paternalLastName: parts[0],
    maternalLastName: parts[1],
    firstName: parts.slice(2).join(' '),
  }
}

function normalizeImportedSex(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase()
  if (normalized === 'M') return 'MUJER'
  if (normalized === 'H') return 'HOMBRE'
  return normalized || null
}

function movementReasonLabel(type: keyof typeof movementReasonLabels, code: string) {
  return movementReasonLabels[type][code as keyof (typeof movementReasonLabels)[typeof type]] ?? code
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

function buildGroupLabel(index: number) {
  return `1${String.fromCharCode(65 + index)}`
}

function buildAssignmentStats(groups: Array<{ id: string; label: string; advisorName: string | null; capacity: number; assignments: Array<{ status: string; student: { sex: string | null; secondaryAverage: unknown } }> }>) {
  return groups.map((group) => {
    const assigned = group.assignments.filter((item) => item.status !== 'NO_SHOW')
    const totals = {
      alto: 0,
      medio: 0,
      bajo: 0,
      MUJER: 0,
      HOMBRE: 0,
      NO_ESPECIFICADO: 0,
    }
    for (const item of assigned) {
      const avg = item.student.secondaryAverage == null ? null : Number(item.student.secondaryAverage)
      totals[avgBand(avg)] += 1
      totals[sexBucket(item.student.sex)] += 1
    }

    return {
      groupId: group.id,
      label: group.label,
      advisorName: group.advisorName,
      capacity: group.capacity,
      assignedCount: assigned.length,
      available: group.capacity - assigned.length,
      bands: { alto: totals.alto, medio: totals.medio, bajo: totals.bajo },
      sex: { mujer: totals.MUJER, hombre: totals.HOMBRE, noEspecificado: totals.NO_ESPECIFICADO },
    }
  })
}

function selectBalancedTargetGroup<T extends { id: string; label: string; capacity: number }>(
  groups: T[],
  stats: Map<string, { assigned: number; MUJER: number; HOMBRE: number; NO_ESPECIFICADO: number; alto: number; medio: number; bajo: number }>,
  sex: 'MUJER' | 'HOMBRE' | 'NO_ESPECIFICADO',
  band: 'alto' | 'medio' | 'bajo',
  totals: { MUJER: number; HOMBRE: number; NO_ESPECIFICADO: number; alto: number; medio: number; bajo: number; total: number },
) {
  const desiredSexRatio = totals.total > 0 ? totals[sex] / totals.total : 0
  const desiredBandRatio = totals.total > 0 ? totals[band] / totals.total : 0
  const groupCount = Math.max(1, groups.length)
  const desiredSexPerGroup = totals[sex] / groupCount
  const desiredBandPerGroup = totals[band] / groupCount

  const candidates = groups.filter((group) => (stats.get(group.id)?.assigned ?? 0) < group.capacity)
  if (candidates.length === 0) return null

  candidates.sort((left, right) => {
    const leftStats = stats.get(left.id)
    const rightStats = stats.get(right.id)
    if (!leftStats || !rightStats) return left.label.localeCompare(right.label)

    const leftProjectedAssigned = leftStats.assigned + 1
    const rightProjectedAssigned = rightStats.assigned + 1

    if (leftStats.assigned !== rightStats.assigned) return leftStats.assigned - rightStats.assigned

    const leftSexGap = Math.abs(leftStats[sex] + 1 - desiredSexPerGroup)
    const rightSexGap = Math.abs(rightStats[sex] + 1 - desiredSexPerGroup)
    if (leftSexGap !== rightSexGap) return leftSexGap - rightSexGap

    const leftBandGap = leftStats[band] - desiredBandPerGroup
    const rightBandGap = rightStats[band] - desiredBandPerGroup
    if (leftBandGap !== rightBandGap) return leftBandGap - rightBandGap

    const leftSexRatio = (leftStats[sex] + 1) / leftProjectedAssigned
    const rightSexRatio = (rightStats[sex] + 1) / rightProjectedAssigned
    const leftSexPenalty = Math.abs(leftSexRatio - desiredSexRatio)
    const rightSexPenalty = Math.abs(rightSexRatio - desiredSexRatio)

    if (leftSexPenalty !== rightSexPenalty) return leftSexPenalty - rightSexPenalty

    const leftBandRatio = (leftStats[band] + 1) / leftProjectedAssigned
    const rightBandRatio = (rightStats[band] + 1) / rightProjectedAssigned
    const leftBandPenalty = Math.abs(leftBandRatio - desiredBandRatio)
    const rightBandPenalty = Math.abs(rightBandRatio - desiredBandRatio)

    if (leftBandPenalty !== rightBandPenalty) return leftBandPenalty - rightBandPenalty
    return left.label.localeCompare(right.label)
  })

  return candidates[0]
}

function buildPerGroupTargets(total: number, groupCount: number) {
  const base = Math.floor(total / groupCount)
  const remainder = total % groupCount
  return Array.from({ length: groupCount }, (_item, index) => base + (index < remainder ? 1 : 0))
}

function buildProportionalTargets(capacities: number[], totalCount: number) {
  const totalCapacity = capacities.reduce((sum, value) => sum + value, 0)
  if (totalCapacity === 0) {
    return capacities.map(() => 0)
  }

  const bases = capacities.map((capacity) => Math.min(capacity, Math.floor((totalCount * capacity) / totalCapacity)))
  let remainder = totalCount - bases.reduce((sum, value) => sum + value, 0)

  const rankedFractions = capacities
    .map((capacity, index) => ({
      index,
      fraction: (totalCount * capacity) / totalCapacity - bases[index],
    }))
    .filter((item) => bases[item.index] < capacities[item.index])
    .sort((left, right) => {
      if (left.fraction !== right.fraction) return right.fraction - left.fraction
      return left.index - right.index
    })

  for (const item of rankedFractions) {
    if (remainder <= 0) break
    bases[item.index] += 1
    remainder -= 1
  }

  return bases
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
    const leftStats = stats.get(left.id)
    const rightStats = stats.get(right.id)
    const leftTarget = sexTargets.get(left.id)
    const rightTarget = sexTargets.get(right.id)
    if (!leftStats || !rightStats || !leftTarget || !rightTarget) return left.label.localeCompare(right.label)

    const leftRemainingSex = leftTarget[sex] - leftStats[sex]
    const rightRemainingSex = rightTarget[sex] - rightStats[sex]
    if (leftRemainingSex !== rightRemainingSex) return rightRemainingSex - leftRemainingSex

    if (leftStats.assigned !== rightStats.assigned) return leftStats.assigned - rightStats.assigned

    const leftBandGap = Math.abs((leftStats[band] + 1) - desiredBandPerGroup[band])
    const rightBandGap = Math.abs((rightStats[band] + 1) - desiredBandPerGroup[band])
    if (leftBandGap !== rightBandGap) return leftBandGap - rightBandGap

    return left.label.localeCompare(right.label)
  })

  return pool[0]
}

function buildFixedAssignmentPlan<TStudent extends { sex: string | null; secondaryAverage: unknown }, TGroup extends { id: string; label: string; capacity: number }>(
  students: TStudent[],
  groups: TGroup[],
) {
  const normalizedStudents: Array<{ student: TStudent; band: AssignmentBand; sex: AssignmentSex }> = students.map((student) => {
    const band = avgBand(student.secondaryAverage == null ? null : Number(student.secondaryAverage))
    const sex = sexBucket(student.sex)
    return { student, band, sex }
  })

  const totals = {
    MUJER: normalizedStudents.filter((item) => item.sex === 'MUJER').length,
    HOMBRE: normalizedStudents.filter((item) => item.sex === 'HOMBRE').length,
    NO_ESPECIFICADO: normalizedStudents.filter((item) => item.sex === 'NO_ESPECIFICADO').length,
    alto: normalizedStudents.filter((item) => item.band === 'alto').length,
    medio: normalizedStudents.filter((item) => item.band === 'medio').length,
    bajo: normalizedStudents.filter((item) => item.band === 'bajo').length,
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
      groups.filter((group) => (stats.get(group.id)?.assigned ?? 0) < (sexTargets.get(group.id)?.MUJER ?? 0) + (sexTargets.get(group.id)?.HOMBRE ?? 0) + (sexTargets.get(group.id)?.NO_ESPECIFICADO ?? 0)),
      stats,
      sexTargets,
      item.sex,
      item.band,
      desiredBandPerGroup,
    )
    if (!target) {
      continue
    }

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

function batchRocHtml(entries: Array<{ receipt: { rocNumber: string; totalAmount: unknown; lines: Array<{ concept: { code: string; name: string }; unitAmount: unknown }> }; student: { firstName: string; paternalLastName: string; maternalLastName: string; enrollmentNumber: string; addressLine: string; neighborhood: string | null; locality: string | null; municipality: string | null; state: string | null } }>) {
  const cards = entries
    .map((entry) => {
      const total = Number(entry.receipt.totalAmount)
      const concepts = entry.receipt.lines
        .map((line) => `${line.concept.code} ${line.concept.name} $${Number(line.unitAmount).toFixed(2)}`)
        .join('<br/>')
      const fullName = `${entry.student.paternalLastName} ${entry.student.maternalLastName} ${entry.student.firstName}`
      const address = [entry.student.addressLine, entry.student.neighborhood, entry.student.locality, entry.student.municipality, entry.student.state]
        .filter(Boolean)
        .join(', ')
      return `<article class="roc-card"><h3>ROC ${escapeHtml(entry.receipt.rocNumber)}</h3><p><strong>Alumno:</strong> ${escapeHtml(fullName)}</p><p><strong>Folio interno:</strong> ${escapeHtml(entry.student.enrollmentNumber)}</p><p><strong>Grupo:</strong> MATUTINO</p><p><strong>Domicilio:</strong> ${escapeHtml(address)}</p><p><strong>Conceptos:</strong><br/>${concepts}</p><p><strong>Total:</strong> $${total.toFixed(2)}</p></article>`
    })
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>ROC lote</title><style>@page{size:letter;margin:10mm}body{font-family:Arial,sans-serif;color:#111}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8mm}.roc-card{border:1px solid #555;padding:10px;break-inside:avoid;min-height:120mm}h3{margin:0 0 6px}</style></head><body><div class="grid">${cards}</div></body></html>`
}

function buildBatchRocWorkbook(entries: Array<{ receipt: { rocNumber: string; totalAmount: unknown; lines: Array<{ concept: { code: string; name: string }; unitAmount: unknown }> }; student: { firstName: string; paternalLastName: string; maternalLastName: string; enrollmentNumber: string } }>) {
  const rows: string[][] = []

  for (let i = 0; i < entries.length; i += 2) {
    const left = entries[i]
    const right = entries[i + 1]

    const formatCard = (entry: { receipt: { rocNumber: string; totalAmount: unknown; lines: Array<{ concept: { code: string; name: string }; unitAmount: unknown }> }; student: { firstName: string; paternalLastName: string; maternalLastName: string; enrollmentNumber: string } } | undefined) => {
      if (!entry) return ['', '', '', '']
      const fullName = `${entry.student.paternalLastName} ${entry.student.maternalLastName} ${entry.student.firstName}`
      const concepts = entry.receipt.lines.map((line) => `${line.concept.code} ${line.concept.name}`).join(' | ')
      return [
        `ROC ${entry.receipt.rocNumber}`,
        `Alumno: ${fullName}`,
        `Folio interno: ${entry.student.enrollmentNumber}`,
        `Total: $${Number(entry.receipt.totalAmount).toFixed(2)} | ${concepts}`,
      ]
    }

    const leftCard = formatCard(left)
    const rightCard = formatCard(right)
    rows.push([leftCard[0], '', rightCard[0]])
    rows.push([leftCard[1], '', rightCard[1]])
    rows.push([leftCard[2], '', rightCard[2]])
    rows.push([leftCard[3], '', rightCard[3]])
    rows.push(['', '', ''])
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  worksheet['!cols'] = [{ wch: 48 }, { wch: 4 }, { wch: 48 }]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'ROC_Lote_2xHoja')
  return workbook
}

function buildAssignedRosterWorkbook(rows: Array<{ groupLabel: string; enrollmentNumber: string; fullName: string; curp: string; sex: string; secondaryAverage: number | null; averageBand: string; status: string }>) {
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

function assignedRosterHtml(rows: Array<{ groupLabel: string; enrollmentNumber: string; fullName: string; curp: string; sex: string; secondaryAverage: number | null; averageBand: string; status: string }>) {
  const groups = Array.from(new Set(rows.map((row) => row.groupLabel))).sort((a, b) => a.localeCompare(b))
  const sections = groups.map((group) => {
    const items = rows.filter((row) => row.groupLabel === group)
      .map((row) => `<tr><td>${escapeHtml(row.enrollmentNumber)}</td><td>${escapeHtml(row.fullName)}</td><td>${escapeHtml(row.curp)}</td><td>${escapeHtml(row.sex)}</td><td>${escapeHtml(row.secondaryAverage == null ? 'N/E' : row.secondaryAverage.toFixed(1))}</td><td>${escapeHtml(row.averageBand.toUpperCase())}</td><td>${escapeHtml(row.status)}</td></tr>`)
      .join('')
    return `<section class="group-roster"><h2>Grupo ${escapeHtml(group)}</h2><table><thead><tr><th>Folio interno</th><th>Alumno</th><th>CURP</th><th>Sexo</th><th>Promedio</th><th>Banda</th><th>Estatus</th></tr></thead><tbody>${items}</tbody></table></section>`
  }).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>Listado de grupos</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#111}h1{margin:0 0 18px}h2{margin:22px 0 10px}table{width:100%;border-collapse:collapse;margin-bottom:12px}th,td{border:1px solid #c9d6c9;padding:8px;text-align:left;font-size:12px}th{background:#eef5ee}</style></head><body><h1>Listado de grupos asignados</h1>${sections}</body></html>`
}

function safeWorkbookFileName(fileName: string) {
  const normalized = fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim()
  const withExtension = normalized.toLowerCase().endsWith('.xlsx') ? normalized : `${normalized}.xlsx`
  return withExtension || `roc-remoto-${Date.now()}.xlsx`
}

function buildWorkbookVariantPath(outputPath: string) {
  const extension = extname(outputPath) || '.xlsx'
  const baseName = basename(outputPath, extension)
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return join(getGeneratedRocsDir(), `${baseName}-${timestamp}${extension}`)
}

function isBusyFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'EBUSY'
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function writeWorkbookWithLockFallback(outputPath: string, content: Buffer) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeFile(outputPath, content)
      return outputPath
    } catch (error) {
      if (!isBusyFileError(error)) {
        throw error
      }

      if (attempt < 2) {
        await delay(250)
        continue
      }
    }
  }

  const variantPath = buildWorkbookVariantPath(outputPath)
  await writeFile(variantPath, content)
  return variantPath
}

export function registerIpcHandlers() {
  ipcMain.handle('files:saveAndOpenWorkbook', async (_event, payload) => {
    const input = saveWorkbookSchema.parse(payload)
    const fileName = safeWorkbookFileName(input.fileName)
    const outputPath = join(getGeneratedRocsDir(), fileName)
    const savedPath = await writeWorkbookWithLockFallback(outputPath, Buffer.from(input.base64, 'base64'))
    const openResult = await shell.openPath(savedPath)
    if (openResult) {
      throw new Error(openResult)
    }
    return { outputPath: savedPath }
  })

  ipcMain.handle('auth:login', async (_event, payload) => {
    const input = authLoginSchema.parse(payload)
    const username = input.username.toLowerCase()
    const user = await prisma.user.findUnique({ where: { username } })

    if (!user || !user.isActive || !verifyPassword(input.password, user.passwordHash)) {
      throw new Error('Credenciales invalidas.')
    }

    if (!['CONTROL_ESCOLAR', 'INGRESOS_PROPIOS', 'SECRETARIA', 'ADMIN'].includes(user.role)) {
      throw new Error('El usuario tiene un rol no soportado por la aplicacion.')
    }

    currentSession = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role as AppRole,
    }

    return authSessionSummary()
  })

  ipcMain.handle('auth:logout', async () => {
    currentSession = null
    return { ok: true }
  })

  ipcMain.handle('auth:session', async () => authSessionSummary())

  ipcMain.handle('admin:departments:list', async () => {
    requireRole(['ADMIN'], 'consultar departamentos')
    const departments = await prisma.department.findMany({ orderBy: { name: 'asc' } })
    return departments.map(departmentSummary)
  })

  ipcMain.handle('admin:users:list', async () => {
    requireRole(['ADMIN'], 'consultar usuarios')
    const users = await prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { username: 'asc' }],
      include: { department: true },
    })
    return users.map(userSummary)
  })

  ipcMain.handle('admin:users:create', async (_event, payload) => {
    const actor = requireRole(['ADMIN'], 'crear usuarios')
    const input = adminUserCreateSchema.parse(payload)
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
            action: 'CREATE_USER',
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
  })

  ipcMain.handle('admin:users:update', async (_event, userId, payload) => {
    const actor = requireRole(['ADMIN'], 'editar usuarios')
    const id = z.string().min(1).parse(userId)
    const input = adminUserUpdateSchema.parse(payload)
    const department = await assertActiveDepartment(input.departmentId ?? null)
    await assertCanChangeAdminStatus(id, input.role, input.isActive)

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
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
          action: 'UPDATE_USER',
          afterJson: JSON.stringify({ summary: `${user.username} - ${user.displayName}`, role: user.role, isActive: user.isActive }),
        },
      })

      return user
    })

    if (currentSession?.id === updated.id && (!updated.isActive || updated.role !== 'ADMIN')) {
      currentSession = null
    }

    return userSummary(updated)
  })

  ipcMain.handle('admin:users:resetPassword', async (_event, userId, payload) => {
    const actor = requireRole(['ADMIN'], 'restablecer contrasenas')
    const id = z.string().min(1).parse(userId)
    const input = adminUserResetPasswordSchema.parse(payload)

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { passwordHash: buildPasswordHash(input.password) },
        include: { department: true },
      })

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          entityType: 'USER',
          entityId: user.id,
          action: 'RESET_USER_PASSWORD',
          afterJson: JSON.stringify({ summary: `${user.username} - ${user.displayName}` }),
        },
      })

      return user
    })

    return userSummary(updated)
  })

  ipcMain.handle('admissions:list', async (_event, rawFilters) => {
    requireAuth()
    const filters = admissionListFiltersSchema.parse(rawFilters)
    const status = filters?.status?.trim()
    const query = filters?.query?.trim()

    const items = await prisma.admissionPayment.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(query
          ? {
              OR: [
                { folio: { contains: query } },
                { curp: { contains: query.toUpperCase() } },
                { fullName: { contains: query } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { student: { select: { id: true } } },
    })

    return items.map(admissionSummary)
  })

  ipcMain.handle('admissions:createPayment', async (_event, payload) => {
    requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'registrar pagos de admision')
    const input = admissionPaymentCreateSchema.parse(payload)
    try {
      const folio = input.folio && input.folio.length > 0 ? input.folio.trim().toUpperCase() : await buildAdmissionFolio()
      const item = await prisma.admissionPayment.create({
        data: {
          folio,
          curp: input.curp.trim().toUpperCase(),
          fullName: input.fullName.trim(),
          insurancePaid: input.insurancePaid,
          status: 'PAGADO_PENDIENTE_CAPTURA',
        },
        include: { student: { select: { id: true } } },
      })

      return admissionSummary(item)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new Error('El folio de pago ya existe. Usa el siguiente folio consecutivo.')
      }

      throw error
    }
  })

  ipcMain.handle('admissions:startCapture', async (_event, admissionId) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'iniciar captura de alumnos')
    const id = z.string().min(1).parse(admissionId)
    const existing = await prisma.admissionPayment.findUnique({ where: { id } })
    if (!existing) {
      throw new Error('No se encontro el pago de ficha.')
    }

    const item = await prisma.admissionPayment.update({
      where: { id },
      data: {
        status: existing.status === 'PAGADO_PENDIENTE_CAPTURA' ? 'EN_CAPTURA_CONTROL_ESCOLAR' : existing.status,
      },
      include: { student: { select: { id: true } } },
    })

    return admissionSummary(item)
  })

  ipcMain.handle('admissions:completeCapture', async (_event, admissionId, studentId) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'completar captura de alumnos')
    const id = z.string().min(1).parse(admissionId)
    const linkedStudentId = z.string().min(1).parse(studentId)

    const item = await prisma.$transaction(async (tx) => {
      await tx.student.update({
        where: { id: linkedStudentId },
        data: { admissionPaymentId: id },
      })

      return tx.admissionPayment.update({
        where: { id },
        data: { status: 'CAPTURADO_CONTROL_ESCOLAR' },
        include: { student: { select: { id: true } } },
      })
    })

    return admissionSummary(item)
  })

  ipcMain.handle('admissions:markPrinted', async (_event, admissionId) => {
    requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'marcar ficha como impresa')
    const id = z.string().min(1).parse(admissionId)

    const existing = await prisma.admissionPayment.findUnique({ where: { id } })
    if (!existing) {
      throw new Error('No se encontro el pago de ficha.')
    }
    if (existing.status !== 'CAPTURADO_CONTROL_ESCOLAR' && existing.status !== 'FICHA_IMPRESA') {
      throw new Error('Solo se puede imprimir ficha cuando la captura ya fue completada.')
    }

    const item = await prisma.admissionPayment.update({
      where: { id },
      data: { status: 'FICHA_IMPRESA' },
      include: { student: { select: { id: true } } },
    })

    return admissionSummary(item)
  })

  ipcMain.handle('admissions:printPaymentReceipt', async (_event, payload) => {
    requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'imprimir recibo de pago')
    const input = admissionPrintSchema.parse(payload)
    return printHtmlWithFallback(paymentReceiptHtml(input), `recibo-pago-${input.folio}.pdf`)
  })

  ipcMain.handle('admissions:printFicha', async (_event, payload) => {
    requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'imprimir ficha de admision')
    const input = admissionPrintSchema.parse(payload)
    return printHtmlWithFallback(admissionFichaHtml(input), `ficha-admision-${input.folio}.pdf`)
  })

  ipcMain.handle('admissions:findByFolioOrCurp', async (_event, rawQuery) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'buscar pagos para captura')
    const query = z.string().trim().min(1).parse(rawQuery)

    const item = await prisma.admissionPayment.findFirst({
      where: {
        OR: [{ folio: query.toUpperCase() }, { curp: query.toUpperCase() }],
      },
      orderBy: { createdAt: 'desc' },
      include: { student: { select: { id: true } } },
    })

    return item ? admissionSummary(item) : null
  })

  ipcMain.handle('preRegistrations:list', async () => {
    requireAuth()
    const items = await prisma.preRegistration.findMany({
      orderBy: { createdAt: 'desc' },
    })

    return items.map(preRegistrationSummary)
  })

  ipcMain.handle('preRegistrations:create', async (_event, payload) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'crear pre-registros')
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
          guardianFullName: input.guardianFullName.trim(),
          guardianRelationship: normalizeOptional(input.guardianRelationship),
          guardianPhone: input.guardianPhone.trim(),
          guardianPhoneSecondary: normalizeOptional(input.guardianPhoneSecondary),
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
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'actualizar estatus de pre-registro')
    const id = z.string().min(1).parse(preRegistrationId)
    const input = preRegistrationStatusUpdateSchema.parse(payload)

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.preRegistration.findUnique({ where: { id } })
      if (!existing) {
        throw new Error('No se encontro el pre-registro solicitado.')
      }

      const preRegistrationData: {
        status: z.infer<typeof preRegistrationStatusUpdateSchema>['status']
        reviewedAt: Date
        reviewedBy: string
        observationNotes: string | null
        motherTongue?: string | null
        examRoom?: string | null
        studentPhoneSecondary?: string | null
        guardianPhoneSecondary?: string | null
      } = {
        status: input.status,
        reviewedAt: new Date(),
        reviewedBy: actor.username,
        observationNotes: normalizeOptional(input.observationNotes),
      }

      if (hasOwn(input, 'motherTongue')) {
        preRegistrationData.motherTongue = normalizeOptional(input.motherTongue)
      }
      if (hasOwn(input, 'examRoom')) {
        preRegistrationData.examRoom = normalizeOptional(input.examRoom)
      }
      if (hasOwn(input, 'studentPhoneSecondary')) {
        preRegistrationData.studentPhoneSecondary = normalizeOptional(input.studentPhoneSecondary)
      }
      if (hasOwn(input, 'guardianPhoneSecondary')) {
        preRegistrationData.guardianPhoneSecondary = normalizeOptional(input.guardianPhoneSecondary)
      }

      const item = await tx.preRegistration.update({
        where: { id },
        data: preRegistrationData,
      })

      let linkedStudentId: string | null = null
      if (input.status === 'VALIDADO_PARA_PAGO') {
        const alreadyLinked = await tx.student.findFirst({ where: { preRegistrationId: existing.id } })
        linkedStudentId = alreadyLinked?.id ?? null
        if (!alreadyLinked) {
          const student = await tx.student.create({
            data: {
              enrollmentNumber: item.folio,
              curp: item.curp,
              firstName: item.firstName,
              paternalLastName: item.paternalLastName,
              maternalLastName: item.maternalLastName,
              birthDate: item.birthDate,
              sex: item.sex,
              phone: item.phone,
              studentPhoneSecondary: item.studentPhoneSecondary,
              email: item.email,
              motherTongue: item.motherTongue,
              addressLine: item.addressLine,
              neighborhood: item.neighborhood,
              locality: item.locality,
              municipality: item.municipality,
              state: item.state,
              postalCode: item.postalCode,
              previousSchool: item.previousSchool,
              secondaryAverage: item.secondaryAverage,
              examRoom: item.examRoom,
              schoolCycle: item.schoolCycle,
              status: 'LISTO_PARA_COBRO',
              validatedAt: new Date(),
              validatedBy: 'CONTROL_ESCOLAR',
              preRegistrationId: item.id,
              guardian: {
                create: {
                  fullName: item.guardianFullName,
                  relationship: item.guardianRelationship,
                  phone: item.guardianPhone,
                  secondaryPhone: item.guardianPhoneSecondary,
                  email: item.guardianEmail,
                },
              },
            },
          })

          linkedStudentId = student.id
        } else {
          await tx.student.update({
            where: { id: alreadyLinked.id },
            data: {
              studentPhoneSecondary: item.studentPhoneSecondary,
              motherTongue: item.motherTongue,
              examRoom: item.examRoom,
              guardian: {
                upsert: {
                  create: {
                    fullName: item.guardianFullName,
                    relationship: item.guardianRelationship,
                    phone: item.guardianPhone,
                    secondaryPhone: item.guardianPhoneSecondary,
                    email: item.guardianEmail,
                  },
                  update: {
                    fullName: item.guardianFullName,
                    relationship: item.guardianRelationship,
                    phone: item.guardianPhone,
                    secondaryPhone: item.guardianPhoneSecondary,
                    email: item.guardianEmail,
                  },
                },
              },
            },
          })
        }
      }

      await tx.preRegistrationAudit.create({
        data: {
          preRegistrationId: item.id,
          action: `STATUS_${input.status}`,
          actorRole: actor.role,
          actorName: actor.displayName,
          detail: preRegistrationAuditDetail(input.status, normalizeOptional(input.observationNotes)),
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

  ipcMain.handle('preRegistrations:exportSep', async (_event, payload) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'exportar registros para SEP')
    const input = sepExportSchema.parse(payload ?? {})
    return exportSepCsv(input)
  })

  ipcMain.handle('students:list', async (_event, rawFilters) => {
    requireAuth()
    const filters = studentListFiltersSchema.parse(rawFilters)
    const query = filters?.query?.trim()
    const students = await prisma.student.findMany({
      where: {
        ...(filters?.schoolCycle ? { schoolCycle: filters.schoolCycle.trim() } : {}),
        ...(filters?.schoolPeriod ? { schoolPeriod: filters.schoolPeriod } : {}),
        ...(filters?.semesterLevel && filters.semesterLevel !== 'all' ? { semesterLevel: filters.semesterLevel } : {}),
        ...(filters?.enrollmentStatus && filters.enrollmentStatus !== 'all' ? { enrollmentStatus: filters.enrollmentStatus } : {}),
        ...(filters?.documentationStatus && filters.documentationStatus !== 'all' ? { documentationStatus: filters.documentationStatus } : {}),
        ...(query ? {
          OR: [
            { enrollmentNumber: { contains: query } },
            { curp: { contains: query.toUpperCase() } },
            { firstName: { contains: query } },
            { paternalLastName: { contains: query } },
            { maternalLastName: { contains: query } },
          ],
        } : {}),
      },
      include: summaryStudentInclude(),
      orderBy: { createdAt: 'desc' },
    })

    return students.map(studentSummary)
  })

  ipcMain.handle('students:listValidated', async () => {
    requireAuth()
    const students = await prisma.student.findMany({
      where: { status: { in: ['VALIDADO', 'LISTO_PARA_COBRO', 'COBRADO'] } },
      include: summaryStudentInclude(),
      orderBy: { createdAt: 'desc' },
    })

    return students.map(studentSummary)
  })

  ipcMain.handle('students:get', async (_event, studentId) => {
    requireAuth()
    const student = await prisma.student.findUnique({
      where: { id: z.string().min(1).parse(studentId) },
      include: { guardian: true, groupAssignment: { include: { group: true } } },
    })

    if (!student) {
      throw new Error('No se encontro el alumno solicitado.')
    }

    return studentDetail(student)
  })

  ipcMain.handle('students:getNextInternalFolioPreview', async () => {
    requireAuth()
    const sequence = await prisma.sequenceCounter.findUnique({ where: { scope: 'STUDENT_INTERNAL_FOLIO' } })
    const nextValue = (sequence?.lastValue ?? 0) + 1
    return `${INTERNAL_FOLIO_PREFIX}${String(nextValue).padStart(4, '0')}`
  })

  ipcMain.handle('permissions:list', async (_event, rawFilters) => {
    requireRole(['SECRETARIA', 'ADMIN'], 'consultar permisos escolares')
    const filters = permissionListFiltersSchema.parse(rawFilters)
    const query = filters?.query?.trim()
    const activeReferenceDate = filters?.activeOn?.trim() ? new Date(filters.activeOn.trim()) : new Date()
    const activeDayStart = startOfLocalDay(activeReferenceDate)
    const activeDayEnd = endOfLocalDay(activeReferenceDate)
    const permissions = await prisma.studentPermission.findMany({
      where: {
        ...(filters?.status && filters.status !== 'all' ? { status: filters.status } : {}),
        ...(query ? {
          OR: [
            { reason: { contains: query } },
            { notes: { contains: query } },
            { student: { is: { enrollmentNumber: { contains: query } } } },
            { student: { is: { officialEnrollmentNumber: { contains: query } } } },
            { student: { is: { curp: { contains: query.toUpperCase() } } } },
            { student: { is: { firstName: { contains: query } } } },
            { student: { is: { paternalLastName: { contains: query } } } },
            { student: { is: { maternalLastName: { contains: query } } } },
          ],
        } : {}),
      },
      include: {
        student: {
          include: {
            groupAssignment: { include: { group: true } },
            dailyStatuses: {
              where: { date: activeDayStart },
              select: { status: true },
              take: 1,
            },
          },
        },
        grantedBy: { select: { displayName: true } },
        closedBy: { select: { displayName: true } },
      },
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    })

    return permissions.map((permission) => {
      const normalizedStatus = normalizePermissionStatus(permission)
      const activeToday = permission.status !== 'CANCELADO' && permission.startsAt <= activeDayEnd && permission.endsAt >= activeDayStart
      return {
        id: permission.id,
        studentId: permission.studentId,
        studentName: `${permission.student.firstName} ${permission.student.paternalLastName} ${permission.student.maternalLastName}`.replace(/\s+/g, ' ').trim(),
        enrollmentNumber: permission.student.officialEnrollmentNumber?.trim() || permission.student.enrollmentNumber,
        groupLabel: permission.student.groupAssignment?.group.label ?? null,
        dailyStatus: activeToday ? 'PERMISO' : permission.student.dailyStatuses?.[0]?.status === 'AUSENTE' ? 'AUSENTE' : 'PRESENTE',
        kind: permission.kind,
        reason: permission.reason,
        notes: permission.notes ?? null,
        startsAt: permission.startsAt.toISOString(),
        endsAt: permission.endsAt.toISOString(),
        status: normalizedStatus,
        grantedByName: permission.grantedBy?.displayName ?? null,
        closedByName: permission.closedBy?.displayName ?? null,
        activeToday,
      }
    })
  })

  ipcMain.handle('permissions:create', async (_event, payload) => {
    const actor = requireRole(['SECRETARIA', 'ADMIN'], 'registrar permisos escolares')
    const input = permissionCreateSchema.parse(payload)
    const startsAt = new Date(input.startsAt)
    const endsAt = new Date(input.endsAt)
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new Error('Captura una fecha valida para el permiso.')
    }
    if (endsAt < startsAt) {
      throw new Error('La fecha final del permiso no puede ser menor que la inicial.')
    }

    await prisma.$transaction((tx) => ensureStudentRequirementStatuses(tx, input.studentId))

    const student = await prisma.student.findUnique({
      where: { id: input.studentId },
      select: { id: true, enrollmentNumber: true, firstName: true, paternalLastName: true, maternalLastName: true },
    })

    if (!student) {
      throw new Error('No se encontro el alumno para registrar el permiso.')
    }

    const created = await prisma.$transaction(async (tx) => {
      const permission = await tx.studentPermission.create({
        data: {
          studentId: input.studentId,
          kind: input.kind,
          reason: input.reason.trim(),
          notes: normalizeOptional(input.notes),
          startsAt,
          endsAt,
          status: normalizePermissionStatus({ status: 'PROGRAMADO', startsAt, endsAt }),
          grantedById: actor.id,
        },
        include: {
          student: {
            include: {
              groupAssignment: { include: { group: true } },
              dailyStatuses: {
                where: { date: startOfLocalDay() },
                select: { status: true },
                take: 1,
              },
            },
          },
          grantedBy: { select: { displayName: true } },
          closedBy: { select: { displayName: true } },
        },
      })

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          entityType: 'STUDENT_PERMISSION',
          entityId: permission.id,
          action: 'CREATE_PERMISSION',
          afterJson: JSON.stringify({
            studentId: input.studentId,
            summary: `${student.enrollmentNumber} - ${student.firstName} ${student.paternalLastName}`,
            reason: input.reason.trim(),
            startsAt: permission.startsAt.toISOString(),
            endsAt: permission.endsAt.toISOString(),
          }),
        },
      })

      return permission
    })

    return {
      id: created.id,
      studentId: created.studentId,
      studentName: `${created.student.firstName} ${created.student.paternalLastName} ${created.student.maternalLastName}`.replace(/\s+/g, ' ').trim(),
      enrollmentNumber: created.student.officialEnrollmentNumber?.trim() || created.student.enrollmentNumber,
      groupLabel: created.student.groupAssignment?.group.label ?? null,
      dailyStatus: 'PERMISO',
      kind: created.kind,
      reason: created.reason,
      notes: created.notes ?? null,
      startsAt: created.startsAt.toISOString(),
      endsAt: created.endsAt.toISOString(),
      status: normalizePermissionStatus(created),
      grantedByName: created.grantedBy?.displayName ?? null,
      closedByName: created.closedBy?.displayName ?? null,
      activeToday: created.startsAt <= endOfLocalDay() && created.endsAt >= startOfLocalDay(),
    }
  })

  ipcMain.handle('permissions:cancel', async (_event, payload) => {
    const actor = requireRole(['SECRETARIA', 'ADMIN'], 'cancelar permisos escolares')
    const input = permissionCancelSchema.parse(payload)
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.studentPermission.findUnique({
        where: { id: input.permissionId },
        include: {
          student: {
            include: {
              groupAssignment: { include: { group: true } },
              dailyStatuses: {
                where: { date: startOfLocalDay() },
                select: { status: true },
                take: 1,
              },
            },
          },
          grantedBy: { select: { displayName: true } },
        },
      })

      if (!existing) {
        throw new Error('No se encontro el permiso a cancelar.')
      }

      const permission = await tx.studentPermission.update({
        where: { id: input.permissionId },
        data: {
          status: 'CANCELADO',
          notes: normalizeOptional([existing.notes, normalizeOptional(input.notes)].filter(Boolean).join(' | ')),
          closedById: actor.id,
        },
        include: {
          student: {
            include: {
              groupAssignment: { include: { group: true } },
              dailyStatuses: {
                where: { date: startOfLocalDay() },
                select: { status: true },
                take: 1,
              },
            },
          },
          grantedBy: { select: { displayName: true } },
          closedBy: { select: { displayName: true } },
        },
      })

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          entityType: 'STUDENT_PERMISSION',
          entityId: permission.id,
          action: 'CANCEL_PERMISSION',
          afterJson: JSON.stringify({
            studentId: permission.studentId,
            notes: normalizeOptional(input.notes),
          }),
        },
      })

      return permission
    })

    return {
      id: updated.id,
      studentId: updated.studentId,
      studentName: `${updated.student.firstName} ${updated.student.paternalLastName} ${updated.student.maternalLastName}`.replace(/\s+/g, ' ').trim(),
      enrollmentNumber: updated.student.officialEnrollmentNumber?.trim() || updated.student.enrollmentNumber,
      groupLabel: updated.student.groupAssignment?.group.label ?? null,
      dailyStatus: updated.student.dailyStatuses?.[0]?.status === 'AUSENTE' ? 'AUSENTE' : 'PRESENTE',
      kind: updated.kind,
      reason: updated.reason,
      notes: updated.notes ?? null,
      startsAt: updated.startsAt.toISOString(),
      endsAt: updated.endsAt.toISOString(),
      status: 'CANCELADO',
      grantedByName: updated.grantedBy?.displayName ?? null,
      closedByName: updated.closedBy?.displayName ?? null,
      activeToday: false,
    }
  })

  ipcMain.handle('permissions:setDailyStatus', async (_event, payload) => {
    const actor = requireRole(['SECRETARIA', 'ADMIN'], 'registrar estatus diario')
    const input = dailyStatusSetSchema.parse(payload)
    const date = startOfLocalDay(input.date)
    const student = await prisma.student.findUnique({ where: { id: input.studentId }, select: { id: true } })
    if (!student) {
      throw new Error('No se encontro el alumno para actualizar su estatus diario.')
    }

    await prisma.$transaction(async (tx) => {
      if (input.status === 'PRESENTE') {
        await tx.studentDailyStatus.deleteMany({ where: { studentId: input.studentId, date } })
      } else {
        await tx.studentDailyStatus.upsert({
          where: { studentId_date: { studentId: input.studentId, date } },
          update: {
            status: input.status,
            notes: normalizeOptional(input.notes),
            recordedById: actor.id,
          },
          create: {
            studentId: input.studentId,
            date,
            status: input.status,
            notes: normalizeOptional(input.notes),
            recordedById: actor.id,
          },
        })
      }
    })

    return loadStudentSummaryById(input.studentId, date)
  })

  ipcMain.handle('permissions:clearDailyStatus', async (_event, payload) => {
    requireRole(['SECRETARIA', 'ADMIN'], 'limpiar estatus diario')
    const input = dailyStatusClearSchema.parse(payload)
    const date = startOfLocalDay(input.date)
    await prisma.studentDailyStatus.deleteMany({
      where: {
        studentId: input.studentId,
        date,
      },
    })
    return loadStudentSummaryById(input.studentId, date)
  })

  ipcMain.handle('students:getRequirementChecklist', async (_event, studentId) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'consultar checklist documental')
    const id = z.string().min(1).parse(studentId)
    await prisma.$transaction((tx) => ensureStudentRequirementStatuses(tx, id))
    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        requirementStatuses: {
          include: { requirement: true },
        },
      },
    })

    if (!student) throw new Error('No se encontro el alumno para el checklist documental.')
    return requirementChecklistSummary(student)
  })

  ipcMain.handle('students:saveRequirementChecklist', async (_event, studentId, payload) => {
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'guardar checklist documental')
    const id = z.string().min(1).parse(studentId)
    const input = saveRequirementChecklistSchema.parse(payload)

    const student = await prisma.$transaction(async (tx) => {
      for (const item of input.items) {
        await tx.studentRequirementStatus.update({
          where: { studentId_requirementId: { studentId: id, requirementId: item.requirementId } },
          data: {
            isDelivered: item.isDelivered,
            missingJustification: item.isDelivered ? null : normalizeOptional(item.missingJustification),
            deadlineAt: item.isDelivered || !item.deadlineAt ? null : new Date(item.deadlineAt),
            notes: normalizeOptional(item.notes),
            reviewedAt: new Date(),
            reviewedBy: actor.displayName,
          },
        })
      }

      const refreshed = await tx.student.findUnique({
        where: { id },
        include: {
          requirementStatuses: {
            include: { requirement: true },
          },
        },
      })

      if (!refreshed) throw new Error('No se encontro el alumno despues de guardar el checklist.')

      await tx.student.update({
        where: { id },
        data: { documentationStatus: checklistStatusLabel(refreshed.requirementStatuses) },
      })

      return tx.student.findUnique({
        where: { id },
        include: {
          requirementStatuses: {
            include: { requirement: true },
          },
        },
      })
    })

    if (!student) throw new Error('No se pudo reconstruir el checklist documental.')
    return requirementChecklistSummary(student)
  })

  ipcMain.handle('students:formalizeEnrollment', async (_event, payload) => {
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'inscribir formalmente alumnos')
    const input = formalizeEnrollmentSchema.parse(payload)
    const student = await prisma.student.findUnique({
      where: { id: input.studentId },
      include: {
        requirementStatuses: { include: { requirement: true } },
        groupAssignment: { include: { group: true } },
      },
    })

    if (!student) throw new Error('No se encontro el alumno para inscripcion.')
    if (student.enrollmentStatus !== 'FICHA_ENTREGADA') {
      throw new Error('Solo se pueden inscribir alumnos con ficha entregada.')
    }

    const missingRequired = missingRequiredRequirementLabels(student.requirementStatuses)
    if (missingRequired.length > 0 && !input.allowPendingDocuments) {
      throw new Error(`Faltan documentos obligatorios sin justificante/plazo: ${missingRequired.join(', ')}.`)
    }

    const nextEnrollmentStatus = student.groupAssignment ? 'ASIGNADO' : 'INSCRITO'
    const nextDocumentationStatus = checklistStatusLabel(student.requirementStatuses)

    await prisma.$transaction(async (tx) => {
      const nextEnrollmentNumber = await buildStudentInternalFolio(tx)
      await tx.student.update({
        where: { id: student.id },
        data: {
          enrollmentNumber: nextEnrollmentNumber,
          officialEnrollmentNumber: nextEnrollmentNumber,
          schoolCycle: '2026-2027',
          schoolPeriod: 1,
          semesterLevel: 1,
          enrollmentStatus: nextEnrollmentStatus,
          documentationStatus: nextDocumentationStatus,
          status: 'VALIDADO',
          validatedAt: new Date(),
          validatedBy: actor.displayName,
        },
      })
      await tx.studentAcademicMovement.create({
        data: {
          studentId: student.id,
          movementType: 'ALTA_GRADO',
          reasonCode: 'INSCRIPCION_FORMAL',
          reasonLabel: 'Inscripcion formal',
          notes: normalizeOptional(input.notes),
          previousSemesterLevel: student.semesterLevel,
          nextSemesterLevel: student.semesterLevel,
          previousGroupId: student.groupAssignment?.groupId ?? null,
          previousGroupLabel: student.groupAssignment?.group.label ?? null,
          nextGroupId: student.groupAssignment?.groupId ?? null,
          nextGroupLabel: student.groupAssignment?.group.label ?? null,
          previousEnrollmentStatus: student.enrollmentStatus,
          nextEnrollmentStatus,
          actorId: actor.id,
          actorRole: actor.role,
        },
      })
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          entityType: 'Student',
          entityId: student.id,
          action: 'INSCRIPCION_FORMAL',
          beforeJson: JSON.stringify({ enrollmentNumber: student.enrollmentNumber, enrollmentStatus: student.enrollmentStatus }),
          afterJson: JSON.stringify({ enrollmentStatus: nextEnrollmentStatus }),
        },
      })
    })

    return loadStudentSummaryById(student.id)
  })

  ipcMain.handle('students:create', async (_event, payload) => {
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'crear alumnos')
    const input = studentInputSchema.parse(payload)
    const validated = input.validateNow
    const paymentAnchor = await prisma.admissionPayment.findFirst({
      where: { curp: input.curp.trim().toUpperCase() },
      orderBy: { createdAt: 'desc' },
    })

    if (!paymentAnchor) {
      throw new Error('Primero debes registrar el pago de ficha para este CURP.')
    }

    const student = await prisma.$transaction(async (tx) => {
      const createdStudent = await tx.student.create({
        data: {
          enrollmentNumber: await buildStudentInternalFolio(tx),
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
          schoolPeriod: input.schoolPeriod,
          semesterLevel: normalizeSemesterLevel(input.semesterLevel),
          academicStatus: normalizeOptional(input.academicStatus),
          documentationStatus: 'PENDIENTE',
          status: validated ? 'LISTO_PARA_COBRO' : 'CAPTURADO',
          enrollmentStatus: 'INSCRITO',
          validatedAt: validated ? new Date() : null,
          validatedBy: validated ? 'CONTROL_ESCOLAR' : null,
          admissionPaymentId: paymentAnchor.id,
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
      })

      const requirements = await tx.enrollmentRequirement.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })
      if (requirements.length > 0) {
        await tx.studentRequirementStatus.createMany({
          data: requirements.map((requirement) => ({ studentId: createdStudent.id, requirementId: requirement.id })),
        })
      }

      await tx.auditLog.create({
        data: {
          userId: actor.id,
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

    return loadStudentSummaryById(student.id)
  })

  ipcMain.handle('students:update', async (_event, studentId, payload) => {
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'editar alumnos')
    const id = z.string().min(1).parse(studentId)
    const input = studentInputSchema.parse(payload)
    const validated = input.validateNow
    const existing = await prisma.student.findUnique({
      where: { id },
      include: { guardian: true },
    })

    if (!existing) {
      throw new Error('No se encontro el alumno para actualizar.')
    }

    const paymentAnchor = await prisma.admissionPayment.findFirst({
      where: { curp: input.curp.trim().toUpperCase() },
      orderBy: { createdAt: 'desc' },
    })

    const student = await prisma.$transaction(async (tx) => {
      const updatedStudent = await tx.student.update({
        where: { id },
        data: {
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
          schoolPeriod: input.schoolPeriod,
          semesterLevel: normalizeSemesterLevel(input.semesterLevel),
          academicStatus: normalizeOptional(input.academicStatus),
          status: validated ? 'LISTO_PARA_COBRO' : 'CAPTURADO',
          enrollmentStatus: existing.enrollmentStatus || 'INSCRITO',
          validatedAt: validated ? existing.validatedAt ?? new Date() : null,
          validatedBy: validated ? existing.validatedBy ?? 'CONTROL_ESCOLAR' : null,
          ...(paymentAnchor ? { admissionPaymentId: paymentAnchor.id } : {}),
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
      })

      await tx.auditLog.create({
        data: {
          userId: actor.id,
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

    return loadStudentSummaryById(student.id)
  })

  ipcMain.handle('students:changeGroup', async (_event, payload) => {
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'cambiar grupo de alumno')
    const input = studentGroupChangeSchema.parse(payload)
    const student = await prisma.student.findUnique({
      where: { id: input.studentId },
      include: { groupAssignment: { include: { group: true } } },
    })
    if (!student) throw new Error('No se encontro el alumno.')
    if (['BAJA', 'BAJA_DEFINITIVA'].includes(student.enrollmentStatus)) throw new Error('El alumno esta dado de baja.')
    const targetGroup = await prisma.intakeGroup.findUnique({
      where: { id: input.toGroupId },
      include: { assignments: { where: { status: { not: 'NO_SHOW' } } } },
    })
    if (!targetGroup) throw new Error('Grupo destino no encontrado.')
    if (targetGroup.assignments.length >= targetGroup.capacity) throw new Error(`El grupo destino ya alcanzo el cupo maximo de ${targetGroup.capacity}.`)
    const reasonLabel = movementReasonLabel('CAMBIO_GRUPO', input.reasonCode)

    const result = await prisma.$transaction(async (tx) => {
      const existingAssignment = student.groupAssignment
      const assignment = existingAssignment
        ? await tx.studentGroupAssignment.update({ where: { id: existingAssignment.id }, data: { groupId: targetGroup.id, status: 'ASIGNADO', updatedById: actor.id, reason: input.notes?.trim() || reasonLabel } })
        : await tx.studentGroupAssignment.create({ data: { studentId: student.id, groupId: targetGroup.id, status: 'ASIGNADO', assignedById: actor.id, updatedById: actor.id, reason: input.notes?.trim() || reasonLabel } })
      await tx.student.update({ where: { id: student.id }, data: { semesterLevel: normalizeSemesterLevel(targetGroup.semesterLevel), enrollmentStatus: 'ASIGNADO' } })
      await tx.groupAssignmentAudit.create({ data: { assignmentId: assignment.id, studentId: student.id, beforeGroupId: existingAssignment?.groupId ?? null, beforeGroupLabel: existingAssignment?.group.label ?? null, afterGroupId: targetGroup.id, afterGroupLabel: targetGroup.label, actorId: actor.id, actorRole: actor.role, reason: input.notes?.trim() || reasonLabel } })
      const movement = await tx.studentAcademicMovement.create({ data: { studentId: student.id, movementType: 'CAMBIO_GRUPO', reasonCode: input.reasonCode, reasonLabel, notes: normalizeOptional(input.notes), previousSemesterLevel: student.semesterLevel, nextSemesterLevel: normalizeSemesterLevel(targetGroup.semesterLevel), previousGroupId: existingAssignment?.groupId ?? null, previousGroupLabel: existingAssignment?.group.label ?? null, nextGroupId: targetGroup.id, nextGroupLabel: targetGroup.label, previousEnrollmentStatus: student.enrollmentStatus, nextEnrollmentStatus: 'ASIGNADO', actorId: actor.id, actorRole: actor.role } })
      return { assignmentId: assignment.id, movementId: movement.id }
    })

    return { ok: true, assignmentId: result.assignmentId, movementId: result.movementId }
  })

  ipcMain.handle('students:withdraw', async (_event, payload) => {
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'dar de baja alumnos')
    const input = studentWithdrawalSchema.parse(payload)
    const student = await prisma.student.findUnique({
      where: { id: input.studentId },
      include: { groupAssignment: { include: { group: true } } },
    })
    if (!student) throw new Error('No se encontro el alumno.')
    const reasonLabel = movementReasonLabel('BAJA', input.reasonCode)
    const movementId = await prisma.$transaction(async (tx) => {
      if (student.groupAssignment) {
        await tx.studentGroupAssignment.delete({ where: { id: student.groupAssignment.id } })
      }
      await tx.student.update({ where: { id: student.id }, data: { enrollmentStatus: 'BAJA' } })
      const movement = await tx.studentAcademicMovement.create({ data: { studentId: student.id, movementType: 'BAJA', reasonCode: input.reasonCode, reasonLabel, notes: normalizeOptional(input.notes), previousSemesterLevel: student.semesterLevel, nextSemesterLevel: student.semesterLevel, previousGroupId: student.groupAssignment?.groupId ?? null, previousGroupLabel: student.groupAssignment?.group.label ?? null, nextGroupId: null, nextGroupLabel: null, previousEnrollmentStatus: student.enrollmentStatus, nextEnrollmentStatus: 'BAJA', effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : null, actorId: actor.id, actorRole: actor.role } })
      return movement.id
    })
    return { ok: true, movementId }
  })

  ipcMain.handle('students:enrollGrade', async (_event, payload) => {
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'registrar alta a grado')
    const input = studentGradeEnrollmentSchema.parse(payload)
    const student = await prisma.student.findUnique({
      where: { id: input.studentId },
      include: { groupAssignment: { include: { group: true } }, guardian: true, admissionPayment: { select: { status: true } }, cashPayments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    if (!student) throw new Error('No se encontro el alumno.')
    const semesterLevel = normalizeSemesterLevel(input.semesterLevel)
    const targetGroup = input.toGroupId ? await prisma.intakeGroup.findUnique({ where: { id: input.toGroupId }, include: { assignments: { where: { status: { not: 'NO_SHOW' } } } } }) : null
    if (targetGroup && targetGroup.assignments.length >= targetGroup.capacity) throw new Error(`El grupo destino ya alcanzo el cupo maximo de ${targetGroup.capacity}.`)
    const reasonLabel = movementReasonLabel('ALTA_GRADO', input.reasonCode)

    const updated = await prisma.$transaction(async (tx) => {
      const previousAssignment = student.groupAssignment
      if (!targetGroup && previousAssignment) {
        await tx.studentGroupAssignment.delete({ where: { id: previousAssignment.id } })
      }
      if (targetGroup) {
        if (previousAssignment) {
          await tx.studentGroupAssignment.update({ where: { id: previousAssignment.id }, data: { groupId: targetGroup.id, status: 'ASIGNADO', updatedById: actor.id, reason: input.notes?.trim() || reasonLabel } })
        } else {
          await tx.studentGroupAssignment.create({ data: { studentId: student.id, groupId: targetGroup.id, status: 'ASIGNADO', assignedById: actor.id, updatedById: actor.id, reason: input.notes?.trim() || reasonLabel } })
        }
      }
      const nextEnrollmentStatus = targetGroup ? 'ASIGNADO' : 'INSCRITO'
      const nextStudent = await tx.student.update({
        where: { id: student.id },
        data: { schoolCycle: input.schoolCycle.trim(), schoolPeriod: input.schoolPeriod, semesterLevel, enrollmentStatus: nextEnrollmentStatus, academicStatus: student.academicStatus ?? 'Regular' },
        include: { groupAssignment: { include: { group: true } }, guardian: true, admissionPayment: { select: { status: true } }, cashPayments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
      })
      await tx.studentAcademicMovement.create({ data: { studentId: student.id, movementType: 'ALTA_GRADO', reasonCode: input.reasonCode, reasonLabel, notes: normalizeOptional(input.notes), previousSemesterLevel: student.semesterLevel, nextSemesterLevel: semesterLevel, previousGroupId: previousAssignment?.groupId ?? null, previousGroupLabel: previousAssignment?.group.label ?? null, nextGroupId: targetGroup?.id ?? null, nextGroupLabel: targetGroup?.label ?? null, previousEnrollmentStatus: student.enrollmentStatus, nextEnrollmentStatus, actorId: actor.id, actorRole: actor.role } })
      return nextStudent
    })

    return studentSummary(updated)
  })

  ipcMain.handle('students:reinscribeForPeriod', async (_event, payload) => {
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'reinscribir alumnos al periodo')
    const input = reinscribeForPeriodSchema.parse(payload)
    await prisma.$transaction((tx) => ensureStudentRequirementStatuses(tx, input.studentId))
    const student = await prisma.student.findUnique({
      where: { id: input.studentId },
      include: {
        requirementStatuses: { include: { requirement: true } },
        groupAssignment: { include: { group: true } },
        guardian: true,
        admissionPayment: { select: { status: true } },
        cashPayments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
    if (!student) throw new Error('No se encontro el alumno para reinscripcion.')
    if (['BAJA', 'BAJA_TEMPORAL', 'BAJA_DEFINITIVA', 'NO_SHOW', 'EGRESADO'].includes(student.enrollmentStatus)) {
      throw new Error('El alumno no esta activo para reinscripcion.')
    }

    const missingRequired = missingRequiredRequirementLabels(student.requirementStatuses)
    if (missingRequired.length > 0) {
      throw new Error(`Faltan documentos obligatorios sin justificante/plazo: ${missingRequired.join(', ')}.`)
    }

    const targetGroup = input.toGroupId ? await prisma.intakeGroup.findUnique({ where: { id: input.toGroupId }, include: { assignments: { where: { status: { not: 'NO_SHOW' } } } } }) : null
    if (targetGroup && targetGroup.assignments.length >= targetGroup.capacity) throw new Error(`El grupo destino ya alcanzo el cupo maximo de ${targetGroup.capacity}.`)
    const semesterLevel = normalizeSemesterLevel(input.targetSemesterLevel)
    const nextEnrollmentStatus = targetGroup ? 'ASIGNADO' : 'INSCRITO'
    const nextDocumentationStatus = checklistStatusLabel(student.requirementStatuses)

    const updated = await prisma.$transaction(async (tx) => {
      const previousAssignment = student.groupAssignment
      if (!targetGroup && previousAssignment) {
        await tx.studentGroupAssignment.delete({ where: { id: previousAssignment.id } })
      }
      if (targetGroup) {
        if (previousAssignment) {
          await tx.studentGroupAssignment.update({ where: { id: previousAssignment.id }, data: { groupId: targetGroup.id, status: 'ASIGNADO', updatedById: actor.id, reason: input.notes?.trim() || 'Reinscripcion semestral' } })
        } else {
          await tx.studentGroupAssignment.create({ data: { studentId: student.id, groupId: targetGroup.id, status: 'ASIGNADO', assignedById: actor.id, updatedById: actor.id, reason: input.notes?.trim() || 'Reinscripcion semestral' } })
        }
      }
      const nextStudent = await tx.student.update({
        where: { id: student.id },
        data: {
          schoolCycle: input.targetSchoolCycle.trim(),
          schoolPeriod: input.targetPeriod,
          semesterLevel,
          enrollmentStatus: nextEnrollmentStatus,
          documentationStatus: nextDocumentationStatus,
          status: 'VALIDADO',
          academicStatus: student.academicStatus ?? 'Regular',
        },
        include: { groupAssignment: { include: { group: true } }, guardian: true, admissionPayment: { select: { status: true } }, cashPayments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
      })
      await tx.studentAcademicMovement.create({
        data: {
          studentId: student.id,
          movementType: 'REINSCRIPCION',
          reasonCode: 'REINSCRIPCION_SEMESTRAL',
          reasonLabel: 'Reinscripcion semestral',
          notes: normalizeOptional(input.notes),
          previousSemesterLevel: student.semesterLevel,
          nextSemesterLevel: semesterLevel,
          previousGroupId: previousAssignment?.groupId ?? null,
          previousGroupLabel: previousAssignment?.group.label ?? null,
          nextGroupId: targetGroup?.id ?? null,
          nextGroupLabel: targetGroup?.label ?? null,
          previousEnrollmentStatus: student.enrollmentStatus,
          nextEnrollmentStatus,
          actorId: actor.id,
          actorRole: actor.role,
        },
      })
      return nextStudent
    })

    return studentSummary(updated)
  })

  ipcMain.handle('students:graduatePeriod', async (_event, payload) => {
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'egresar alumnos')
    const input = graduatePeriodSchema.parse(payload)
    const ids = Array.from(new Set([...(input.studentIds ?? []), ...(input.studentId ? [input.studentId] : [])]))
    const students = await prisma.student.findMany({
      where: {
        id: { in: ids },
        schoolCycle: input.fromSchoolCycle.trim(),
        ...(input.fromPeriod ? { schoolPeriod: input.fromPeriod } : {}),
      },
      include: { groupAssignment: { include: { group: true } } },
    })
    if (students.length === 0) throw new Error('No se encontraron alumnos para egresar.')

    await prisma.$transaction(async (tx) => {
      for (const student of students) {
        if (student.semesterLevel !== 6) continue
        const previousAssignment = student.groupAssignment
        await tx.student.update({ where: { id: student.id }, data: { enrollmentStatus: 'EGRESADO', status: 'VALIDADO' } })
        await tx.studentAcademicMovement.create({
          data: {
            studentId: student.id,
            movementType: 'EGRESO',
            reasonCode: 'EGRESO_SEMESTRAL',
            reasonLabel: 'Egreso semestral',
            notes: normalizeOptional(input.notes),
            previousSemesterLevel: student.semesterLevel,
            nextSemesterLevel: student.semesterLevel,
            previousGroupId: previousAssignment?.groupId ?? null,
            previousGroupLabel: previousAssignment?.group.label ?? null,
            nextGroupId: previousAssignment?.groupId ?? null,
            nextGroupLabel: previousAssignment?.group.label ?? null,
            previousEnrollmentStatus: student.enrollmentStatus,
            nextEnrollmentStatus: 'EGRESADO',
            actorId: actor.id,
            actorRole: actor.role,
          },
        })
      }
    })

    return { ok: true, graduatedCount: students.filter((student) => student.semesterLevel === 6).length }
  })

  ipcMain.handle('students:listMovements', async (_event, payload) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'consultar movimientos escolares')
    const input = studentMovementListSchema.parse(payload)
    const movements = await prisma.studentAcademicMovement.findMany({
      where: {
        ...(input?.studentId ? { studentId: input.studentId } : {}),
        ...(input?.schoolCycle ? { student: { schoolCycle: input.schoolCycle.trim() } } : {}),
      },
      include: { student: true, actor: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: input?.limit ?? 20,
    })
    return movements.map(academicMovementSummary)
  })

  ipcMain.handle('students:importEnrollmentRoster', async (_event, payload) => {
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'importar matricula desde Excel')
    const input = enrollmentRosterImportSchema.parse(payload)
    const schoolCycle = input.schoolCycle.trim()
    const issues: string[] = []
    const dedupedRows = new Map<string, z.infer<typeof enrollmentRosterImportSchema>['rows'][number]>()

    for (const row of input.rows) {
      const key = row.curp.toUpperCase()
      if (dedupedRows.has(key)) {
        issues.push(`Fila ${row.rowNumber} en ${row.sheetName}: CURP repetida; se conserva la ultima aparicion.`)
      }
      dedupedRows.set(key, { ...row, curp: key, enrollmentNumber: row.enrollmentNumber.trim(), groupLabel: row.groupLabel.trim().toUpperCase() })
    }

    const rows = Array.from(dedupedRows.values())
    const groupKeys = Array.from(new Set(rows.map((row) => `${row.semesterLevel}:${row.groupLabel}`)))
    const groupFilters = groupKeys.map((key) => {
      const [semesterLevelText, label] = key.split(':')
      return { semesterLevel: normalizeSemesterLevel(Number(semesterLevelText)), label }
    })
    const existingGroups = await prisma.intakeGroup.findMany({
      where: { schoolCycle, shift: MATUTINO_SHIFT, OR: groupFilters },
      select: { label: true, semesterLevel: true },
    })
    const existingGroupKeys = new Set(existingGroups.map((group) => `${normalizeSemesterLevel(group.semesterLevel)}:${group.label}`))

    if (groupFilters.length > 0) {
      await prisma.$transaction(
        groupFilters.map(({ semesterLevel, label }) =>
          prisma.intakeGroup.upsert({
            where: { schoolCycle_semesterLevel_label_shift: { schoolCycle, semesterLevel, label, shift: MATUTINO_SHIFT } },
            update: { isActive: true },
            create: { schoolCycle, semesterLevel, label, shift: MATUTINO_SHIFT, capacity: ASSIGNMENT_MAX_CAPACITY },
          }),
        ),
      )
    }

    const groups = await prisma.intakeGroup.findMany({
      where: { schoolCycle, shift: MATUTINO_SHIFT, OR: groupFilters },
      select: { id: true, label: true, semesterLevel: true },
    })
    const groupByKey = new Map(groups.map((group) => [`${normalizeSemesterLevel(group.semesterLevel)}:${group.label}`, group]))

    let createdCount = 0
    let updatedCount = 0
    let assignedCount = 0

    for (const row of rows) {
      const isFicha = row.importKind === 'FICHA'
      const officialEnrollmentNumber = isFicha ? null : row.officialEnrollmentNumber ?? row.enrollmentNumber
      const nextEnrollmentStatus = isFicha ? 'FICHA_ENTREGADA' : 'ASIGNADO'
      const nextStudentStatus = isFicha ? 'CAPTURADO' : 'VALIDADO'
      const group = groupByKey.get(`${row.semesterLevel}:${row.groupLabel}`)
      if (!group) {
        issues.push(`Fila ${row.rowNumber} en ${row.sheetName}: no se pudo preparar el grupo ${row.groupLabel}.`)
        continue
      }

      const names = splitImportedFullName(row.fullName)
      const existingStudent = await prisma.student.findFirst({
        where: {
          OR: [
            { curp: row.curp },
            ...(officialEnrollmentNumber ? [{ officialEnrollmentNumber }] : []),
          ],
        },
        include: { groupAssignment: { include: { group: true } } },
      })

      await prisma.$transaction(async (tx) => {
        const student = existingStudent
          ? await tx.student.update({
            where: { id: existingStudent.id },
            data: {
              officialEnrollmentNumber,
              firstName: names.firstName,
              paternalLastName: names.paternalLastName,
              maternalLastName: names.maternalLastName,
              age: row.age ?? null,
              sex: normalizeImportedSex(row.sex),
              phone: normalizeOptional(row.phone ?? null),
              email: normalizeOptional(row.email ?? null),
              motherTongue: normalizeOptional(row.motherTongue ?? null),
              locality: normalizeOptional(row.locality ?? null),
              previousSchool: normalizeOptional(row.previousSchool ?? null),
              secondaryAverage: row.secondaryAverage ?? null,
              schoolCycle,
              schoolPeriod: 1,
              semesterLevel: row.semesterLevel,
              academicStatus: row.career ? `Carrera ${row.career}` : existingStudent.academicStatus,
              enrollmentStatus: nextEnrollmentStatus,
              status: nextStudentStatus,
              ...(isFicha ? {} : { validatedAt: new Date(), validatedBy: actor.displayName }),
            },
          })
          : await tx.student.create({
            data: {
              enrollmentNumber: row.enrollmentNumber,
              officialEnrollmentNumber,
              curp: row.curp,
              firstName: names.firstName,
              paternalLastName: names.paternalLastName,
              maternalLastName: names.maternalLastName,
              age: row.age ?? null,
              sex: normalizeImportedSex(row.sex),
              phone: normalizeOptional(row.phone ?? null),
              email: normalizeOptional(row.email ?? null),
              motherTongue: normalizeOptional(row.motherTongue ?? null),
              addressLine: 'PENDIENTE DE ACTUALIZAR',
              locality: normalizeOptional(row.locality ?? null),
              municipality: 'Yajalon',
              state: 'Chiapas',
              previousSchool: normalizeOptional(row.previousSchool ?? null),
              secondaryAverage: row.secondaryAverage ?? null,
              schoolCycle,
              schoolPeriod: 1,
              semesterLevel: row.semesterLevel,
              academicStatus: row.career ? `Carrera ${row.career}` : 'Regular',
              enrollmentStatus: nextEnrollmentStatus,
              documentationStatus: 'PENDIENTE',
              status: nextStudentStatus,
              validatedAt: isFicha ? null : new Date(),
              validatedBy: isFicha ? null : actor.displayName,
              guardian: {
                create: {
                  fullName: normalizeOptional(row.guardianFullName ?? null) ?? 'PENDIENTE DE ACTUALIZAR',
                  phone: normalizeOptional(row.guardianPhone ?? null) ?? 'PENDIENTE',
                },
              },
            },
          })

        const existingAssignment = existingStudent?.groupAssignment ?? null
        await ensureStudentRequirementStatuses(tx, student.id)
        const assignment = existingAssignment
          ? await tx.studentGroupAssignment.update({
            where: { id: existingAssignment.id },
            data: { groupId: group.id, status: 'ASIGNADO', updatedById: actor.id, reason: isFicha ? 'IMPORTACION_FICHAS_EXCEL' : 'IMPORTACION_MATRICULA_EXCEL' },
          })
          : await tx.studentGroupAssignment.create({
            data: { studentId: student.id, groupId: group.id, status: 'ASIGNADO', assignedById: actor.id, updatedById: actor.id, reason: isFicha ? 'IMPORTACION_FICHAS_EXCEL' : 'IMPORTACION_MATRICULA_EXCEL' },
          })

        await tx.groupAssignmentAudit.create({
          data: {
            assignmentId: assignment.id,
            studentId: student.id,
            beforeGroupId: existingAssignment?.groupId ?? null,
            beforeGroupLabel: existingAssignment?.group.label ?? null,
            afterGroupId: group.id,
            afterGroupLabel: group.label,
            actorId: actor.id,
            actorRole: actor.role,
            reason: isFicha ? 'IMPORTACION_FICHAS_EXCEL' : 'IMPORTACION_MATRICULA_EXCEL',
          },
        })
      })

      if (existingStudent) updatedCount += 1
      else createdCount += 1
      assignedCount += 1
    }

    await prisma.auditLog.create({
      data: {
        userId: actor.id,
        entityType: 'Student',
        entityId: schoolCycle,
        action: 'IMPORTACION_MATRICULA_EXCEL',
        afterJson: JSON.stringify({ sourcePath: input.sourcePath ?? null, createdCount, updatedCount, assignedCount }),
      },
    })

    return {
      ok: true,
      sourcePath: input.sourcePath ?? null,
      createdCount,
      updatedCount,
      assignedCount,
      createdGroupCount: groupKeys.filter((key) => !existingGroupKeys.has(key)).length,
      skippedCount: input.rows.length - rows.length,
      issues: issues.slice(0, 12),
    }
  })

  ipcMain.handle('concepts:listActive', async () => {
    requireAuth()
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
    const actor = requireRole(['ADMIN', 'INGRESOS_PROPIOS'], 'actualizar tarifas')
    const input = tariffUpdateSchema.parse(payload)

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
          userId: actor.id,
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

  ipcMain.handle('concepts:updateSuggested', async (_event, payload) => {
    requireRole(['ADMIN'], 'actualizar clave sugerida')
    const input = conceptSuggestionUpdateSchema.parse(payload)

    const updated = await prisma.chargeConcept.update({
      where: { code: input.code },
      data: { isSuggested: input.isSuggested },
      include: {
        tariffs: {
          where: { isActive: true },
          orderBy: { id: 'desc' },
          take: 1,
        },
      },
    })

    return conceptSummary(updated)
  })

  ipcMain.handle('payments:create', async (_event, payload) => {
    const actor = requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'registrar cobros')
    const input = cashPaymentCreateSchema.parse(payload)

    const student = await prisma.student.findUnique({
      where: { id: input.studentId },
      select: { id: true },
    })

    if (!student) {
      throw new Error('Alumno no encontrado para registrar el cobro.')
    }

    const concepts = await prisma.chargeConcept.findMany({
      where: { code: { in: input.conceptItems.map((item) => item.code) }, isActive: true },
    })

    if (concepts.length !== input.conceptItems.length) {
      throw new Error('Hay claves de cobro invalidas o inactivas.')
    }

    const conceptByCode = new Map(concepts.map((concept) => [concept.code, concept]))

    const created = await prisma.cashPayment.create({
      data: {
        studentId: input.studentId,
        createdById: actor.id,
        notes: input.notes?.trim() || null,
        lines: {
          create: input.conceptItems.map((item) => {
            const concept = conceptByCode.get(item.code)
            if (!concept) {
              throw new Error(`No se encontro la clave ${item.code}.`)
            }

            return {
              conceptId: concept.id,
              quantity: 1,
              unitAmount: item.amount,
              total: item.amount,
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

    return cashPaymentSummary(created)
  })

  ipcMain.handle('payments:list', async (_event, rawFilters) => {
    requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'consultar cobros')
    const filters = cashPaymentListFiltersSchema.parse(rawFilters)

    const payments = await prisma.cashPayment.findMany({
      where: filters?.status ? { status: filters.status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        student: true,
        lines: {
          include: {
            concept: true,
          },
        },
      },
    })

    return payments.map(cashPaymentSummary)
  })

  ipcMain.handle('payments:generateBatch', async (_event, payload) => {
    const actor = requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'generar ROC masivo')
    const input = cashPaymentBatchCreateSchema.parse(payload)

    const payments = await prisma.cashPayment.findMany({
      where: { id: { in: input.paymentIds }, status: 'PENDIENTE_ROC' },
      orderBy: { createdAt: 'asc' },
      include: {
        student: true,
        lines: {
          include: {
            concept: true,
          },
        },
      },
    })

    if (payments.length === 0) {
      throw new Error('No hay cobros pendientes seleccionados para generar el ROC masivo.')
    }

    await Promise.all(
      payments.map((payment, index) => assertRocNumberAvailable(buildNextRocNumber(input.startingRocNumber.trim(), index))),
    )

    const receiptEntries = await prisma.$transaction(async (tx) => {
      const generated: Array<{
        receipt: { rocNumber: string; totalAmount: unknown; lines: Array<{ concept: { code: string; name: string }; unitAmount: unknown }> }
        student: { firstName: string; paternalLastName: string; maternalLastName: string; enrollmentNumber: string }
      }> = []

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
              create: printableLines.map((line) => ({
                conceptId: line.conceptId,
                quantity: line.quantity,
                unitAmount: line.unitAmount,
                total: line.total,
              })),
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

        await tx.cashPayment.update({
          where: { id: payment.id },
          data: { status: 'ROC_GENERADO', batchGeneratedAt: new Date() },
        })

        await tx.student.update({
          where: { id: payment.studentId },
          data: { status: 'COBRADO' },
        })

        await tx.auditLog.create({
          data: {
            userId: actor.id,
            entityType: 'ROC_BATCH',
            entityId: payment.id,
            action: 'CREATE_BATCH_ROC',
            afterJson: JSON.stringify({
              summary: `${rocNumber} - ${payment.student.firstName} ${payment.student.paternalLastName}`,
            }),
          },
        })

        generated.push({ receipt, student: receipt.student })
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
      include: {
        student: {
          include: {
            groupAssignment: {
              include: {
                group: true
              }
            }
          }
        },
        lines: { include: { concept: true } },
      },
    })
    const outputPath = await exportOfficialRocTemplateBatch(
      monthlyReceipts.map(receiptToTemplatePayload),
      `roc-mensual-${periodLabel}`,
    )
    const openResult = await shell.openPath(outputPath)
    if (openResult) {
      throw new Error(openResult)
    }

    return {
      ok: true,
      outputPath,
      createdCount: receiptEntries.length,
      firstRocNumber: receiptEntries[0].receipt.rocNumber,
      lastRocNumber: receiptEntries[receiptEntries.length - 1].receipt.rocNumber,
    }
  })

  ipcMain.handle('receipts:create', async (_event, payload) => {
    const actor = requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'emitir ROC')
    const input = receiptInputSchema.parse(payload)
    await assertRocNumberAvailable(input.rocNumber)

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

    const amountByCode = new Map((input.conceptItems ?? []).map((item) => [item.code, item.amount]))
    const printableConcepts = concepts.filter((concept) => !concept.excludeFromRoc)
    if (printableConcepts.length === 0) {
      throw new Error('Las claves seleccionadas no generan ROC oficial.')
    }

    const totalAmount = printableConcepts.reduce((sum, concept) => {
      const fallback = Number(concept.tariffs[0]?.amount ?? 0)
      const selected = amountByCode.get(concept.code)
      return sum + (selected ?? fallback)
    }, 0)

    const receipt = await prisma.$transaction(async (tx) => {
      const created = await tx.rocReceipt.create({
        data: {
          rocNumber: input.rocNumber.trim(),
          studentId: input.studentId,
          createdById: actor.id,
          totalAmount,
          status: 'EMITIDO',
          lines: {
            create: printableConcepts.map((concept) => {
              const fallback = Number(concept.tariffs[0]?.amount ?? 0)
              const amount = amountByCode.get(concept.code) ?? fallback
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
          userId: actor.id,
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
    requireAuth()
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
    requireAuth()
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

  ipcMain.handle('receipts:getNextRocNumber', async () => {
    requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'consultar siguiente ROC sugerido')
    return getNextRocNumberSuggestion()
  })

  ipcMain.handle('receipts:getConfig', async () => {
    requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'consultar configuracion de ROC')
    return getRocConfigSummary()
  })

  ipcMain.handle('receipts:updateConfig', async (_event, payload) => {
    requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'actualizar configuracion de ROC')
    const input = rocConfigSchema.parse(payload)
    await prisma.appSetting.upsert({
      where: { key: ROC_INITIAL_SETTING_KEY },
      update: { value: input.initialRocNumber.trim() },
      create: { key: ROC_INITIAL_SETTING_KEY, value: input.initialRocNumber.trim() },
    })
    return getRocConfigSummary()
  })

  ipcMain.handle('receipts:openOfficialTemplate', async (_event, payload) => {
    requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'abrir plantilla oficial de ROC')
    const input = printReceiptSchema.parse(payload)

    const student = await prisma.student.findUnique({
      where: { id: input.studentId },
      include: {
        groupAssignment: {
          include: {
            group: true
          }
        }
      },
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

    const printableConcepts = concepts.filter((concept) => !concept.excludeFromRoc)
    if (printableConcepts.length === 0) {
      throw new Error('Las claves seleccionadas no generan ROC oficial.')
    }

    const totalAmount = printableConcepts.reduce((sum, concept) => sum + Number(concept.tariffs[0]?.amount ?? 0), 0)
    const studentFields = buildRocStudentPayloadFields(student)
    const outputPath = await openOfficialRocTemplate({
      rocNumber: input.rocNumber,
      ...studentFields,
      printDate: new Date().toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
        year: '2-digit',
      }),
      totalAmount,
      amountInWords: amountToWords(totalAmount),
      lines: printableConcepts.map((concept) => ({
        code: concept.code,
        name: concept.name,
        amount: Number(concept.tariffs[0]?.amount ?? 0),
      })),
    })

    return { outputPath, mode: app.isPackaged ? 'electron-packaged' : 'electron-dev' }
  })

  ipcMain.handle('receipts:reprint', async (_event, receiptId) => {
    const actor = requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'reimprimir ROC')
    const parsedReceiptId = z.string().min(1).parse(receiptId)

    const { receipt, outputPath } = await buildOfficialTemplateFromReceipt(parsedReceiptId)

    if (receipt.status === 'ANULADO') {
      throw new Error(`El ROC ${receipt.rocNumber} esta anulado y no se puede reimprimir. Si fue un error, genera uno nuevo desde pendientes.`)
    }

    await prisma.$transaction(async (tx) => {
      await tx.rocReceipt.update({
        where: { id: parsedReceiptId },
        data: { status: 'REIMPRESO' },
      })

      await tx.auditLog.create({
        data: {
          userId: actor.id,
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

  ipcMain.handle('receipts:cancel', async (_event, payload) => {
    const actor = requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'anular ROC')
    const input = cancelReceiptSchema.parse(payload)

    const receipt = await prisma.rocReceipt.findUnique({
      where: { id: input.receiptId },
      include: {
        student: {
          include: {
            groupAssignment: {
              include: {
                group: true
              }
            }
          }
        },
        lines: {
          include: {
            concept: true,
          },
        },
      },
    })

    if (!receipt) {
      throw new Error('No se encontro el ROC que queres anular.')
    }

    if (receipt.status === 'ANULADO') {
      throw new Error(`El ROC ${receipt.rocNumber} ya estaba anulado.`)
    }

    const updatedReceipt = await prisma.$transaction(async (tx) => {
      const restored = await restorePaymentAfterReceiptCancellation(tx, receipt)

      const updated = await tx.rocReceipt.update({
        where: { id: input.receiptId },
        data: { status: 'ANULADO' },
        include: {
          student: true,
          lines: {
            include: {
              concept: true,
            },
          },
        },
      })

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          entityType: 'ROC_RECEIPT',
          entityId: input.receiptId,
          action: 'CANCEL_ROC',
          beforeJson: JSON.stringify({
            rocNumber: receipt.rocNumber,
            status: receipt.status,
          }),
          afterJson: JSON.stringify({
            rocNumber: updated.rocNumber,
            status: 'ANULADO',
            reason: input.reason.trim(),
            restoredPaymentId: restored.restoredPaymentId,
          }),
        },
      })

      return updated
    })

    return receiptSummary(updatedReceipt)
  })

  ipcMain.handle('receipts:printBatch', async (_event, payload) => {
    requireRole(['INGRESOS_PROPIOS', 'ADMIN'], 'imprimir lote mensual de ROC')
    const input = monthlyReceiptExportSchema.parse(payload)
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
      include: {
        student: {
          include: {
            groupAssignment: {
              include: {
                group: true
              }
            }
          }
        },
        lines: { include: { concept: true } },
      },
    })

    if (receipts.length === 0) {
      throw new Error('No hay ROC generados en el mes seleccionado.')
    }

    const periodLabel = formatPeriodLabel(input.year, input.month)
    const outputPath = await exportOfficialRocTemplateBatch(
      receipts.map(receiptToTemplatePayload),
      `roc-mensual-${periodLabel}`,
    )
    const openResult = await shell.openPath(outputPath)
    if (openResult) {
      throw new Error(openResult)
    }
    return {
      ok: true,
      mode: app.isPackaged ? 'electron-packaged' : 'electron-dev',
      outputPath,
      exportedCount: receipts.length,
      periodLabel,
    }
  })

  ipcMain.handle('groups:createForIntake', async (_event, payload) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'crear grupos de nuevo ingreso')
    const input = createIntakeGroupSchema.parse(payload)
    const semesterLevel = normalizeSemesterLevel(input.semesterLevel)
    return prisma.$transaction(
      input.labels.map((label) =>
        prisma.intakeGroup.upsert({
          where: { schoolCycle_semesterLevel_label_shift: { schoolCycle: input.schoolCycle.trim(), semesterLevel, label: label.trim().toUpperCase(), shift: MATUTINO_SHIFT } },
          update: { isActive: true, capacity: ASSIGNMENT_MAX_CAPACITY },
          create: { schoolCycle: input.schoolCycle.trim(), semesterLevel, label: label.trim().toUpperCase(), shift: MATUTINO_SHIFT, capacity: ASSIGNMENT_MAX_CAPACITY },
        }),
      ),
    )
  })

  ipcMain.handle('groups:listForIntake', async (_event, payload) => {
    requireAuth()
    const input = listIntakeGroupsSchema.parse(payload)
    const groups = await prisma.intakeGroup.findMany({
      where: { schoolCycle: input.schoolCycle.trim(), semesterLevel: normalizeSemesterLevel(input.semesterLevel), shift: MATUTINO_SHIFT, isActive: true },
      orderBy: { label: 'asc' },
      include: { assignments: { include: { student: true } } },
    })
    return {
      groups: groups.map((group) => ({ id: group.id, label: group.label, advisorName: group.advisorName, shift: group.shift, capacity: group.capacity })),
      stats: buildAssignmentStats(groups),
    }
  })

  ipcMain.handle('groups:updateAdvisor', async (_event, payload) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'actualizar asesor de grupo')
    const input = updateGroupAdvisorSchema.parse(payload)
    const updated = await prisma.intakeGroup.update({
      where: { id: input.groupId },
      data: { advisorName: normalizeOptional(input.advisorName ?? null) },
      select: { id: true, advisorName: true },
    })
    return { ok: true, groupId: updated.id, advisorName: updated.advisorName }
  })

  ipcMain.handle('groups:stats', async (_event, payload) => {
    requireAuth()
    const input = listIntakeGroupsSchema.parse(payload)
    const groups = await prisma.intakeGroup.findMany({
      where: { schoolCycle: input.schoolCycle.trim(), semesterLevel: normalizeSemesterLevel(input.semesterLevel), shift: MATUTINO_SHIFT, isActive: true },
      orderBy: { label: 'asc' },
      include: { assignments: { include: { student: true } } },
    })
    return buildAssignmentStats(groups)
  })

  ipcMain.handle('groups:preview', async (_event, payload) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'previsualizar asignacion de grupos')
    const input = runAssignmentSchema.parse(payload)
    const schoolCycle = input.schoolCycle.trim()
    const semesterLevel = normalizeSemesterLevel(input.semesterLevel)
    const students = await prisma.student.findMany({
      where: {
        schoolCycle,
        semesterLevel,
        status: { in: ['VALIDADO', 'LISTO_PARA_COBRO', 'COBRADO'] },
        enrollmentStatus: { not: 'NO_SHOW' },
      },
      orderBy: [{ secondaryAverage: 'desc' }, { curp: 'asc' }],
      select: { sex: true, secondaryAverage: true },
    })

    const groupCount = ASSIGNMENT_GROUP_COUNT
    const totals = {
      MUJER: 0,
      HOMBRE: 0,
      NO_ESPECIFICADO: 0,
      alto: 0,
      medio: 0,
      bajo: 0,
      total: students.length,
    }

    for (const student of students) {
      totals[sexBucket(student.sex)] += 1
      totals[avgBand(student.secondaryAverage == null ? null : Number(student.secondaryAverage))] += 1
    }

    const buckets = Array.from({ length: groupCount }, (_item, index) => ({
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
  })

  ipcMain.handle('groups:previewRoster', async (_event, payload) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'ver listado previo de grupos')
    const input = runAssignmentSchema.parse(payload)
    const schoolCycle = input.schoolCycle.trim()
    const semesterLevel = normalizeSemesterLevel(input.semesterLevel)
    const students = await prisma.student.findMany({
      where: {
        schoolCycle,
        semesterLevel,
        status: { in: ['VALIDADO', 'LISTO_PARA_COBRO', 'COBRADO'] },
        enrollmentStatus: { not: 'NO_SHOW' },
      },
      orderBy: [{ secondaryAverage: 'desc' }, { curp: 'asc' }],
      select: {
        enrollmentNumber: true,
        firstName: true,
        paternalLastName: true,
        maternalLastName: true,
        curp: true,
        sex: true,
        secondaryAverage: true,
      },
    })

    const groupCount = ASSIGNMENT_GROUP_COUNT
    const totals = {
      MUJER: 0,
      HOMBRE: 0,
      NO_ESPECIFICADO: 0,
      alto: 0,
      medio: 0,
      bajo: 0,
      total: students.length,
    }

    for (const student of students) {
      totals[sexBucket(student.sex)] += 1
      totals[avgBand(student.secondaryAverage == null ? null : Number(student.secondaryAverage))] += 1
    }

    const groups = Array.from({ length: groupCount }, (_item, index) => ({
      id: `preview-${index + 1}`,
      label: buildGroupLabel(index),
      capacity: ASSIGNMENT_MAX_CAPACITY,
    }))

    const rows: Array<{
      groupLabel: string
      enrollmentNumber: string
      fullName: string
      curp: string
      sex: string
      averageBand: 'alto' | 'medio' | 'bajo'
      secondaryAverage: number | null
    }> = []

    const plan = buildFixedAssignmentPlan(students, groups)

    for (const entry of plan) {
      rows.push({
        groupLabel: entry.group.label,
        enrollmentNumber: entry.student.enrollmentNumber,
        fullName: `${entry.student.firstName} ${entry.student.paternalLastName} ${entry.student.maternalLastName}`,
        curp: entry.student.curp,
        sex: entry.student.sex ?? 'N/E',
        averageBand: entry.band,
        secondaryAverage: entry.student.secondaryAverage == null ? null : Number(entry.student.secondaryAverage),
      })
    }

    return rows.sort((left, right) => {
      if (left.groupLabel !== right.groupLabel) return left.groupLabel.localeCompare(right.groupLabel)
      return left.fullName.localeCompare(right.fullName)
    })
  })

  ipcMain.handle('groups:autoAssign', async (_event, payload) => {
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'asignar grupos automaticamente')
    const input = runAssignmentSchema.parse(payload)
    const schoolCycle = input.schoolCycle.trim()
    const semesterLevel = normalizeSemesterLevel(input.semesterLevel)
    const students = await prisma.student.findMany({
      where: {
        schoolCycle,
        semesterLevel,
        status: { in: ['VALIDADO', 'LISTO_PARA_COBRO', 'COBRADO'] },
        enrollmentStatus: { not: 'NO_SHOW' },
      },
      include: { groupAssignment: true },
      orderBy: [{ secondaryAverage: 'desc' }, { curp: 'asc' }],
    })
    const labels = Array.from({ length: ASSIGNMENT_GROUP_COUNT }, (_item, index) => buildGroupLabel(index))
    await prisma.$transaction(labels.map((label) => prisma.intakeGroup.upsert({ where: { schoolCycle_semesterLevel_label_shift: { schoolCycle, semesterLevel, label, shift: MATUTINO_SHIFT } }, update: { isActive: true, capacity: ASSIGNMENT_MAX_CAPACITY }, create: { schoolCycle, semesterLevel, label, shift: MATUTINO_SHIFT, capacity: ASSIGNMENT_MAX_CAPACITY } })))
    const groups = await prisma.intakeGroup.findMany({ where: { schoolCycle, semesterLevel, shift: MATUTINO_SHIFT, isActive: true }, orderBy: { label: 'asc' } })
    const totals = {
      MUJER: 0,
      HOMBRE: 0,
      NO_ESPECIFICADO: 0,
      alto: 0,
      medio: 0,
      bajo: 0,
      total: students.length,
    }

    for (const student of students) {
      totals[sexBucket(student.sex)] += 1
      totals[avgBand(student.secondaryAverage == null ? null : Number(student.secondaryAverage))] += 1
    }

    const plannedAssignments = buildFixedAssignmentPlan(students, groups)
    const plannedGroupByStudentId = new Map(plannedAssignments.map((entry) => [entry.student.id, entry.group]))

    await prisma.$transaction(async (tx) => {
      for (const student of students) {
        const target = plannedGroupByStudentId.get(student.id)
        if (!target) throw new Error('No hay cupo disponible para continuar la asignacion.')
        const existing = student.groupAssignment
        const assignment = existing
          ? await tx.studentGroupAssignment.update({ where: { id: existing.id }, data: { groupId: target.id, status: 'ASIGNADO', updatedById: actor.id, reason: 'AUTO_ASIGNACION' } })
          : await tx.studentGroupAssignment.create({ data: { studentId: student.id, groupId: target.id, status: 'ASIGNADO', assignedById: actor.id, updatedById: actor.id, reason: 'AUTO_ASIGNACION' } })
        await tx.student.update({ where: { id: student.id }, data: { enrollmentStatus: 'ASIGNADO' } })
        await tx.groupAssignmentAudit.create({ data: { assignmentId: assignment.id, studentId: student.id, beforeGroupId: existing?.groupId ?? null, afterGroupId: target.id, beforeGroupLabel: null, afterGroupLabel: target.label, actorId: actor.id, actorRole: actor.role, reason: 'AUTO_ASIGNACION' } })
      }
    })
    return { ok: true, assignedCount: students.length, groupCount: groups.length }
  })

  ipcMain.handle('groups:confirmAssignment', async (_event, payload) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'confirmar asignacion de grupos')
    const input = confirmAssignmentSchema.parse(payload)
    const semesterLevel = normalizeSemesterLevel(input.semesterLevel)
    const count = await prisma.studentGroupAssignment.updateMany({ where: { student: { schoolCycle: input.schoolCycle.trim(), semesterLevel }, status: 'ASIGNADO' }, data: { status: 'CONFIRMADO', confirmedAt: new Date() } })
    await prisma.student.updateMany({ where: { schoolCycle: input.schoolCycle.trim(), semesterLevel, enrollmentStatus: 'ASIGNADO' }, data: { enrollmentStatus: 'CONFIRMADO' } })
    return { ok: true, confirmed: count.count }
  })

  ipcMain.handle('groups:listAssignedRoster', async (_event, payload) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'consultar listado de grupos asignados')
    const input = groupAssignedRosterSchema.parse(payload)
    const rows = await prisma.studentGroupAssignment.findMany({
      where: {
        status: { in: ['ASIGNADO', 'CONFIRMADO'] },
        student: { schoolCycle: input.schoolCycle.trim(), semesterLevel: normalizeSemesterLevel(input.semesterLevel) },
      },
      include: {
        student: true,
        group: true,
      },
      orderBy: [{ group: { label: 'asc' } }, { student: { paternalLastName: 'asc' } }],
    })

    return rows.map(assignedRosterRow)
  })

  ipcMain.handle('groups:importAssignedRoster', async (_event, payload) => {
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'importar grupos desde Excel')
    const input = importAssignedRosterSchema.parse(payload)
    const dedupedRows = new Map<string, ImportedGroupRow>()
    const issues: string[] = []
    for (const row of input.rows) {
      const key = row.curp ? `curp:${row.curp}` : `folio:${row.enrollmentNumber}`
      const existing = dedupedRows.get(key)
      if (existing) {
        issues.push(`Fila ${row.rowNumber} en ${row.sheetName}: se repite el alumno ${row.curp ?? row.enrollmentNumber}; se conserva la ultima asignacion.`)
      }
      dedupedRows.set(key, row)
    }

    const rows = Array.from(dedupedRows.values()).map((row) => ({
      ...row,
      groupLabel: normalizeImportedGroupLabel(row.groupLabel),
    }))
    const schoolCycle = input.schoolCycle.trim()
    const normalizedRows = rows.map((row) => ({ ...row, semesterLevel: normalizeSemesterLevel(row.semesterLevel ?? inferSemesterLevelFromGroupLabel(row.groupLabel)) }))
    const groupKeys = Array.from(new Set(normalizedRows.map((row) => `${row.semesterLevel}:${row.groupLabel}`))).sort((left, right) => left.localeCompare(right))
    const groupFilters = groupKeys.map((key) => {
      const [semesterLevelText, label] = key.split(':')
      return { semesterLevel: normalizeSemesterLevel(Number(semesterLevelText)), label }
    })
    const existingGroups = await prisma.intakeGroup.findMany({
      where: { schoolCycle, shift: MATUTINO_SHIFT, OR: groupFilters },
      select: { label: true, semesterLevel: true },
    })
    const existingGroupKeys = new Set(existingGroups.map((group) => `${normalizeSemesterLevel(group.semesterLevel)}:${group.label}`))

    await prisma.$transaction(
      groupFilters.map(({ semesterLevel, label }) =>
        prisma.intakeGroup.upsert({
          where: { schoolCycle_semesterLevel_label_shift: { schoolCycle, semesterLevel, label, shift: MATUTINO_SHIFT } },
          update: { isActive: true, capacity: ASSIGNMENT_MAX_CAPACITY },
          create: { schoolCycle, semesterLevel, label, shift: MATUTINO_SHIFT, capacity: ASSIGNMENT_MAX_CAPACITY },
        }),
      ),
    )

    const groups = await prisma.intakeGroup.findMany({
      where: { schoolCycle, shift: MATUTINO_SHIFT, OR: groupFilters },
      select: { id: true, label: true, semesterLevel: true },
    })
    const groupByLabel = new Map(groups.map((group) => [`${normalizeSemesterLevel(group.semesterLevel)}:${group.label}`, group]))
    const students = await prisma.student.findMany({
      where: {
        schoolCycle,
      },
      include: {
        groupAssignment: {
          include: {
            group: true,
          },
        },
      },
    })

    const studentByEnrollment = new Map(students.map((student) => [student.enrollmentNumber, student]))
    const studentByCurp = new Map(students.map((student) => [student.curp.toUpperCase(), student]))
    const studentBySequence = new Map(students.map((student) => [extractEnrollmentSequenceKey(student.enrollmentNumber), student] as const).filter((entry): entry is [string, typeof students[number]] => Boolean(entry[0])))
    let importedCount = 0
    let unmatchedCount = 0

    for (const row of normalizedRows) {
      const enrollmentSequenceKey = extractEnrollmentSequenceKey(row.enrollmentNumber)
      const student =
        (row.enrollmentNumber ? studentByEnrollment.get(row.enrollmentNumber) : undefined) ??
        (row.curp ? studentByCurp.get(row.curp) : undefined) ??
        (enrollmentSequenceKey ? studentBySequence.get(enrollmentSequenceKey) : undefined)

      if (!student) {
        unmatchedCount += 1
        issues.push(`Fila ${row.rowNumber} en ${row.sheetName}: no se encontro alumno para ${row.curp ?? row.enrollmentNumber} en el ciclo ${schoolCycle}.`)
        continue
      }

      const targetGroup = groupByLabel.get(`${row.semesterLevel}:${row.groupLabel}`)
      if (!targetGroup) {
        unmatchedCount += 1
        issues.push(`Fila ${row.rowNumber} en ${row.sheetName}: el grupo ${row.groupLabel} no pudo prepararse para importar.`)
        continue
      }

      const existingAssignment = student.groupAssignment
      await prisma.$transaction(async (tx) => {
        const assignment = existingAssignment
          ? await tx.studentGroupAssignment.update({
            where: { id: existingAssignment.id },
            data: {
              groupId: targetGroup.id,
              status: 'ASIGNADO',
              updatedById: actor.id,
              reason: 'IMPORTACION_EXCEL',
            },
          })
          : await tx.studentGroupAssignment.create({
            data: {
              studentId: student.id,
              groupId: targetGroup.id,
              status: 'ASIGNADO',
              assignedById: actor.id,
              updatedById: actor.id,
              reason: 'IMPORTACION_EXCEL',
            },
          })

        await tx.student.update({
          where: { id: student.id },
          data: { enrollmentStatus: 'ASIGNADO', semesterLevel: row.semesterLevel },
        })

        await tx.groupAssignmentAudit.create({
          data: {
            assignmentId: assignment.id,
            studentId: student.id,
            beforeGroupId: existingAssignment?.groupId ?? null,
            beforeGroupLabel: existingAssignment?.group.label ?? null,
            afterGroupId: targetGroup.id,
            afterGroupLabel: targetGroup.label,
            actorId: actor.id,
            actorRole: actor.role,
            reason: 'IMPORTACION_EXCEL',
          },
        })
        await tx.studentAcademicMovement.create({
          data: {
            studentId: student.id,
            movementType: 'CAMBIO_GRUPO',
            reasonCode: 'IMPORTACION_EXCEL',
            reasonLabel: 'Importacion masiva de grupos',
            notes: input.sourcePath ?? null,
            previousSemesterLevel: student.semesterLevel,
            nextSemesterLevel: row.semesterLevel,
            previousGroupId: existingAssignment?.groupId ?? null,
            previousGroupLabel: existingAssignment?.group.label ?? null,
            nextGroupId: targetGroup.id,
            nextGroupLabel: targetGroup.label,
            previousEnrollmentStatus: student.enrollmentStatus,
            nextEnrollmentStatus: 'ASIGNADO',
            actorId: actor.id,
            actorRole: actor.role,
          },
        })
      })

      importedCount += 1
    }

    return {
      ok: true,
      canceled: false,
      sourcePath: input.sourcePath ?? null,
      importedCount,
      createdGroupCount: groupKeys.filter((key) => !existingGroupKeys.has(key)).length,
      skippedCount: 0,
      unmatchedCount,
      issues: issues.slice(0, 12),
    }
  })

  ipcMain.handle('groups:exportAssignedRoster', async (_event, payload) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'exportar listado de grupos asignados')
    const input = groupAssignedRosterSchema.parse(payload)
    const rows = await prisma.studentGroupAssignment.findMany({
      where: {
        status: { in: ['ASIGNADO', 'CONFIRMADO'] },
        student: { schoolCycle: input.schoolCycle.trim(), semesterLevel: normalizeSemesterLevel(input.semesterLevel) },
      },
      include: {
        student: true,
        group: true,
      },
      orderBy: [{ group: { label: 'asc' } }, { student: { paternalLastName: 'asc' } }],
    })

    const roster = rows.map(assignedRosterRow)
    const workbook = buildAssignedRosterWorkbook(roster)
    const outputPath = join(app.getPath('documents'), `grupos-asignados-${Date.now()}.xlsx`)
    XLSX.writeFile(workbook, outputPath)
    return { outputPath, exportedCount: roster.length }
  })

  ipcMain.handle('groups:printAssignedRoster', async (_event, payload) => {
    requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'imprimir listado de grupos asignados')
    const input = groupAssignedRosterSchema.parse(payload)
    const rows = await prisma.studentGroupAssignment.findMany({
      where: {
        status: { in: ['ASIGNADO', 'CONFIRMADO'] },
        student: { schoolCycle: input.schoolCycle.trim(), semesterLevel: normalizeSemesterLevel(input.semesterLevel) },
      },
      include: {
        student: true,
        group: true,
      },
      orderBy: [{ group: { label: 'asc' } }, { student: { paternalLastName: 'asc' } }],
    })

    return printHtmlWithFallback(assignedRosterHtml(rows.map(assignedRosterRow)), `grupos-asignados-${Date.now()}.pdf`)
  })

  ipcMain.handle('groups:manualReassign', async (_event, payload) => {
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'reasignar grupo manualmente')
    const input = manualReassignSchema.parse(payload)
    const assignment = await prisma.studentGroupAssignment.findUnique({ where: { studentId: input.studentId }, include: { group: true } })
    if (!assignment) throw new Error('El alumno no tiene grupo asignado.')
    const student = await prisma.student.findUnique({ where: { id: input.studentId } })
    if (!student) throw new Error('No se encontro el alumno.')
    const target = await prisma.intakeGroup.findUnique({ where: { id: input.toGroupId }, include: { assignments: { where: { status: { not: 'NO_SHOW' } } } } })
    if (!target) throw new Error('Grupo destino no encontrado.')
    if (target.assignments.length >= target.capacity) throw new Error(`El grupo destino ya alcanzo el cupo maximo de ${target.capacity}.`)
    const item = await prisma.studentGroupAssignment.update({ where: { id: assignment.id }, data: { groupId: target.id, status: 'ASIGNADO', updatedById: actor.id, reason: input.reason.trim() } })
    await prisma.groupAssignmentAudit.create({ data: { assignmentId: assignment.id, studentId: input.studentId, beforeGroupId: assignment.groupId, beforeGroupLabel: assignment.group.label, afterGroupId: target.id, afterGroupLabel: target.label, actorId: actor.id, actorRole: actor.role, reason: input.reason.trim() } })
    await prisma.studentAcademicMovement.create({ data: { studentId: input.studentId, movementType: 'CAMBIO_GRUPO', reasonCode: 'AJUSTE_ADMINISTRATIVO', reasonLabel: 'Ajuste administrativo', notes: input.reason.trim(), previousSemesterLevel: student.semesterLevel, nextSemesterLevel: normalizeSemesterLevel(target.semesterLevel), previousGroupId: assignment.groupId, previousGroupLabel: assignment.group.label, nextGroupId: target.id, nextGroupLabel: target.label, previousEnrollmentStatus: student.enrollmentStatus, nextEnrollmentStatus: 'ASIGNADO', actorId: actor.id, actorRole: actor.role } })
    return { ok: true, assignmentId: item.id }
  })

  ipcMain.handle('groups:markNoShow', async (_event, payload) => {
    const actor = requireRole(['CONTROL_ESCOLAR', 'ADMIN'], 'marcar no-show')
    const input = markNoShowSchema.parse(payload)
    const assignment = await prisma.studentGroupAssignment.findUnique({ where: { studentId: input.studentId } })
    if (!assignment) throw new Error('El alumno no tiene una asignacion previa.')
    const student = await prisma.student.findUnique({ where: { id: input.studentId } })
    if (!student) throw new Error('No se encontro el alumno.')
    await prisma.$transaction(async (tx) => {
      await tx.studentGroupAssignment.update({ where: { id: assignment.id }, data: { status: 'NO_SHOW', updatedById: actor.id, reason: input.reason.trim() } })
      await tx.student.update({ where: { id: input.studentId }, data: { enrollmentStatus: 'NO_SHOW' } })
      await tx.groupAssignmentAudit.create({ data: { assignmentId: assignment.id, studentId: input.studentId, beforeGroupId: assignment.groupId, afterGroupId: assignment.groupId, actorId: actor.id, actorRole: actor.role, reason: `NO_SHOW: ${input.reason.trim()}` } })
      await tx.studentAcademicMovement.create({ data: { studentId: input.studentId, movementType: 'BAJA', reasonCode: 'BAJA_ADMINISTRATIVA', reasonLabel: 'Baja administrativa', notes: input.reason.trim(), previousSemesterLevel: student.semesterLevel, nextSemesterLevel: student.semesterLevel, previousGroupId: assignment.groupId, previousGroupLabel: null, nextGroupId: null, nextGroupLabel: null, previousEnrollmentStatus: student.enrollmentStatus, nextEnrollmentStatus: 'NO_SHOW', actorId: actor.id, actorRole: actor.role } })
    })
    return { ok: true }
  })

  ipcMain.handle('audit:listRecent', async () => {
    requireAuth()
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
