import type {
  AuditLogSummary,
  ChargeConceptSummary,
  PreRegistrationCreateInput,
  PreRegistrationStatusUpdateInput,
  PreRegistrationSummary,
  RocCreateInput,
  RocReceiptSummary,
  StudentDetail,
  StudentFormInput,
  StudentSummary,
  TariffUpdateInput,
} from '@/types/domain'

type CbtaApi = {
  appName: string
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
  }
  audit: {
    listRecent: () => Promise<AuditLogSummary[]>
  }
}

declare global {
  interface Window {
    cbta: CbtaApi
  }
}

export {}
