import { addPendingSyncOp, getDeviceId } from '@/lib/sync-queue'
import type {
  AuthSession,
  CashPaymentBatchCreateInput,
  CashPaymentBatchCreateResult,
  CashPaymentCreateInput,
  ConceptSuggestionUpdateInput,
  GroupRosterImportRow,
  RocCancelInput,
  RocNextNumberResult,
  RocMonthlyExportInput,
  RocMonthlyExportResult,
  SemesterLevel,
  StudentAcademicMovementSummary,
  StudentDetail,
  StudentFormInput,
  StudentGradeEnrollmentInput,
  StudentGroupChangeInput,
  StudentWithdrawalInput,
  TariffUpdateInput,
} from '@/types/domain'
import type { UserCreateInput, UserResetPasswordInput, UserUpdateInput } from '@/types/admin'

type AppApi = Window['cbta']

type RocConfigSummary = Awaited<ReturnType<AppApi['receipts']['getConfig']>>
type RocConfigUpdateInput = Parameters<AppApi['receipts']['updateConfig']>[0]

type ActorGetter = () => AuthSession | null

type RemoteBatchResult = CashPaymentBatchCreateResult & {
  workbookBase64?: string
  fileName?: string
}

type RemoteMonthlyBatchResult = RocMonthlyExportResult & {
  workbookBase64?: string
  fileName?: string
}

const configuredBaseUrl = import.meta.env.VITE_HYBRID_API_URL?.trim()
const configuredApiKey = import.meta.env.VITE_HYBRID_API_KEY?.trim() ?? import.meta.env.VITE_SYNC_API_KEY?.trim() ?? ''
const derivedBaseUrl = import.meta.env.VITE_SYNC_API_URL?.trim()?.replace(/\/api\/sync\/op\/?$/, '') ?? ''
const localDevHybridBaseUrl = import.meta.env.VITE_LOCAL_DEV_HYBRID_API_URL?.trim() || 'http://127.0.0.1:8787'
const remoteBaseUrl = import.meta.env.DEV
  ? localDevHybridBaseUrl
  : (configuredBaseUrl || derivedBaseUrl)
const useRemoteHybrid = import.meta.env.VITE_USE_REMOTE_HYBRID?.trim() !== 'false'

function isRemoteConfigured() {
  return useRemoteHybrid && remoteBaseUrl.length > 0 && configuredApiKey.length > 0
}

function buildHeaders(getActor: ActorGetter) {
  const actor = getActor()
  return {
    'Content-Type': 'application/json',
    'x-api-key': configuredApiKey,
    'x-device-id': getDeviceId(),
    'x-actor-username': actor?.username ?? 'desktop.local',
    'x-actor-name': actor?.displayName ?? 'Desktop local',
    'x-actor-role': actor?.role ?? 'ADMIN',
  }
}

async function remoteFetch<T>(path: string, init: RequestInit, getActor: ActorGetter): Promise<T> {
  const response = await fetch(`${remoteBaseUrl}${path}`, {
    ...init,
    headers: {
      ...buildHeaders(getActor),
      ...(init.headers ?? {}),
    },
  })

  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string } & Record<string, unknown>
  if (!response.ok || data.ok === false) {
    throw new Error(typeof data.error === 'string' ? data.error : 'No se pudo completar la operacion remota.')
  }

  return data as T
}

function canUseRemoteNow() {
  return typeof navigator !== 'undefined' && navigator.onLine && isRemoteConfigured()
}

function shouldFallbackToLocal(error: unknown) {
  if (!(error instanceof Error)) return false
  return ['not_found', 'remote_database_unreachable', 'Failed to fetch'].some((message) => error.message.includes(message))
}

