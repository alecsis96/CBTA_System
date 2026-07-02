import type {
  AdmissionCreatePaymentInput,
  AuthLoginInput,
  AuthSession,
  AdmissionSummary,
  AuditLogSummary,
  CashPaymentBatchCreateInput,
  CashPaymentBatchCreateResult,
  CashPaymentCreateInput,
  CashPaymentSummary,
  ChargeConceptSummary,
  ConceptSuggestionUpdateInput,
  GroupAssignedRosterRow,
  EnrollmentRosterImportResult,
  EnrollmentRosterImportRow,
  SemesterLevel,
  StudentAcademicMovementSummary,
  StudentGradeEnrollmentInput,
  StudentGroupChangeInput,
  StudentPeriodGraduationInput,
  StudentPeriodReinscriptionInput,
  GroupRosterImportRow,
  GroupRosterImportResult,
  GroupRosterExportResult,
  PreRegistrationCreateInput,
  PreRegistrationStatusUpdateInput,
  PreRegistrationSummary,
  RocCancelInput,
  RocCreateInput,
  RocConfigSummary,
  RocConfigUpdateInput,
  RocNextNumberResult,
  RocMonthlyExportInput,
  RocMonthlyExportResult,
  RocReceiptSummary,
  SaveStudentRequirementChecklistInput,
  SepExportResult,
  GroupStat,
  GroupPreviewRow,
  StudentDetail,
  StudentDailyStatusSetInput,
  StudentRequirementChecklist,
  StudentFormInput,
  StudentPermissionCancelInput,
  StudentPermissionCreateInput,
  StudentPermissionSummary,
  StudentSummary,
  StudentWithdrawalInput,
  TariffUpdateInput,
} from '@/types/domain'
import type { DepartmentSummary, UserCreateInput, UserResetPasswordInput, UserSummary, UserUpdateInput } from '@/types/admin'

