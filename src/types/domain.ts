export type Metric = {
  label: string
  value: string
  note: string
}

export type StudentSummary = {
  id: string
  fullName: string
  firstName: string
  paternalLastName: string
  maternalLastName: string
  enrollmentNumber: string
  officialEnrollmentNumber: string | null
  curp: string
  rfc: string | null
  phone: string | null
  email: string | null
  address: string
  guardianFullName: string | null
  guardianPhone: string | null
  admissionPaid: boolean
  admissionPaymentStatus: string | null
  documentationStatus: string
  statusLabel: string
  groupLabel: string | null
  shiftLabel: string | null
}

export type StudentDetail = StudentFormInput & {
  id: string
  statusLabel: string
}

export type ChargeConceptSummary = {
  code: string
  groupCode: string | null
  name: string
  description: string | null
  amount: number
  periodLabel: string
  isSuggested: boolean
  excludeFromRoc: boolean
  isLifeInsurance: boolean
}

export type TariffUpdateInput = {
  code: string
  amount: number
  periodLabel: string
}

export type ConceptSuggestionUpdateInput = {
  code: string
  isSuggested: boolean
}

export type StudentFormInput = {
  enrollmentNumber: string
  curp: string
  rfc: string
  firstName: string
  paternalLastName: string
  maternalLastName: string
  birthDate: string
  age: number | null
  sex: string
  phone: string
  studentPhoneSecondary: string
  email: string
  motherTongue: string
  addressLine: string
  neighborhood: string
  locality: string
  municipality: string
  state: string
  postalCode: string
  previousSchool: string
  secondaryAverage: number | null
  examRoom: string
  schoolCycle: string
  academicStatus: string
  guardianFullName: string
  guardianRelationship: string
  guardianPhone: string
  guardianPhoneSecondary: string
  guardianEmail: string
  validateNow: boolean
}

export type RocCreateInput = {
  rocNumber: string
  studentId: string
  conceptCodes: string[]
  conceptItems?: Array<{ code: string; amount: number }>
}

export type RocReceiptSummary = {
  id: string
  rocNumber: string
  studentId: string
  studentName: string
  totalAmount: number
  issuedAt: string
  status: string
  conceptLabels: string[]
}

export type CashPaymentCreateInput = {
  studentId: string
  conceptItems: Array<{ code: string; amount: number }>
  notes?: string
}

export type CashPaymentSummary = {
  id: string
  studentId: string
  studentName: string
  enrollmentNumber: string
  totalAmount: number
  rocTotalAmount: number
  externalTotalAmount: number
  createdAt: string
  status: 'PENDIENTE_ROC' | 'ROC_GENERADO'
  conceptLabels: string[]
  externalConceptLabels: string[]
  notes: string | null
}

export type CashPaymentBatchCreateInput = {
  paymentIds: string[]
  startingRocNumber: string
}

export type CashPaymentBatchCreateResult = {
  ok: boolean
  outputPath: string
  createdCount: number
  firstRocNumber: string
  lastRocNumber: string
}

export type RocMonthlyExportInput = {
  month: number
  year: number
}

export type RocMonthlyExportResult = {
  ok: boolean
  outputPath: string
  exportedCount: number
  periodLabel: string
}

export type RocNextNumberResult = {
  suggestedRocNumber: string
  lastRocNumber: string | null
}

export type RocConfigSummary = {
  initialRocNumber: string
  lastRocNumber: string | null
  nextSuggestedRocNumber: string
}

export type RocConfigUpdateInput = {
  initialRocNumber: string
}

export type RocCancelInput = {
  receiptId: string
  reason: string
}

export type AuditLogSummary = {
  id: string
  action: string
  entityType: string
  entityId: string
  actorName: string
  createdAt: string
  detail: string
}

export type PreRegistrationStatus =
  | 'PRE_REGISTRO_ENVIADO'
  | 'EN_REVISION_CONTROL_ESCOLAR'
  | 'OBSERVADO'
  | 'RECHAZADO'
  | 'VALIDADO_PARA_PAGO'
  | 'PAGADO'

export type PreRegistrationSummary = {
  id: string
  folio: string
  fullName: string
  curp: string
  schoolCycle: string
  status: PreRegistrationStatus
  submittedAt: string
  reviewedAt: string | null
  observationNotes: string | null
}

export type SepExportResult = {
  outputPath: string
  exportedCount: number
}

