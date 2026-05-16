import type {
  AuditLogSummary,
  ChargeConceptSummary,
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
