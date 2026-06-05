import { addPendingSyncOp, getDeviceId } from '@/lib/sync-queue'
import type {
  AuthSession,
  CashPaymentBatchCreateInput,
  CashPaymentBatchCreateResult,
  CashPaymentCreateInput,
  ConceptSuggestionUpdateInput,
  RocCancelInput,
  RocNextNumberResult,
  RocMonthlyExportInput,
  RocMonthlyExportResult,
  StudentDetail,
  StudentFormInput,
  TariffUpdateInput,
} from '@/types/domain'

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
const remoteBaseUrl = configuredBaseUrl || derivedBaseUrl

function isRemoteConfigured() {
  return remoteBaseUrl.length > 0 && configuredApiKey.length > 0
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

function saveBase64Workbook(base64: string, fileName: string) {
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

function mapRemoteStudentDetail(student: Record<string, unknown>): StudentDetail {
  const guardian = (student.guardian as Record<string, unknown> | null) ?? null
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
    academicStatus: String(student.academicStatus ?? ''),
    guardianFullName: String(guardian?.fullName ?? ''),
    guardianRelationship: String(guardian?.relationship ?? ''),
    guardianPhone: String(guardian?.phone ?? ''),
    guardianPhoneSecondary: String(guardian?.secondaryPhone ?? ''),
    guardianEmail: String(guardian?.email ?? ''),
    validateNow: ['VALIDADO', 'LISTO_PARA_COBRO', 'COBRADO'].includes(String(student.status ?? '')),
    statusLabel: String(student.enrollmentStatus ?? 'INSCRITO'),
  }
}

export function createHybridApi(localApi: AppApi, getActor: ActorGetter): AppApi {
  return {
    ...localApi,
    students: {
      ...localApi.students,
      list: async () => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['students']['list']>> }>('/api/hybrid/students', { method: 'GET' }, getActor)
          return data.items
        }
        return localApi.students.list()
      },
      listValidated: async () => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ items: Awaited<ReturnType<AppApi['students']['listValidated']>> }>('/api/hybrid/students?validatedOnly=true', { method: 'GET' }, getActor)
          return data.items
        }
        return localApi.students.listValidated()
      },
      get: async (studentId: string) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ student: Record<string, unknown> }>('/api/hybrid/students/' + encodeURIComponent(studentId), { method: 'GET' }, getActor)
          return mapRemoteStudentDetail(data.student)
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
            saveBase64Workbook(data.result.workbookBase64, data.result.fileName ?? data.result.outputPath)
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
      printBatch: async (input: RocMonthlyExportInput) => {
        if (canUseRemoteNow()) {
          const data = await remoteFetch<{ result: RemoteMonthlyBatchResult }>('/api/hybrid/receipts/monthly', { method: 'POST', body: JSON.stringify(input) }, getActor)
          if (data.result.workbookBase64) {
            saveBase64Workbook(data.result.workbookBase64, data.result.fileName ?? data.result.outputPath)
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