async function saveBase64Workbook(localApi: AppApi, base64: string, fileName: string) {
  if (localApi.files?.saveAndOpenWorkbook) {
    await localApi.files.saveAndOpenWorkbook({ fileName, base64 })
    return
  }

  const binary = window.atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function printRemoteAssignedRoster(rows: Array<{ groupLabel: string; enrollmentNumber: string; fullName: string; curp: string; sex: string; secondaryAverage: number | null; averageBand: string; status: string }>) {
  const groups = Array.from(new Set(rows.map((row) => row.groupLabel))).sort((a, b) => a.localeCompare(b))
  const sections = groups.map((group) => {
    const items = rows
      .filter((row) => row.groupLabel === group)
      .map((row) => `<tr><td>${row.enrollmentNumber}</td><td>${row.fullName}</td><td>${row.curp}</td><td>${row.sex}</td><td>${row.secondaryAverage == null ? 'N/E' : row.secondaryAverage.toFixed(1)}</td><td>${row.averageBand.toUpperCase()}</td><td>${row.status}</td></tr>`)
      .join('')
    return `<section><h2>Grupo ${group}</h2><table><thead><tr><th>Folio interno</th><th>Alumno</th><th>CURP</th><th>Sexo</th><th>Promedio</th><th>Banda</th><th>Estatus</th></tr></thead><tbody>${items}</tbody></table></section>`
  }).join('')

  const popup = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=900')
  if (!popup) {
    throw new Error('No se pudo abrir la ventana de impresion del listado de grupos.')
  }

  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Listado de grupos asignados</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#111}h1{margin:0 0 18px}h2{margin:22px 0 10px}table{width:100%;border-collapse:collapse;margin-bottom:12px}th,td{border:1px solid #c9d6c9;padding:8px;text-align:left;font-size:12px}th{background:#eef5ee}</style></head><body><h1>Listado de grupos asignados</h1>${sections}</body></html>`)
  popup.document.close()
  popup.focus()
  popup.print()
}

function mapRemoteStudentDetail(student: Record<string, unknown>): StudentDetail {
  const guardian = (student.guardian as Record<string, unknown> | null) ?? null
  const groupAssignment = (student.groupAssignment as Record<string, unknown> | null) ?? null
  const group = (groupAssignment?.group as Record<string, unknown> | null) ?? null
  return {
    id: String(student.id ?? ''),
    enrollmentNumber: String(student.enrollmentNumber ?? ''),
    curp: String(student.curp ?? ''),
    rfc: String(student.rfc ?? ''),
    firstName: String(student.firstName ?? ''),
    paternalLastName: String(student.paternalLastName ?? ''),
    maternalLastName: String(student.maternalLastName ?? ''),
    birthDate: typeof student.birthDate === 'string' ? student.birthDate.slice(0, 10) : '',
    age: typeof student.age === 'number' ? student.age : null,
    sex: String(student.sex ?? ''),
    phone: String(student.phone ?? ''),
    studentPhoneSecondary: String(student.studentPhoneSecondary ?? ''),
    email: String(student.email ?? ''),
    motherTongue: String(student.motherTongue ?? ''),
    addressLine: String(student.addressLine ?? ''),
    neighborhood: String(student.neighborhood ?? ''),
    locality: String(student.locality ?? ''),
    municipality: String(student.municipality ?? ''),
    state: String(student.state ?? ''),
    postalCode: String(student.postalCode ?? ''),
    previousSchool: String(student.previousSchool ?? ''),
    secondaryAverage: typeof student.secondaryAverage === 'number' ? student.secondaryAverage : null,
    examRoom: String(student.examRoom ?? ''),
    schoolCycle: String(student.schoolCycle ?? ''),
    schoolPeriod: Number(student.schoolPeriod ?? 1),
    semesterLevel: Number(student.semesterLevel ?? 1) as StudentDetail['semesterLevel'],
    academicStatus: String(student.academicStatus ?? ''),
    guardianFullName: String(guardian?.fullName ?? ''),
    guardianRelationship: String(guardian?.relationship ?? ''),
    guardianPhone: String(guardian?.phone ?? ''),
    guardianPhoneSecondary: String(guardian?.secondaryPhone ?? ''),
    guardianEmail: String(guardian?.email ?? ''),
    validateNow: ['VALIDADO', 'LISTO_PARA_COBRO', 'COBRADO'].includes(String(student.status ?? '')),
    documentationStatus: String(student.documentationStatus ?? 'PENDIENTE'),
    enrollmentStatus: String(student.enrollmentStatus ?? 'INSCRITO'),
    statusLabel: String(student.enrollmentStatus ?? 'INSCRITO'),
    groupLabel: typeof student.groupLabel === 'string' ? student.groupLabel : typeof group?.label === 'string' ? group.label : null,
    groupAdvisorName: typeof student.groupAdvisorName === 'string' ? student.groupAdvisorName : typeof group?.advisorName === 'string' ? group.advisorName : null,
    shiftLabel: typeof student.shiftLabel === 'string' ? student.shiftLabel : typeof group?.shift === 'string' ? group.shift : null,
  }
}

function buildStudentListQuery(filters?: {
  schoolCycle?: string
  semesterLevel?: SemesterLevel | 'all'
  enrollmentStatus?: string
  documentationStatus?: string
  query?: string
}) {
  const params = new URLSearchParams()
  if (filters?.schoolCycle?.trim()) params.set('schoolCycle', filters.schoolCycle.trim())
  if (filters?.semesterLevel && filters.semesterLevel !== 'all') params.set('semesterLevel', String(filters.semesterLevel))
  if (filters?.enrollmentStatus?.trim()) params.set('enrollmentStatus', filters.enrollmentStatus.trim())
  if (filters?.documentationStatus?.trim()) params.set('documentationStatus', filters.documentationStatus.trim())
  if (filters?.query?.trim()) params.set('query', filters.query.trim())
  const suffix = params.toString()
  return suffix ? `?${suffix}` : ''
}

export function createHybridApi(localApi: AppApi, getActor: ActorGetter): AppApi {
  let preferLocalStudentRoster = false

  return {
    ...localApi,
    appName: localApi.appName,
    files: localApi.files,
    admin: {
      ...localApi.admin,
      listDepartments: async () => {
        if (canUseRemoteNow()) {
          try {
            const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['admin']['listDepartments']>> }>('/api/hybrid/admin/departments', { method: 'GET' }, getActor)
            return data.items
          } catch {
            return localApi.admin.listDepartments()
          }
        }
        return localApi.admin.listDepartments()
      },
      listUsers: async () => {
        if (canUseRemoteNow()) {
          try {
            const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['admin']['listUsers']>> }>('/api/hybrid/admin/users', { method: 'GET' }, getActor)
            return data.items
          } catch {
            return localApi.admin.listUsers()
          }
        }
        return localApi.admin.listUsers()
      },
      createUser: async (input: UserCreateInput) => {
        if (canUseRemoteNow()) {
          try {
            const data = await remoteFetch<{ user: Awaited<ReturnType<AppApi['admin']['createUser']>> }>('/api/hybrid/admin/users', { method: 'POST', body: JSON.stringify(input) }, getActor)
            return data.user
          } catch {
            return localApi.admin.createUser(input)
          }
        }
        return localApi.admin.createUser(input)
      },
      updateUser: async (userId: string, input: UserUpdateInput) => {
        if (canUseRemoteNow()) {
          try {
            const data = await remoteFetch<{ user: Awaited<ReturnType<AppApi['admin']['updateUser']>> }>(`/api/hybrid/admin/users/${encodeURIComponent(userId)}`, { method: 'PUT', body: JSON.stringify(input) }, getActor)
            return data.user
          } catch {
            return localApi.admin.updateUser(userId, input)
          }
        }
        return localApi.admin.updateUser(userId, input)
      },
      resetUserPassword: async (userId: string, input: UserResetPasswordInput) => {
        if (canUseRemoteNow()) {
          try {
            const data = await remoteFetch<{ user: Awaited<ReturnType<AppApi['admin']['resetUserPassword']>> }>(`/api/hybrid/admin/users/${encodeURIComponent(userId)}/reset-password`, { method: 'POST', body: JSON.stringify(input) }, getActor)
            return data.user
          } catch {
            return localApi.admin.resetUserPassword(userId, input)
          }
        }
        return localApi.admin.resetUserPassword(userId, input)
      },
    },
    students: {
      ...localApi.students,
      list: async (filters) => {
        if (preferLocalStudentRoster) {
          return localApi.students.list(filters)
        }
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['students']['list']>> }>(`/api/hybrid/students${buildStudentListQuery(filters)}`, { method: 'GET' }, getActor)
          const localItems = await localApi.students.list(filters)
          if (localItems.length > data.items.length) {
            preferLocalStudentRoster = true
            return localItems
          }
          return data.items
        }
        return localApi.students.list(filters)
      },
      listValidated: async () => {
        if (preferLocalStudentRoster) {
          return localApi.students.listValidated()
        }
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['students']['listValidated']>> }>('/api/hybrid/students?validatedOnly=true', { method: 'GET' }, getActor)
          return data.items
        }
        return localApi.students.listValidated()
      },
      get: async (studentId: string) => {
        if (canUseRemoteNow()) {
          try {
            const data = await remoteFetch<{ student: Record<string, unknown> }>('/api/hybrid/students/' + encodeURIComponent(studentId), { method: 'GET' }, getActor)
            return mapRemoteStudentDetail(data.student)
          } catch (error) {
            if (!shouldFallbackToLocal(error)) throw error
          }
        }
        return localApi.students.get(studentId)
      },
      getNextInternalFolioPreview: async () => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ nextFolio: string }>('/api/hybrid/students/next-folio-preview', { method: 'GET' }, getActor)
          return data.nextFolio
        }
        return localApi.students.getNextInternalFolioPreview()
      },
      create: async (input: StudentFormInput) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ student: Awaited<ReturnType<AppApi['students']['create']>> }>('/api/hybrid/students', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.student
        }
        const created = await localApi.students.create(input)
        addPendingSyncOp({ type: 'STUDENT_CREATE', entityId: created.id, payload: { student: input }, deviceId: getDeviceId() })
        return created
      },
      update: async (studentId: string, input: StudentFormInput) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ student: Awaited<ReturnType<AppApi['students']['update']>> }>('/api/hybrid/students/' + encodeURIComponent(studentId), { method: 'PUT', body: JSON.stringify(input) }, getActor)
          return data.student
        }
        const updated = await localApi.students.update(studentId, input)
        addPendingSyncOp({ type: 'STUDENT_UPDATE', entityId: studentId, payload: { studentId, student: input }, deviceId: getDeviceId() })
        return updated
      },
      changeGroup: async (input: StudentGroupChangeInput) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ result: Awaited<ReturnType<AppApi['students']['changeGroup']>> }>('/api/hybrid/students/change-group', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.result
        }
        return localApi.students.changeGroup(input)
      },
      withdraw: async (input: StudentWithdrawalInput) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ result: Awaited<ReturnType<AppApi['students']['withdraw']>> }>('/api/hybrid/students/withdraw', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.result
        }
        return localApi.students.withdraw(input)
      },
      enrollGrade: async (input: StudentGradeEnrollmentInput) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ student: Awaited<ReturnType<AppApi['students']['enrollGrade']>> }>('/api/hybrid/students/enroll-grade', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.student
        }
        return localApi.students.enrollGrade(input)
      },
      reinscribeForPeriod: async (input) => {
        preferLocalStudentRoster = true
        return localApi.students.reinscribeForPeriod(input)
      },
      graduatePeriod: async (input) => {
        preferLocalStudentRoster = true
        return localApi.students.graduatePeriod(input)
      },
      listMovements: async (input) => {
        if (canUseRemoteNow()) {
          const params = new URLSearchParams()
          if (input?.studentId) params.set('studentId', input.studentId)
          if (input?.schoolCycle) params.set('schoolCycle', input.schoolCycle)
          if (input?.limit) params.set('limit', String(input.limit))
          const suffix = params.toString() ? `?${params.toString()}` : ''
          const data = await remoteFetch<{ items: StudentAcademicMovementSummary[] }>(`/api/hybrid/students/movements${suffix}`, { method: 'GET' }, getActor)
          return data.items
        }
        return localApi.students.listMovements(input)
      },
      importEnrollmentRoster: async (input) => {
        const result = await localApi.students.importEnrollmentRoster(input)
        preferLocalStudentRoster = true
        return result
      },
    },
    concepts: {
      ...localApi.concepts,
      listActive: async () => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['concepts']['listActive']>> }>('/api/hybrid/concepts', { method: 'GET' }, getActor)
          return data.items
        }
        return localApi.concepts.listActive()
      },
      updateTariff: async (input: TariffUpdateInput) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ concept: Awaited<ReturnType<AppApi['concepts']['updateTariff']>> }>(`/api/hybrid/concepts/${encodeURIComponent(input.code)}/tariff`, { method: 'PATCH', body: JSON.stringify(input) }, getActor)
          return data.concept
        }
        const updated = await localApi.concepts.updateTariff(input)
        addPendingSyncOp({ type: 'CONCEPT_TARIFF_UPDATE', entityId: input.code, payload: input, deviceId: getDeviceId() })
        return updated
      },
      updateSuggested: async (input: ConceptSuggestionUpdateInput) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ concept: Awaited<ReturnType<AppApi['concepts']['updateSuggested']>> }>(`/api/hybrid/concepts/${encodeURIComponent(input.code)}/suggested`, { method: 'PATCH', body: JSON.stringify(input) }, getActor)
          return data.concept
        }
        const updated = await localApi.concepts.updateSuggested(input)
        addPendingSyncOp({ type: 'CONCEPT_SUGGESTED_UPDATE', entityId: input.code, payload: input, deviceId: getDeviceId() })
        return updated
      },
    },
    payments: {
      ...localApi.payments,
      list: async (filters) => {
        if (canUseRemoteNow()) {
          const suffix = filters?.status ? `?status=${encodeURIComponent(filters.status)}` : ''
          const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['payments']['list']>> }>(`/api/hybrid/payments${suffix}`, { method: 'GET' }, getActor)
          return data.items
        }
        return localApi.payments.list(filters)
      },
      create: async (input: CashPaymentCreateInput) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ payment: Awaited<ReturnType<AppApi['payments']['create']>> }>('/api/hybrid/payments', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.payment
        }
        const payment = await localApi.payments.create(input)
        addPendingSyncOp({ type: 'CASH_PAYMENT_CREATE', entityId: payment.id, payload: input, deviceId: getDeviceId() })
        return payment
      },
      generateBatch: async (input: CashPaymentBatchCreateInput) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ result: RemoteBatchResult }>('/api/hybrid/payments/batch', { method: 'POST', body: JSON.stringify(input) }, getActor)
          if (data.result.workbookBase64) {
            await saveBase64Workbook(localApi, data.result.workbookBase64, data.result.fileName ?? data.result.outputPath)
          }
          return data.result
        }
        return localApi.payments.generateBatch(input)
      },
    },
    receipts: {
      ...localApi.receipts,
      listByStudent: async (studentId: string) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['receipts']['listByStudent']>> }>(`/api/hybrid/receipts?studentId=${encodeURIComponent(studentId)}`, { method: 'GET' }, getActor)
          return data.items
        }
        return localApi.receipts.listByStudent(studentId)
      },
      listAll: async () => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['receipts']['listAll']>> }>('/api/hybrid/receipts', { method: 'GET' }, getActor)
          return data.items
        }
        return localApi.receipts.listAll()
      },
      getNextRocNumber: async (): Promise<RocNextNumberResult> => {
        if (canUseRemoteNow()) {
          try {
            const data = await remoteFetch<{ result: RocNextNumberResult }>('/api/hybrid/receipts/next-roc', { method: 'GET' }, getActor)
            return data.result
          } catch {
            return localApi.receipts.getNextRocNumber()
          }
        }
        return localApi.receipts.getNextRocNumber()
      },
      getConfig: async (): Promise<RocConfigSummary> => {
        if (canUseRemoteNow()) {
          try {
            const data = await remoteFetch<{ result: RocConfigSummary }>('/api/hybrid/receipts/config', { method: 'GET' }, getActor)
            return data.result
          } catch {
            return localApi.receipts.getConfig()
          }
        }
        return localApi.receipts.getConfig()
      },
      updateConfig: async (input: RocConfigUpdateInput): Promise<RocConfigSummary> => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ result: RocConfigSummary }>('/api/hybrid/receipts/config', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.result
        }
        return localApi.receipts.updateConfig(input)
      },
      create: async (input) => {
        return localApi.receipts.create(input)
      },
      openOfficialTemplate: async (input) => {
        return localApi.receipts.openOfficialTemplate(input)
      },
      reprint: async (receiptId) => {
        return localApi.receipts.reprint(receiptId)
      },
      printBatch: async (input: RocMonthlyExportInput) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ result: RemoteMonthlyBatchResult }>('/api/hybrid/receipts/monthly', { method: 'POST', body: JSON.stringify(input) }, getActor)
          if (data.result.workbookBase64) {
            await saveBase64Workbook(localApi, data.result.workbookBase64, data.result.fileName ?? data.result.outputPath)
          }
          return {
            ...data.result,
            mode: 'remote-hybrid',
          }
        }
        return localApi.receipts.printBatch(input)
      },
      cancel: async (input: RocCancelInput) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ result: Awaited<ReturnType<AppApi['receipts']['cancel']>> }>('/api/hybrid/receipts/cancel', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.result
        }
        return localApi.receipts.cancel(input)
      },
    },
    groups: {
      ...localApi.groups,
      stats: async (input) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['groups']['stats']>> }>('/api/hybrid/groups/stats', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.items
        }
        return localApi.groups.stats(input)
      },
      preview: async (input) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['groups']['preview']>> }>('/api/hybrid/groups/preview', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.items
        }
        return localApi.groups.preview(input)
      },
      previewRoster: async (input) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['groups']['previewRoster']>> }>('/api/hybrid/groups/preview-roster', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.items
        }
        return localApi.groups.previewRoster(input)
      },
      autoAssign: async (input) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ result: Awaited<ReturnType<AppApi['groups']['autoAssign']>> }>('/api/hybrid/groups/auto-assign', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.result
        }
        return localApi.groups.autoAssign(input)
      },
      confirmAssignment: async (input) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ result: Awaited<ReturnType<AppApi['groups']['confirmAssignment']>> }>('/api/hybrid/groups/confirm', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.result
        }
        return localApi.groups.confirmAssignment(input)
      },
      manualReassign: async (input) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ result: Awaited<ReturnType<AppApi['groups']['manualReassign']>> }>('/api/hybrid/groups/manual-reassign', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.result
        }
        return localApi.groups.manualReassign(input)
      },
      markNoShow: async (input) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ result: Awaited<ReturnType<AppApi['groups']['markNoShow']>> }>('/api/hybrid/groups/no-show', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.result
        }
        return localApi.groups.markNoShow(input)
      },
      listAssignedRoster: async (input) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['groups']['listAssignedRoster']>> }>('/api/hybrid/groups/list-assigned-roster', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.items
        }
        return localApi.groups.listAssignedRoster(input)
      },
      importAssignedRoster: async (input: { schoolCycle: string; sourcePath?: string | null; rows: GroupRosterImportRow[] }) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ result: Awaited<ReturnType<AppApi['groups']['importAssignedRoster']>> }>('/api/hybrid/groups/import-assigned-roster', { method: 'POST', body: JSON.stringify(input) }, getActor)
          return data.result
        }
        return localApi.groups.importAssignedRoster(input)
      },
      exportAssignedRoster: async (input) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ result: Awaited<ReturnType<AppApi['groups']['exportAssignedRoster']>> & { workbookBase64?: string; fileName?: string } }>('/api/hybrid/groups/export-assigned-roster', { method: 'POST', body: JSON.stringify(input) }, getActor)
          if (data.result.workbookBase64) {
            await saveBase64Workbook(localApi, data.result.workbookBase64, data.result.fileName ?? data.result.outputPath)
          }
          return data.result
        }
        return localApi.groups.exportAssignedRoster(input)
      },
      printAssignedRoster: async (input) => {
        if (canUseRemoteNow()) {
          const rows = await remoteFetch<{ items: Awaited<ReturnType<AppApi['groups']['listAssignedRoster']>> }>('/api/hybrid/groups/list-assigned-roster', { method: 'POST', body: JSON.stringify(input) }, getActor)
          printRemoteAssignedRoster(rows.items)
          return { ok: true, mode: 'remote-hybrid' }
        }
        return localApi.groups.printAssignedRoster(input)
      },
    },
    audit: {
      ...localApi.audit,
      listRecent: async () => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['audit']['listRecent']>> }>('/api/hybrid/audit', { method: 'GET' }, getActor)
          return data.items
        }
        return localApi.audit.listRecent()
      },
    },
  }
}

export function hybridRemoteAvailable() {
  return isRemoteConfigured()
}
