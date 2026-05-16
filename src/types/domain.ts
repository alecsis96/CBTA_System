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
  curp: string
  rfc: string | null
  phone: string | null
  email: string | null
  address: string
  statusLabel: string
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
}

export type TariffUpdateInput = {
  code: string
  amount: number
  periodLabel: string
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
  email: string
  addressLine: string
  neighborhood: string
  locality: string
  municipality: string
  state: string
  postalCode: string
  previousSchool: string
  secondaryAverage: number | null
  schoolCycle: string
  academicStatus: string
  guardianFullName: string
  guardianRelationship: string
  guardianPhone: string
  guardianEmail: string
  validateNow: boolean
}

export type RocCreateInput = {
  rocNumber: string
  studentId: string
  conceptCodes: string[]
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

export type AuditLogSummary = {
  id: string
  action: string
  entityType: string
  entityId: string
  actorName: string
  createdAt: string
  detail: string
}