type CbtaApi = {
  appName: string
  files?: {
    saveAndOpenWorkbook: (input: { fileName: string; base64: string }) => Promise<{ outputPath: string }>
  }
  auth: {
    login: (input: AuthLoginInput) => Promise<AuthSession>
    logout: () => Promise<{ ok: boolean }>
    session: () => Promise<AuthSession | null>
  }
  admin: {
    listDepartments: () => Promise<DepartmentSummary[]>
    listUsers: () => Promise<UserSummary[]>
    createUser: (input: UserCreateInput) => Promise<UserSummary>
    updateUser: (userId: string, input: UserUpdateInput) => Promise<UserSummary>
    resetUserPassword: (userId: string, input: UserResetPasswordInput) => Promise<UserSummary>
  }
  students: {
    list: (filters?: {
      schoolCycle?: string
      schoolPeriod?: number
      semesterLevel?: SemesterLevel | 'all'
      enrollmentStatus?: string
      documentationStatus?: string
      query?: string
    }) => Promise<StudentSummary[]>
    listValidated: () => Promise<StudentSummary[]>
    get: (studentId: string) => Promise<StudentDetail>
    getNextInternalFolioPreview: () => Promise<string>
    getRequirementChecklist: (studentId: string) => Promise<StudentRequirementChecklist>
    saveRequirementChecklist: (studentId: string, input: SaveStudentRequirementChecklistInput) => Promise<StudentRequirementChecklist>
    create: (input: StudentFormInput) => Promise<StudentSummary>
    update: (studentId: string, input: StudentFormInput) => Promise<StudentSummary>
    changeGroup: (input: StudentGroupChangeInput) => Promise<{ ok: boolean; assignmentId: string }>
    withdraw: (input: StudentWithdrawalInput) => Promise<{ ok: boolean; movementId: string }>
    enrollGrade: (input: StudentGradeEnrollmentInput) => Promise<StudentSummary>
    reinscribeForPeriod: (input: StudentPeriodReinscriptionInput) => Promise<StudentSummary>
    graduatePeriod: (input: StudentPeriodGraduationInput) => Promise<{ ok: boolean; graduatedCount: number }>
    formalizeEnrollment: (input: { studentId: string; allowPendingDocuments?: boolean; notes?: string }) => Promise<StudentSummary>
    listMovements: (input?: { studentId?: string; schoolCycle?: string; limit?: number }) => Promise<StudentAcademicMovementSummary[]>
    importEnrollmentRoster: (input: { schoolCycle: string; sourcePath?: string | null; rows: EnrollmentRosterImportRow[] }) => Promise<EnrollmentRosterImportResult>
  }
  permissions: {
    list: (filters?: { query?: string; status?: string; activeOn?: string }) => Promise<StudentPermissionSummary[]>
    create: (input: StudentPermissionCreateInput) => Promise<StudentPermissionSummary>
    cancel: (input: StudentPermissionCancelInput) => Promise<StudentPermissionSummary>
    setDailyStatus: (input: StudentDailyStatusSetInput) => Promise<StudentSummary>
    clearDailyStatus: (input: { studentId: string; date: string }) => Promise<StudentSummary>
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
    updateSuggested: (input: ConceptSuggestionUpdateInput) => Promise<ChargeConceptSummary>
  }
  payments: {
    create: (input: CashPaymentCreateInput) => Promise<CashPaymentSummary>
    list: (filters?: { status?: 'PENDIENTE_ROC' | 'ROC_GENERADO' }) => Promise<CashPaymentSummary[]>
    generateBatch: (input: CashPaymentBatchCreateInput) => Promise<CashPaymentBatchCreateResult>
  }
    receipts: {
      create: (input: RocCreateInput) => Promise<RocReceiptSummary>
      listByStudent: (studentId: string) => Promise<RocReceiptSummary[]>
      listAll: () => Promise<RocReceiptSummary[]>
      getNextRocNumber: () => Promise<RocNextNumberResult>
      getConfig: () => Promise<RocConfigSummary>
      updateConfig: (input: RocConfigUpdateInput) => Promise<RocConfigSummary>
      openOfficialTemplate: (input: RocCreateInput) => Promise<{ outputPath: string; mode: string }>
      reprint: (receiptId: string) => Promise<{ outputPath: string; mode: string }>
      cancel: (input: RocCancelInput) => Promise<RocReceiptSummary>
      printBatch: (input: RocMonthlyExportInput) => Promise<RocMonthlyExportResult & { mode: string }>
    }
  groups: {
    createForIntake: (input: { schoolCycle: string; semesterLevel?: SemesterLevel; labels: string[] }) => Promise<Array<{ id: string; label: string }>>
    listForIntake: (input: { schoolCycle: string; semesterLevel?: SemesterLevel }) => Promise<{ groups: Array<{ id: string; label: string; advisorName: string | null; shift: string; capacity: number }>; stats: GroupStat[] }>
    autoAssign: (input: { schoolCycle: string; semesterLevel?: SemesterLevel }) => Promise<{ ok: boolean; assignedCount: number; groupCount: number }>
    confirmAssignment: (input: { schoolCycle: string; semesterLevel?: SemesterLevel }) => Promise<{ ok: boolean; confirmed: number }>
    manualReassign: (input: { studentId: string; toGroupId: string; reason: string }) => Promise<{ ok: boolean; assignmentId: string }>
    markNoShow: (input: { studentId: string; reason: string }) => Promise<{ ok: boolean }>
    stats: (input: { schoolCycle: string; semesterLevel?: SemesterLevel }) => Promise<GroupStat[]>
    preview: (input: { schoolCycle: string; semesterLevel?: SemesterLevel }) => Promise<GroupStat[]>
    previewRoster: (input: { schoolCycle: string; semesterLevel?: SemesterLevel }) => Promise<GroupPreviewRow[]>
    listAssignedRoster: (input: { schoolCycle: string; semesterLevel?: SemesterLevel }) => Promise<GroupAssignedRosterRow[]>
    importAssignedRoster: (input: { schoolCycle: string; semesterLevel?: SemesterLevel; sourcePath?: string | null; rows: GroupRosterImportRow[] }) => Promise<GroupRosterImportResult>
    updateAdvisor: (input: { groupId: string; advisorName?: string | null }) => Promise<{ ok: boolean; groupId: string; advisorName: string | null }>
    exportAssignedRoster: (input: { schoolCycle: string; semesterLevel?: SemesterLevel }) => Promise<GroupRosterExportResult>
    printAssignedRoster: (input: { schoolCycle: string; semesterLevel?: SemesterLevel }) => Promise<{ ok: boolean; mode: string; outputPath?: string }>
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