export type PreRegistrationCreateInput = {
  firstName: string
  paternalLastName: string
  maternalLastName: string
  curp: string
  birthDate: string
  sex: string
  phone: string
  studentPhoneSecondary: string
  email: string
  motherTongue: string
  addressLine: string
  neighborhood: string
  locality: string
  municipality: string
  state: string
  postalCode: string
  previousSchool: string
  secondaryAverage: number | null
  examRoom: string
  schoolCycle: string
  guardianFullName: string
  guardianRelationship: string
  guardianPhone: string
  guardianPhoneSecondary: string
  guardianEmail: string
}

export type PreRegistrationStatusUpdateInput = {
  status: Extract<PreRegistrationStatus, 'EN_REVISION_CONTROL_ESCOLAR' | 'OBSERVADO' | 'RECHAZADO' | 'VALIDADO_PARA_PAGO' | 'PAGADO'>
  observationNotes?: string
  motherTongue?: string
  examRoom?: string
  studentPhoneSecondary?: string
  guardianPhoneSecondary?: string
}

export type AdmissionStatus =
  | 'PAGADO_PENDIENTE_CAPTURA'
  | 'EN_CAPTURA_CONTROL_ESCOLAR'
  | 'CAPTURADO_CONTROL_ESCOLAR'
  | 'FICHA_IMPRESA'

export type AdmissionSummary = {
  id: string
  folio: string
  curp: string
  fullName: string
  insurancePaid: boolean
  paidAt: string
  status: AdmissionStatus
  studentId: string | null
  createdAt: string
  updatedAt: string
}

export type AdmissionCreatePaymentInput = {
  folio?: string
  curp: string
  fullName: string
  insurancePaid: boolean
}

export type StudentRequirementChecklistItem = {
  requirementId: string
  code: string
  label: string
  requiredOriginals: number
  requiredCopies: number
  isDelivered: boolean
  missingJustification: string
  deadlineAt: string
  notes: string
}

export type StudentRequirementChecklist = {
  studentId: string
  studentName: string
  documentationStatus: string
  items: StudentRequirementChecklistItem[]
}

export type SaveStudentRequirementChecklistInput = {
  items: Array<{
    requirementId: string
    isDelivered: boolean
    missingJustification?: string
    deadlineAt?: string
    notes?: string
  }>
}

export type GroupAssignedRosterRow = {
  groupLabel: string
  enrollmentNumber: string
  fullName: string
  curp: string
  sex: string
  averageBand: 'alto' | 'medio' | 'bajo'
  secondaryAverage: number | null
  status: string
}

export type GroupRosterExportResult = {
  outputPath: string
  exportedCount: number
}

export type GroupRosterImportResult = {
  ok: boolean
  canceled: boolean
  sourcePath: string | null
  importedCount: number
  createdGroupCount: number
  skippedCount: number
  unmatchedCount: number
  issues: string[]
}

export type GroupRosterImportRow = {
  sheetName: string
  rowNumber: number
  groupLabel: string
  enrollmentNumber: string | null
  curp: string | null
}

export type AppRole = 'CONTROL_ESCOLAR' | 'INGRESOS_PROPIOS' | 'ADMIN'

export type DepartmentSummary = {
  id: string
  code: string
  name: string
  description: string | null
  isActive: boolean
}

export type UserSummary = {
  id: string
  username: string
  displayName: string
  role: AppRole
  departmentId: string | null
  departmentName: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type UserCreateInput = {
  username: string
  displayName: string
  role: AppRole
  departmentId?: string | null
  isActive: boolean
  password: string
}

export type UserUpdateInput = {
  displayName: string
  role: AppRole
  departmentId?: string | null
  isActive: boolean
}

export type UserResetPasswordInput = {
  password: string
}

export type AuthSession = {
  id: string
  username: string
  displayName: string
  role: AppRole
}

export type AuthLoginInput = {
  username: string
  password: string
}

export type GroupStat = {
  groupId: string
  label: string
  capacity: number
  assignedCount: number
  available: number
  bands: { alto: number; medio: number; bajo: number }
  sex: { mujer: number; hombre: number; noEspecificado: number }
}

export type GroupPreviewRow = {
  groupLabel: string
  enrollmentNumber: string
  fullName: string
  curp: string
  sex: string
  averageBand: 'alto' | 'medio' | 'bajo'
  secondaryAverage: number | null
}
