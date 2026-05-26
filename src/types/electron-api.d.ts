import type {
  AdmissionCreatePaymentInput,
  AuthLoginInput,
  AuthSession,
  AdmissionSummary,
  AuditLogSummary,
  ChargeConceptSummary,
  PreRegistrationCreateInput,
  PreRegistrationStatusUpdateInput,
  PreRegistrationSummary,
  RocCreateInput,
  RocReceiptSummary,
  SepExportResult,
  GroupStat,
  GroupPreviewRow,
  StudentDetail,
  StudentFormInput,
  StudentSummary,
  TariffUpdateInput,
} from '@/types/domain'

type CbtaApi = {
  appName: string
  auth: {
    login: (input: AuthLoginInput) => Promise<AuthSession>
    logout: () => Promise<{ ok: boolean }>
    session: () => Promise<AuthSession | null>
  }
  students: {
    list: () => Promise<StudentSummary[]>
    listValidated: () => Promise<StudentSummary[]>
    get: (studentId: string) => Promise<StudentDetail>
    create: (input: StudentFormInput) => Promise<StudentSummary>
    update: (studentId: string, input: StudentFormInput) => Promise<StudentSummary>
  }
  preRegistrations: {
    list: () => Promise<PreRegistrationSummary[]>
    create: (input: PreRegistrationCreateInput) => Promise<PreRegistrationSummary>
    updateStatus: (preRegistrationId: string, input: PreRegistrationStatusUpdateInput) => Promise<PreRegistrationSummary>
    exportSep: (input?: { ids?: string[]; status?: string }) => Promise<SepExportResult>
  }
  concepts: {
    listActive: () => Promise<ChargeConceptSummary[]>
    updateTariff: (input: TariffUpdateInput) => Promise<ChargeConceptSummary>
  }
  receipts: {
    create: (input: RocCreateInput) => Promise<RocReceiptSummary>
    listByStudent: (studentId: string) => Promise<RocReceiptSummary[]>
    listAll: () => Promise<RocReceiptSummary[]>
    openOfficialTemplate: (input: RocCreateInput) => Promise<{ outputPath: string; mode: string }>
    reprint: (receiptId: string) => Promise<{ outputPath: string; mode: string }>
    printBatch: () => Promise<{ ok: boolean; mode: string; outputPath?: string }>
  }
  groups: {
    createForIntake: (input: { schoolCycle: string; labels: string[] }) => Promise<Array<{ id: string; label: string }>>
    listForIntake: (input: { schoolCycle: string }) => Promise<{ groups: Array<{ id: string; label: string; shift: string; capacity: number }>; stats: GroupStat[] }>
    autoAssign: (input: { schoolCycle: string }) => Promise<{ ok: boolean; assignedCount: number; groupCount: number }>
    confirmAssignment: (input: { schoolCycle: string }) => Promise<{ ok: boolean; confirmed: number }>
    manualReassign: (input: { studentId: string; toGroupId: string; reason: string }) => Promise<{ ok: boolean; assignmentId: string }>
    markNoShow: (input: { studentId: string; reason: string }) => Promise<{ ok: boolean }>
    stats: (input: { schoolCycle: string }) => Promise<GroupStat[]>
    preview: (input: { schoolCycle: string }) => Promise<GroupStat[]>
    previewRoster: (input: { schoolCycle: string }) => Promise<GroupPreviewRow[]>
  }
  audit: {
    listRecent: () => Promise<AuditLogSummary[]>
  }
  admissions: {
    list: (filters?: { status?: string; query?: string }) => Promise<AdmissionSummary[]>
    createPayment: (input: AdmissionCreatePaymentInput) => Promise<AdmissionSummary>
    startCapture: (admissionId: string) => Promise<AdmissionSummary>
    completeCapture: (admissionId: string, studentId: string) => Promise<AdmissionSummary>
    markPrinted: (admissionId: string) => Promise<AdmissionSummary>
    findByFolioOrCurp: (query: string) => Promise<AdmissionSummary | null>
    printPaymentReceipt: (payload: AdmissionSummary) => Promise<{ ok: boolean; mode: string; outputPath?: string }>
    printFicha: (payload: AdmissionSummary) => Promise<{ ok: boolean; mode: string; outputPath?: string }>
  }
}

declare global {
  interface Window {
    cbta: CbtaApi
  }
}

export {}
