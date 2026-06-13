import type {
  AdmissionCreatePaymentInput,
  AdmissionSummary,
  AuthLoginInput,
  AuthSession,
  AuditLogSummary,
  CashPaymentBatchCreateInput,
  CashPaymentBatchCreateResult,
  CashPaymentCreateInput,
  CashPaymentSummary,
  ChargeConceptSummary,
  ConceptSuggestionUpdateInput,
  GroupAssignedRosterRow,
  GroupRosterImportRow,
  GroupRosterImportResult,
  GroupRosterExportResult,
  PreRegistrationCreateInput,
  PreRegistrationStatusUpdateInput,
  PreRegistrationSummary,
  RocCancelInput,
  RocCreateInput,
  RocNextNumberResult,
  RocMonthlyExportInput,
  RocMonthlyExportResult,
  RocReceiptSummary,
  SaveStudentRequirementChecklistInput,
  SemesterLevel,
  SepExportResult,
  StudentDailyStatusSetInput,
  StudentAcademicMovementSummary,
  StudentDetail,
  StudentFormInput,
  StudentGradeEnrollmentInput,
  StudentGroupChangeInput,
  StudentPermissionCancelInput,
  StudentPermissionCreateInput,
  StudentPermissionSummary,
  StudentRequirementChecklist,
  StudentSummary,
  StudentWithdrawalInput,
  TariffUpdateInput,
} from '@/types/domain'
import type { DepartmentSummary, UserCreateInput, UserResetPasswordInput, UserSummary, UserUpdateInput } from '@/types/admin'

type RocConfigSummary = {
  initialRocNumber: string
  lastRocNumber: string | null
  nextSuggestedRocNumber: string
}

type RocConfigUpdateInput = {
  initialRocNumber: string
}

const STUDENTS_KEY = 'cbta-browser-students'
const CONCEPTS_KEY = 'cbta-browser-concepts'
const RECEIPTS_KEY = 'cbta-browser-receipts'
const PAYMENTS_KEY = 'cbta-browser-payments'
const AUDIT_KEY = 'cbta-browser-audit'
const PRE_REGISTRATIONS_KEY = 'cbta-browser-pre-registrations'
const ADMISSIONS_KEY = 'cbta-browser-admissions'
const SESSION_KEY = 'cbta-browser-session'
const ROC_CONFIG_KEY = 'cbta-browser-roc-config'
const USERS_KEY = 'cbta-browser-users'
const DEPARTMENTS_KEY = 'cbta-browser-departments'
const STUDENT_MOVEMENTS_KEY = 'cbta-browser-student-movements'
const STUDENT_PERMISSIONS_KEY = 'cbta-browser-student-permissions'
const STUDENT_DAILY_STATUS_KEY = 'cbta-browser-student-daily-status'

const MATUTINO_SHIFT = 'MATUTINO'

type BrowserUser = UserSummary & { password: string }
type BrowserStudentDetail = StudentDetail & {
  groupLabel: string | null
  shiftLabel: string | null
}
type BrowserGroup = {
  id: string
  label: string
  shift: string
  capacity: number
  schoolCycle: string
  semesterLevel: SemesterLevel
}

type BrowserStudentPermission = StudentPermissionSummary
type BrowserDailyStatusRecord = {
  studentId: string
  date: string
  status: 'AUSENTE'
  notes: string | null
}

const seededDepartments: DepartmentSummary[] = [
  { id: 'browser-dept-control', code: 'CONTROL_ESCOLAR', name: 'Control Escolar', description: 'Captura, validacion documental e inscripcion de alumnos.', isActive: true },
  { id: 'browser-dept-ingresos', code: 'INGRESOS_PROPIOS', name: 'Ingresos Propios', description: 'Cobros, tarifas, consecutivos y emision de ROC.', isActive: true },
  { id: 'browser-dept-secretaria', code: 'SECRETARIA', name: 'Secretaria', description: 'Otorga permisos, registra incidencias diarias y da seguimiento operativo a alumnos.', isActive: true },
  { id: 'browser-dept-admin', code: 'ADMINISTRACION', name: 'Administracion General', description: 'Administracion de usuarios, catalogos y configuracion institucional.', isActive: true },
  { id: 'browser-dept-direccion', code: 'DIRECCION', name: 'Direccion', description: 'Departamento directivo preparado para crecimiento modular.', isActive: true },
]

const browserUsers: BrowserUser[] = [
  { id: 'browser-control-1', username: 'control.escolar.1', displayName: 'Control Escolar 1', role: 'CONTROL_ESCOLAR', departmentId: 'browser-dept-control', departmentName: 'Control Escolar', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), password: 'Control123!' },
  { id: 'browser-ingresos-1', username: 'ingresos.propios.1', displayName: 'Ingresos Propios 1', role: 'INGRESOS_PROPIOS', departmentId: 'browser-dept-ingresos', departmentName: 'Ingresos Propios', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), password: 'Ingresos123!' },
  { id: 'browser-secretaria-1', username: 'secretaria.1', displayName: 'Secretaria Escolar 1', role: 'SECRETARIA', departmentId: 'browser-dept-secretaria', departmentName: 'Secretaria', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), password: 'Secretaria123!' },
  { id: 'browser-admin-1', username: 'admin.1', displayName: 'Administrador General', role: 'ADMIN', departmentId: 'browser-dept-admin', departmentName: 'Administracion General', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), password: 'Admin123!' },
]

type BrowserAdmissionRecord = AdmissionSummary

type BrowserPreRegistrationRecord = PreRegistrationCreateInput & {
  id: string
  folio: string
  status: PreRegistrationSummary['status']
  submittedAt: string
  reviewedAt: string | null
  observationNotes: string | null
}

const seededConcepts: ChargeConceptSummary[] = [
  {
    groupCode: 'A000',
    code: 'A000',
    name: 'Servicios administrativos escolares',
    description: 'Agrupa los ingresos provenientes de la prestacion de servicios administrativos educativos que requieran los estudiantes y egresados del plantel.',
    amount: 0,
    periodLabel: '2026-A',
    isSuggested: false,
  },
  {
    groupCode: 'A000',
    code: 'A001',
    name: 'Acreditacion, certificacion y convalidacion de estudios',
    description: 'Ingresos provenientes de la acreditacion, certificacion y convalidacion de estudios.',
    amount: 0,
    periodLabel: '2026-A',
    isSuggested: false,
  },
  {
    groupCode: 'A000',
    code: 'A002',
    name: 'Expedicion y otorgamiento de documentos oficiales',
    description: 'Ingresos provenientes de la expedicion y otorgamiento de documentos academicos y oficiales.',
    amount: 150,
    periodLabel: '2026-A',
    isSuggested: false,
  },
  {
    groupCode: 'A000',
    code: 'A003',
    name: 'Examenes',
    description: 'Ingresos provenientes del pago de derechos por examenes extraordinarios y otros tramites de evaluacion.',
    amount: 100,
    periodLabel: '2026-A',
    isSuggested: false,
  },
  {
    groupCode: 'A000',
    code: 'A004',
    name: 'Otros',
    description: 'Conceptos de ingreso afines al grupo A que no se ubiquen especificamente en los anteriores.',
    amount: 0,
    periodLabel: '2026-A',
    isSuggested: false,
  },
  {
    groupCode: 'B000',
    code: 'B000',
    name: 'Aportaciones y cuotas de cooperacion voluntaria',
    description: 'Agrupa los ingresos provenientes de estudiantes y particulares que apoyan la labor educativa.',
    amount: 0,
    periodLabel: '2026-A',
    isSuggested: false,
  },
  {
    groupCode: 'B000',
    code: 'B001',
    name: 'Cuotas de cooperacion voluntaria',
    description: 'Ingresos provenientes de cooperaciones voluntarias aportadas por los alumnos.',
    amount: 0,
    periodLabel: '2026-A',
    isSuggested: false,
  },
  {
    groupCode: 'B000',
    code: 'B002',
    name: 'Aportaciones, cooperaciones y donaciones al plantel',
    description: 'Ingresos provenientes en efectivo y bienes que incrementen el patrimonio de la Secretaria.',
    amount: 372,
    periodLabel: '2026-A',
    isSuggested: false,
  },
  {
    groupCode: 'B000',
    code: 'B003',
    name: 'Beneficios',
    description: 'Ingresos provenientes de porcentajes de utilidad neta y beneficios obtenidos por actividades del plantel.',
    amount: 0,
    periodLabel: '2026-A',
    isSuggested: false,
  },
  {
    groupCode: 'B000',
    code: 'B004',
    name: 'Otros',
    description: 'Conceptos de ingreso no ubicados especificamente en los anteriores pero afines al grupo B.',
    amount: 0,
    periodLabel: '2026-A',
    isSuggested: false,
  },
  {
    groupCode: 'C000',
    code: 'C000',
    name: 'Servicios generales',
    description: 'Agrupa los ingresos provenientes de la prestacion de servicios de caracter social.',
    amount: 0,
    periodLabel: '2026-A',
    isSuggested: false,
  },
  {
    groupCode: 'C000',
    code: 'C001',
    name: 'Servicios medicos',
    description: 'Ingresos provenientes del pago de derechos al servicio medico del plantel.',
    amount: 0,
    periodLabel: '2026-A',
    isSuggested: false,
  },
  {
    groupCode: 'C000',
    code: 'C002',
    name: 'Servicios a personas',
    description: 'Ingresos provenientes de la prestacion de servicios de comedor, higiene, limpieza y otros.',
    amount: 0,
    periodLabel: '2026-A',
    isSuggested: false,
  },
  {
    groupCode: 'C000',
    code: 'C003',
    name: 'Servicios de asesoria y orientacion',
    description: 'Ingresos provenientes de la prestacion de servicios de asesoria y orientacion en distintas ramas.',
    amount: 0,
    periodLabel: '2026-A',
    isSuggested: false,
  },
].map((concept) => ({
  ...concept,
  excludeFromRoc: false,
  isLifeInsurance: false,
}))

const lifeInsuranceConcept = {
  groupCode: 'C000',
  code: 'SV001',
  name: 'Seguro de vida',
  description: 'Cargo administrativo externo que se cobra junto con la inscripcion pero no se imprime en el ROC.',
  amount: 0,
  periodLabel: '2026-A',
  isSuggested: false,
  excludeFromRoc: true,
  isLifeInsurance: true,
} satisfies ChargeConceptSummary
seededConcepts.push(lifeInsuranceConcept)

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return fallback
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function getDepartments() {
  const saved = safeParse<DepartmentSummary[]>(window.localStorage.getItem(DEPARTMENTS_KEY), [])
  if (saved.length > 0) {
    return saved
  }

  window.localStorage.setItem(DEPARTMENTS_KEY, JSON.stringify(seededDepartments))
  return seededDepartments
}

function getUsers() {
  const saved = safeParse<BrowserUser[]>(window.localStorage.getItem(USERS_KEY), [])
  if (saved.length > 0) {
    return saved
  }

  window.localStorage.setItem(USERS_KEY, JSON.stringify(browserUsers))
  return browserUsers
}

function saveUsers(users: BrowserUser[]) {
  window.localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

function toPublicUser(user: BrowserUser): UserSummary {
  const { password: _password, ...publicUser } = user
  return publicUser
}

function resolveDepartment(departmentId: string | null | undefined) {
  if (!departmentId) return null
  const department = getDepartments().find((item) => item.id === departmentId && item.isActive)
  if (!department) {
    throw new Error('Selecciona un departamento activo.')
  }
  return department
}

function assertCanChangeBrowserAdmin(userId: string, role: UserSummary['role'], isActive: boolean) {
  const users = getUsers()
  const current = users.find((item) => item.id === userId)
  if (!current) throw new Error('Usuario no encontrado.')
  const removesActiveAdmin = current.role === 'ADMIN' && current.isActive && (role !== 'ADMIN' || !isActive)
  if (!removesActiveAdmin) return
  const activeAdminCount = users.filter((item) => item.role === 'ADMIN' && item.isActive).length
  if (activeAdminCount <= 1) {
    throw new Error('Debe quedar al menos un administrador activo.')
  }
}

function getStudents() {
  return safeParse<BrowserStudentDetail[]>(window.localStorage.getItem(STUDENTS_KEY), [])
}

function saveStudents(students: BrowserStudentDetail[]) {
  window.localStorage.setItem(STUDENTS_KEY, JSON.stringify(students))
}

function getStudentMovements() {
  return safeParse<StudentAcademicMovementSummary[]>(window.localStorage.getItem(STUDENT_MOVEMENTS_KEY), [])
}

function saveStudentMovements(items: StudentAcademicMovementSummary[]) {
  window.localStorage.setItem(STUDENT_MOVEMENTS_KEY, JSON.stringify(items))
}

function getStudentPermissions() {
  return safeParse<BrowserStudentPermission[]>(window.localStorage.getItem(STUDENT_PERMISSIONS_KEY), [])
}

function saveStudentPermissions(items: BrowserStudentPermission[]) {
  window.localStorage.setItem(STUDENT_PERMISSIONS_KEY, JSON.stringify(items))
}

function getDailyStatusOverrides() {
  return safeParse<BrowserDailyStatusRecord[]>(window.localStorage.getItem(STUDENT_DAILY_STATUS_KEY), [])
}

function saveDailyStatusOverrides(items: BrowserDailyStatusRecord[]) {
  window.localStorage.setItem(STUDENT_DAILY_STATUS_KEY, JSON.stringify(items))
}

function getConcepts() {
  const saved = safeParse<ChargeConceptSummary[]>(window.localStorage.getItem(CONCEPTS_KEY), [])
  if (saved.length > 0 && saved.every((concept) => 'groupCode' in concept && 'description' in concept && 'isSuggested' in concept)) {
    return saved.map((concept) => ({
      ...concept,
      excludeFromRoc: concept.excludeFromRoc ?? false,
      isLifeInsurance: concept.isLifeInsurance ?? false,
    }))
  }

  window.localStorage.setItem(CONCEPTS_KEY, JSON.stringify(seededConcepts))
  return seededConcepts
}

function getReceipts() {
  return safeParse<RocReceiptSummary[]>(window.localStorage.getItem(RECEIPTS_KEY), [])
}

function getPayments() {
  return safeParse<CashPaymentSummary[]>(window.localStorage.getItem(PAYMENTS_KEY), [])
}

function savePayments(payments: CashPaymentSummary[]) {
  window.localStorage.setItem(PAYMENTS_KEY, JSON.stringify(payments))
}

function saveReceipts(receipts: RocReceiptSummary[]) {
  window.localStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts))
}

function buildSuggestedRocNumber(receipts: RocReceiptSummary[]): RocNextNumberResult {
  const sorted = [...receipts].sort((a, b) => a.rocNumber.localeCompare(b.rocNumber, undefined, { numeric: true, sensitivity: 'base' }))
  const last = sorted.length > 0 ? sorted[sorted.length - 1].rocNumber : null
  if (!last) {
    return { suggestedRocNumber: 'DGETAYCM-ROC-0001', lastRocNumber: null }
  }

  const match = last.match(/^(.*?)(\d+)$/)
  if (!match) {
    return { suggestedRocNumber: `${last}-1`, lastRocNumber: last }
  }

  const prefix = match[1]
  const digits = match[2]
  const next = String(Number(digits) + 1).padStart(digits.length, '0')
  return { suggestedRocNumber: `${prefix}${next}`, lastRocNumber: last }
}

function getRocConfig(): RocConfigSummary {
  const stored = safeParse<{ initialRocNumber?: string }>(window.localStorage.getItem(ROC_CONFIG_KEY), {})
  const initialRocNumber = stored.initialRocNumber?.trim() || 'DGETAYCM-ROC-0001'
  const next = buildSuggestedRocNumber(getReceipts())
  return {
    initialRocNumber,
    lastRocNumber: next.lastRocNumber,
    nextSuggestedRocNumber: next.lastRocNumber ? next.suggestedRocNumber : initialRocNumber,
  }
}

function saveRocConfig(input: RocConfigUpdateInput): RocConfigSummary {
  const payload = { initialRocNumber: input.initialRocNumber.trim() || 'DGETAYCM-ROC-0001' }
  window.localStorage.setItem(ROC_CONFIG_KEY, JSON.stringify(payload))
  return getRocConfig()
}

function getAuditLogs() {
  return safeParse<AuditLogSummary[]>(window.localStorage.getItem(AUDIT_KEY), [])
}

function saveAuditLogs(logs: AuditLogSummary[]) {
  window.localStorage.setItem(AUDIT_KEY, JSON.stringify(logs))
}

function pushAuditLog(log: AuditLogSummary) {
  const logs = getAuditLogs()
  logs.unshift(log)
  saveAuditLogs(logs.slice(0, 12))
}

function getPreRegistrations() {
  return safeParse<BrowserPreRegistrationRecord[]>(window.localStorage.getItem(PRE_REGISTRATIONS_KEY), [])
}

function savePreRegistrations(items: BrowserPreRegistrationRecord[]) {
  window.localStorage.setItem(PRE_REGISTRATIONS_KEY, JSON.stringify(items))
}

function getAdmissions() {
  return safeParse<BrowserAdmissionRecord[]>(window.localStorage.getItem(ADMISSIONS_KEY), [])
}

function saveAdmissions(items: BrowserAdmissionRecord[]) {
  window.localStorage.setItem(ADMISSIONS_KEY, JSON.stringify(items))
}

function getSession() {
  return safeParse<AuthSession | null>(window.localStorage.getItem(SESSION_KEY), null)
}

function saveSession(session: AuthSession | null) {
  if (!session) {
    window.localStorage.removeItem(SESSION_KEY)
    return
  }

  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

function isoDay(value?: string | Date) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }

  const base = value ? new Date(value) : new Date()
  return new Date(base.getFullYear(), base.getMonth(), base.getDate()).toISOString().slice(0, 10)
}

function toPreRegistrationSummary(item: BrowserPreRegistrationRecord): PreRegistrationSummary {
  return {
    id: item.id,
    folio: item.folio,
    fullName: `${item.firstName} ${item.paternalLastName} ${item.maternalLastName}`.trim(),
    curp: item.curp,
    schoolCycle: item.schoolCycle,
    status: item.status,
    submittedAt: item.submittedAt,
    reviewedAt: item.reviewedAt,
    observationNotes: item.observationNotes,
  }
}

function buildStudentDetail(input: StudentFormInput, id: string = crypto.randomUUID()): BrowserStudentDetail {
  return {
    id,
    firstName: input.firstName,
    paternalLastName: input.paternalLastName,
    maternalLastName: input.maternalLastName,
    enrollmentNumber: input.enrollmentNumber,
    curp: input.curp,
    rfc: input.rfc,
    birthDate: input.birthDate,
    age: input.age,
    sex: input.sex,
    phone: input.phone,
    studentPhoneSecondary: input.studentPhoneSecondary,
    email: input.email,
    motherTongue: input.motherTongue,
    addressLine: input.addressLine,
    neighborhood: input.neighborhood,
    locality: input.locality,
    municipality: input.municipality,
    state: input.state,
    postalCode: input.postalCode,
    previousSchool: input.previousSchool,
    secondaryAverage: input.secondaryAverage,
    examRoom: input.examRoom,
    schoolCycle: input.schoolCycle,
    semesterLevel: input.semesterLevel,
    academicStatus: input.academicStatus,
    guardianFullName: input.guardianFullName,
    guardianRelationship: input.guardianRelationship,
    guardianPhone: input.guardianPhone,
    guardianPhoneSecondary: input.guardianPhoneSecondary,
    guardianEmail: input.guardianEmail,
    validateNow: input.validateNow,
    documentationStatus: 'PENDIENTE',
    enrollmentStatus: input.validateNow ? 'LISTO_PARA_COBRO' : 'CAPTURADO',
    statusLabel: input.validateNow ? 'LISTO_PARA_COBRO' : 'CAPTURADO',
    groupLabel: null,
    shiftLabel: null,
  }
}

function toStudentSummary(student: BrowserStudentDetail): StudentSummary {
  const fullName = `${student.firstName} ${student.paternalLastName} ${student.maternalLastName}`.trim()
  const address = [student.addressLine, student.neighborhood, student.locality, student.municipality, student.state]
    .filter(Boolean)
    .join(', ')
  const today = isoDay()
  const activePermission = getStudentPermissions().find((permission) =>
    permission.studentId === student.id &&
    permission.status !== 'CANCELADO' &&
    permission.startsAt.slice(0, 10) <= today &&
    permission.endsAt.slice(0, 10) >= today,
  )
  const dailyOverride = getDailyStatusOverrides().find((item) => item.studentId === student.id && item.date === today)
  const dailyStatus = activePermission ? 'PERMISO' : dailyOverride?.status === 'AUSENTE' ? 'AUSENTE' : 'PRESENTE'
  const dailyStatusLabel = dailyStatus === 'PERMISO' ? 'Permiso' : dailyStatus === 'AUSENTE' ? 'Ausente' : 'Presente'

  return {
    id: student.id,
    firstName: student.firstName,
    paternalLastName: student.paternalLastName,
    maternalLastName: student.maternalLastName,
    enrollmentNumber: student.enrollmentNumber,
    officialEnrollmentNumber: null,
    curp: student.curp,
    rfc: student.rfc || null,
    phone: student.phone || null,
    email: student.email || null,
    fullName,
    address,
    guardianFullName: student.guardianFullName || null,
    guardianPhone: student.guardianPhone || null,
    admissionPaid: true,
    admissionPaymentStatus: 'PAGADO_PENDIENTE_CAPTURA',
    schoolCycle: student.schoolCycle,
    semesterLevel: student.semesterLevel,
    academicStatus: student.academicStatus || null,
    documentationStatus: student.documentationStatus,
    enrollmentStatus: student.enrollmentStatus,
    statusLabel: student.statusLabel,
    groupLabel: student.groupLabel,
    shiftLabel: student.shiftLabel,
    dailyStatus,
    dailyStatusLabel,
    activePermissionSummary: activePermission?.reason ?? null,
  }
}

function toSemesterLevel(value: number | string | null | undefined): SemesterLevel {
  if (Number(value) === 3) return 3
  if (Number(value) === 5) return 5
  return 1
}

function getBrowserGroups(schoolCycle: string, semesterLevel: SemesterLevel): BrowserGroup[] {
  const labels = new Set(
    getStudents()
      .filter((student) => student.schoolCycle === schoolCycle && toSemesterLevel(student.semesterLevel) === semesterLevel)
      .map((student) => student.groupLabel)
      .filter((label): label is string => Boolean(label)),
  )

  return Array.from(labels)
    .sort((a, b) => a.localeCompare(b))
    .map((label) => ({
      id: `${schoolCycle}-${semesterLevel}-${label}`,
      label,
      shift: MATUTINO_SHIFT,
      capacity: 40,
      schoolCycle,
      semesterLevel,
    }))
}

export const browserFallbackApi = {
  appName: 'CBTA 44 Sistema (Browser Mode)',
  auth: {
    async login(input: AuthLoginInput) {
      const username = input.username.trim().toLowerCase()
      const user = getUsers().find((item) => item.username === username && item.password === input.password && item.isActive)
      if (!user) {
        throw new Error('Credenciales invalidas.')
      }

      const session: AuthSession = {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      }
      saveSession(session)
      return session
    },
    async logout() {
      saveSession(null)
      return { ok: true }
    },
    async session() {
      return getSession()
    },
  },
  admin: {
    async listDepartments() {
      return getDepartments()
    },
    async listUsers() {
      return getUsers().map(toPublicUser)
    },
    async createUser(input: UserCreateInput) {
      const users = getUsers()
      const username = input.username.trim().toLowerCase()
      if (users.some((item) => item.username === username)) {
        throw new Error('El nombre de usuario ya existe.')
      }

      const department = resolveDepartment(input.departmentId ?? null)
      const now = new Date().toISOString()
      const user: BrowserUser = {
        id: crypto.randomUUID(),
        username,
        displayName: input.displayName.trim(),
        role: input.role,
        departmentId: department?.id ?? null,
        departmentName: department?.name ?? null,
        isActive: input.isActive,
        createdAt: now,
        updatedAt: now,
        password: input.password,
      }
      saveUsers([user, ...users])
      return toPublicUser(user)
    },
    async updateUser(userId: string, input: UserUpdateInput) {
      assertCanChangeBrowserAdmin(userId, input.role, input.isActive)
      const department = resolveDepartment(input.departmentId ?? null)
      const users = getUsers()
      const updatedUsers = users.map((item) => item.id === userId
        ? {
            ...item,
            displayName: input.displayName.trim(),
            role: input.role,
            departmentId: department?.id ?? null,
            departmentName: department?.name ?? null,
            isActive: input.isActive,
            updatedAt: new Date().toISOString(),
          }
        : item)
      saveUsers(updatedUsers)
      const updated = updatedUsers.find((item) => item.id === userId)
      if (!updated) throw new Error('Usuario no encontrado.')
      return toPublicUser(updated)
    },
    async resetUserPassword(userId: string, input: UserResetPasswordInput) {
      const users = getUsers()
      const updatedUsers = users.map((item) => item.id === userId
        ? { ...item, password: input.password, updatedAt: new Date().toISOString() }
        : item)
      saveUsers(updatedUsers)
      const updated = updatedUsers.find((item) => item.id === userId)
      if (!updated) throw new Error('Usuario no encontrado.')
      return toPublicUser(updated)
    },
  },
  students: {
    async list(filters?: {
      schoolCycle?: string
      semesterLevel?: SemesterLevel | 'all'
      enrollmentStatus?: string
      documentationStatus?: string
      query?: string
    }) {
      const normalizedQuery = filters?.query?.trim().toLowerCase() ?? ''
      return getStudents()
        .filter((student) => {
          if (filters?.schoolCycle?.trim() && student.schoolCycle !== filters.schoolCycle.trim()) return false
          if (filters?.semesterLevel && filters.semesterLevel !== 'all' && toSemesterLevel(student.semesterLevel) !== filters.semesterLevel) return false
          if (filters?.enrollmentStatus?.trim() && student.enrollmentStatus !== filters.enrollmentStatus.trim()) return false
          if (filters?.documentationStatus?.trim() && student.documentationStatus !== filters.documentationStatus.trim()) return false
          if (!normalizedQuery) return true
          const haystack = `${student.enrollmentNumber} ${student.curp} ${student.firstName} ${student.paternalLastName} ${student.maternalLastName}`.toLowerCase()
          return haystack.includes(normalizedQuery)
        })
        .map(toStudentSummary)
    },
    async listValidated() {
      return getStudents()
        .filter((student) => ['VALIDADO', 'LISTO_PARA_COBRO', 'COBRADO'].includes(student.statusLabel))
        .map(toStudentSummary)
    },
    async get(studentId: string) {
      const student = getStudents().find((item) => item.id === studentId)
      if (!student) {
        throw new Error('Alumno no encontrado en modo navegador.')
      }

      return student
    },
    async getNextInternalFolioPreview() {
      const next = getStudents().length + 1
      return `2610701044${String(next).padStart(4, '0')}`
    },
    async getRequirementChecklist(studentId: string): Promise<StudentRequirementChecklist> {
      const student = getStudents().find((item) => item.id === studentId)
      if (!student) throw new Error('Alumno no encontrado en modo navegador.')
      return {
        studentId,
        studentName: `${student.firstName} ${student.paternalLastName} ${student.maternalLastName}`.trim(),
        documentationStatus: 'PENDIENTE',
        items: [
          { requirementId: 'browser-cert', code: 'CERT_ESTUDIOS', label: 'Certificado de estudios', requiredOriginals: 1, requiredCopies: 2, isDelivered: false, missingJustification: '', deadlineAt: '', notes: '' },
          { requirementId: 'browser-acta', code: 'ACTA_NACIMIENTO', label: 'Acta de nacimiento actualizada', requiredOriginals: 1, requiredCopies: 2, isDelivered: false, missingJustification: '', deadlineAt: '', notes: '' },
        ],
      }
    },
    async saveRequirementChecklist(studentId: string, input: SaveStudentRequirementChecklistInput): Promise<StudentRequirementChecklist> {
      return {
        studentId,
        studentName: 'Modo navegador',
        documentationStatus: input.items.every((item) => item.isDelivered) ? 'COMPLETA' : 'PENDIENTE',
        items: input.items.map((item, index) => ({ requirementId: item.requirementId, code: `REQ-${index + 1}`, label: `Requisito ${index + 1}`, requiredOriginals: 0, requiredCopies: 0, isDelivered: item.isDelivered, missingJustification: item.missingJustification ?? '', deadlineAt: item.deadlineAt ?? '', notes: item.notes ?? '' })),
      }
    },
    async create(input: StudentFormInput) {
      const students = getStudents()
      const next = buildStudentDetail(input)
      students.unshift(next)
      saveStudents(students)
      pushAuditLog({
        id: crypto.randomUUID(),
        action: 'CREATE_STUDENT',
        entityType: 'STUDENT',
        entityId: next.id,
        actorName: 'Usuario de Control Escolar',
        createdAt: new Date().toISOString(),
        detail: `${next.enrollmentNumber} - ${toStudentSummary(next).fullName}`,
      })
      return toStudentSummary(next)
    },
    async update(studentId: string, input: StudentFormInput) {
      const students = getStudents()
      const index = students.findIndex((item) => item.id === studentId)
      if (index === -1) {
        throw new Error('Alumno no encontrado en modo navegador.')
      }

      const next = buildStudentDetail(input, studentId)
      students[index] = next
      saveStudents(students)
      pushAuditLog({
        id: crypto.randomUUID(),
        action: 'UPDATE_STUDENT',
        entityType: 'STUDENT',
        entityId: next.id,
        actorName: 'Usuario de Control Escolar',
        createdAt: new Date().toISOString(),
        detail: `${next.enrollmentNumber} - ${toStudentSummary(next).fullName}`,
      })

      return toStudentSummary(next)
    },
    async changeGroup(input: StudentGroupChangeInput) {
      const students = getStudents()
      const studentIndex = students.findIndex((item) => item.id === input.studentId)
      if (studentIndex === -1) {
        throw new Error('Alumno no encontrado en modo navegador.')
      }
      const target = students[studentIndex]
      const groups = getBrowserGroups(target.schoolCycle, toSemesterLevel(target.semesterLevel))
      const destination = groups.find((group) => group.id === input.toGroupId)
      students[studentIndex] = {
        ...target,
        groupLabel: destination?.label ?? target.groupLabel,
        shiftLabel: destination?.shift ?? target.shiftLabel ?? MATUTINO_SHIFT,
        enrollmentStatus: 'ASIGNADO',
        statusLabel: 'ASIGNADO',
      }
      saveStudents(students)
      const movementId = crypto.randomUUID()
      saveStudentMovements([{
        id: movementId,
        studentId: target.id,
        studentName: `${target.firstName} ${target.paternalLastName} ${target.maternalLastName}`.trim(),
        studentEnrollmentNumber: target.enrollmentNumber,
        movementType: 'CAMBIO_GRUPO',
        reasonCode: input.reasonCode,
        reasonLabel: input.reasonCode,
        notes: input.notes ?? null,
        previousSemesterLevel: target.semesterLevel,
        nextSemesterLevel: target.semesterLevel,
        previousGroupLabel: target.groupLabel,
        nextGroupLabel: destination?.label ?? null,
        previousEnrollmentStatus: target.enrollmentStatus,
        nextEnrollmentStatus: 'ASIGNADO',
        actorName: 'Modo navegador',
        createdAt: new Date().toISOString(),
      }, ...getStudentMovements()])
      return { ok: true, assignmentId: movementId }
    },
    async withdraw(input: StudentWithdrawalInput) {
      const students = getStudents()
      const studentIndex = students.findIndex((item) => item.id === input.studentId)
      if (studentIndex === -1) {
        throw new Error('Alumno no encontrado en modo navegador.')
      }
      const target = students[studentIndex]
      students[studentIndex] = {
        ...target,
        enrollmentStatus: 'BAJA',
        statusLabel: 'BAJA',
        groupLabel: null,
        shiftLabel: null,
      }
      saveStudents(students)
      const movementId = crypto.randomUUID()
      saveStudentMovements([{
        id: movementId,
        studentId: target.id,
        studentName: `${target.firstName} ${target.paternalLastName} ${target.maternalLastName}`.trim(),
        studentEnrollmentNumber: target.enrollmentNumber,
        movementType: 'BAJA',
        reasonCode: input.reasonCode,
        reasonLabel: input.reasonCode,
        notes: input.notes ?? null,
        previousSemesterLevel: target.semesterLevel,
        nextSemesterLevel: target.semesterLevel,
        previousGroupLabel: target.groupLabel,
        nextGroupLabel: null,
        previousEnrollmentStatus: target.enrollmentStatus,
        nextEnrollmentStatus: 'BAJA',
        actorName: 'Modo navegador',
        createdAt: new Date().toISOString(),
      }, ...getStudentMovements()])
      return { ok: true, movementId }
    },
    async enrollGrade(input: StudentGradeEnrollmentInput) {
      const students = getStudents()
      const studentIndex = students.findIndex((item) => item.id === input.studentId)
      if (studentIndex === -1) {
        throw new Error('Alumno no encontrado en modo navegador.')
      }
      const target = students[studentIndex]
      students[studentIndex] = {
        ...target,
        schoolCycle: input.schoolCycle,
        semesterLevel: input.semesterLevel,
        groupLabel: input.toGroupId ?? null,
        shiftLabel: input.toGroupId ? MATUTINO_SHIFT : null,
        enrollmentStatus: input.toGroupId ? 'ASIGNADO' : 'INSCRITO',
        statusLabel: input.toGroupId ? 'ASIGNADO' : 'INSCRITO',
      }
      saveStudents(students)
      saveStudentMovements([{
        id: crypto.randomUUID(),
        studentId: target.id,
        studentName: `${target.firstName} ${target.paternalLastName} ${target.maternalLastName}`.trim(),
        studentEnrollmentNumber: target.enrollmentNumber,
        movementType: 'ALTA_GRADO',
        reasonCode: input.reasonCode,
        reasonLabel: input.reasonCode,
        notes: input.notes ?? null,
        previousSemesterLevel: target.semesterLevel,
        nextSemesterLevel: input.semesterLevel,
        previousGroupLabel: target.groupLabel,
        nextGroupLabel: input.toGroupId ?? null,
        previousEnrollmentStatus: target.enrollmentStatus,
        nextEnrollmentStatus: input.toGroupId ? 'ASIGNADO' : 'INSCRITO',
        actorName: 'Modo navegador',
        createdAt: new Date().toISOString(),
      }, ...getStudentMovements()])
      return toStudentSummary(students[studentIndex])
    },
    async listMovements(input?: { studentId?: string; schoolCycle?: string; limit?: number }) {
      return getStudentMovements()
        .filter((item) => (input?.studentId ? item.studentId === input.studentId : true))
        .slice(0, input?.limit ?? 100)
    },
  },
  permissions: {
    async list(filters?: { query?: string; status?: string; activeOn?: string }) {
      const normalizedQuery = filters?.query?.trim().toLowerCase() ?? ''
      const targetDay = isoDay(filters?.activeOn)
      return getStudentPermissions().filter((permission) => {
        if (filters?.status?.trim() && filters.status !== 'all' && permission.status !== filters.status) return false
        if (!normalizedQuery) return true
        const haystack = [
          permission.enrollmentNumber,
          permission.studentName,
          permission.reason,
          permission.notes ?? '',
        ].join(' ').toLowerCase()
        return haystack.includes(normalizedQuery) || (permission.startsAt.slice(0, 10) <= targetDay && permission.endsAt.slice(0, 10) >= targetDay)
      })
    },
    async create(input: StudentPermissionCreateInput) {
      const student = getStudents().find((item) => item.id === input.studentId)
      if (!student) {
        throw new Error('Alumno no encontrado en modo navegador.')
      }
      const session = getSession()
      const today = isoDay()
      const startsAt = new Date(input.startsAt).toISOString()
      const endsAt = new Date(input.endsAt).toISOString()
      const status =
        endsAt.slice(0, 10) < today ? 'CERRADO' : startsAt.slice(0, 10) <= today && endsAt.slice(0, 10) >= today ? 'ACTIVO' : 'PROGRAMADO'
      const permission: BrowserStudentPermission = {
        id: crypto.randomUUID(),
        studentId: input.studentId,
        studentName: `${student.firstName} ${student.paternalLastName} ${student.maternalLastName}`.trim(),
        enrollmentNumber: student.enrollmentNumber,
        groupLabel: student.groupLabel,
        dailyStatus: startsAt.slice(0, 10) <= today && endsAt.slice(0, 10) >= today ? 'PERMISO' : 'PRESENTE',
        kind: input.kind,
        reason: input.reason.trim(),
        notes: input.notes?.trim() || null,
        startsAt,
        endsAt,
        status,
        grantedByName: session?.displayName ?? 'Modo navegador',
        closedByName: null,
        activeToday: startsAt.slice(0, 10) <= today && endsAt.slice(0, 10) >= today,
      }
      saveStudentPermissions([permission, ...getStudentPermissions()])
      return permission
    },
    async cancel(input: StudentPermissionCancelInput) {
      const session = getSession()
      let updated: BrowserStudentPermission | null = null
      const next = getStudentPermissions().map((permission) => {
        if (permission.id !== input.permissionId) return permission
        updated = {
          ...permission,
          status: 'CANCELADO',
          closedByName: session?.displayName ?? 'Modo navegador',
          notes: [permission.notes, input.notes?.trim()].filter(Boolean).join(' | ') || null,
          activeToday: false,
          dailyStatus: 'PRESENTE',
        }
        return updated
      })
      saveStudentPermissions(next)
      if (!updated) {
        throw new Error('Permiso no encontrado en modo navegador.')
      }
      return updated
    },
    async setDailyStatus(input: StudentDailyStatusSetInput) {
      const students = getStudents()
      const student = students.find((item) => item.id === input.studentId)
      if (!student) {
        throw new Error('Alumno no encontrado en modo navegador.')
      }
      const date = isoDay(input.date)
      const existing = getDailyStatusOverrides().filter((item) => !(item.studentId === input.studentId && item.date === date))
      if (input.status === 'AUSENTE') {
        existing.unshift({
          studentId: input.studentId,
          date,
          status: 'AUSENTE',
          notes: input.notes?.trim() || null,
        })
      }
      saveDailyStatusOverrides(existing)
      return toStudentSummary(student)
    },
    async clearDailyStatus(input: { studentId: string; date: string }) {
      const students = getStudents()
      const student = students.find((item) => item.id === input.studentId)
      if (!student) {
        throw new Error('Alumno no encontrado en modo navegador.')
      }
      const date = isoDay(input.date)
      saveDailyStatusOverrides(getDailyStatusOverrides().filter((item) => !(item.studentId === input.studentId && item.date === date)))
      return toStudentSummary(student)
    },
  },
  preRegistrations: {
    async list() {
      return getPreRegistrations().map(toPreRegistrationSummary)
    },
    async create(input: PreRegistrationCreateInput) {
      const item: BrowserPreRegistrationRecord = {
        id: crypto.randomUUID(),
        folio: `PR-${Date.now()}`,
        ...input,
        curp: input.curp,
        status: 'PRE_REGISTRO_ENVIADO',
        submittedAt: new Date().toISOString(),
        reviewedAt: null,
        observationNotes: null,
      }
      const items = [item, ...getPreRegistrations()]
      savePreRegistrations(items)
      return toPreRegistrationSummary(item)
    },
    async updateStatus(preRegistrationId: string, input: PreRegistrationStatusUpdateInput) {
      const items = getPreRegistrations()
      const index = items.findIndex((item) => item.id === preRegistrationId)
      if (index === -1) {
        throw new Error('Pre-registro no encontrado en modo navegador.')
      }

      const next: BrowserPreRegistrationRecord = {
        ...items[index],
        status: input.status,
        reviewedAt: new Date().toISOString(),
        observationNotes: input.observationNotes?.trim() || null,
        motherTongue: input.motherTongue ?? items[index].motherTongue,
        examRoom: input.examRoom ?? items[index].examRoom,
        studentPhoneSecondary: input.studentPhoneSecondary ?? items[index].studentPhoneSecondary,
        guardianPhoneSecondary: input.guardianPhoneSecondary ?? items[index].guardianPhoneSecondary,
      }

      items[index] = next
      savePreRegistrations(items)
      return toPreRegistrationSummary(next)
    },
    async exportSep() {
      const csv = '"Nombre(s)","Apellido paterno","Apellido materno","CURP","Fecha nacimiento","Sexo","Domicilio","Municipio","Estado","Codigo postal","Tutor","Telefono tutor","Correo","Escuela procedencia","Promedio","Ciclo","Estatus"'
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `sep-export-${Date.now()}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      const result: SepExportResult = { outputPath: 'browser-download', exportedCount: 0 }
      return result
    },
  },
  concepts: {
    async listActive() {
      return getConcepts()
    },
    async updateTariff(input: TariffUpdateInput) {
      const concepts = getConcepts().map((concept) => {
        if (concept.code !== input.code) {
          return concept
        }

        return {
          ...concept,
          amount: input.amount,
          periodLabel: input.periodLabel,
        }
      })

      window.localStorage.setItem(CONCEPTS_KEY, JSON.stringify(concepts))

      const updated = concepts.find((concept) => concept.code === input.code)
      if (!updated) {
        throw new Error('No se encontro la clave para actualizar su tarifa.')
      }

      pushAuditLog({
        id: crypto.randomUUID(),
        action: 'UPDATE_TARIFF',
        entityType: 'CHARGE_CONCEPT',
        entityId: updated.code,
        actorName: 'Encargado de Ingresos Propios',
        createdAt: new Date().toISOString(),
        detail: `${updated.code} - ${updated.name} - $${updated.amount.toFixed(2)} (${updated.periodLabel})`,
      })

      return updated
    },
    async updateSuggested(input: ConceptSuggestionUpdateInput) {
      const concepts = getConcepts().map((concept) =>
        concept.code === input.code ? { ...concept, isSuggested: input.isSuggested } : concept,
      )

      window.localStorage.setItem(CONCEPTS_KEY, JSON.stringify(concepts))

      const updated = concepts.find((concept) => concept.code === input.code)
      if (!updated) {
        throw new Error('No se encontro la clave para actualizar su sugerencia.')
      }

      return updated
    },
  },
  payments: {
    async create(input: CashPaymentCreateInput) {
      const students = getStudents()
      const concepts = getConcepts()
      const student = students.find((item) => item.id === input.studentId)
      if (!student) {
        throw new Error('Alumno no encontrado en modo navegador.')
      }

      const selectedConcepts = input.conceptItems
        .map((item) => {
          const concept = concepts.find((entry) => entry.code === item.code)
          return concept ? { concept, amount: item.amount } : null
        })
        .filter((item): item is { concept: ChargeConceptSummary; amount: number } => Boolean(item))

      if (selectedConcepts.length === 0) {
        throw new Error('Selecciona al menos una clave para registrar el cobro.')
      }

      const payment: CashPaymentSummary = {
        id: crypto.randomUUID(),
        studentId: student.id,
        studentName: `${student.firstName} ${student.paternalLastName} ${student.maternalLastName}`.trim(),
        enrollmentNumber: student.enrollmentNumber,
        totalAmount: selectedConcepts.reduce((sum, item) => sum + item.amount, 0),
        rocTotalAmount: selectedConcepts.filter((item) => !item.concept.excludeFromRoc).reduce((sum, item) => sum + item.amount, 0),
        externalTotalAmount: selectedConcepts.filter((item) => item.concept.excludeFromRoc).reduce((sum, item) => sum + item.amount, 0),
        createdAt: new Date().toISOString(),
        status: 'PENDIENTE_ROC',
        conceptLabels: selectedConcepts.map((item) => `${item.concept.code} - ${item.concept.name}`),
        externalConceptLabels: selectedConcepts.filter((item) => item.concept.excludeFromRoc).map((item) => `${item.concept.code} - ${item.concept.name}`),
        notes: input.notes?.trim() || null,
      }

      const payments = getPayments()
      payments.unshift(payment)
      savePayments(payments)
      return payment
    },
    async list(filters?: { status?: 'PENDIENTE_ROC' | 'ROC_GENERADO' }) {
      const payments = getPayments()
      return filters?.status ? payments.filter((item) => item.status === filters.status) : payments
    },
    async generateBatch(input: CashPaymentBatchCreateInput): Promise<CashPaymentBatchCreateResult> {
      const receipts = getReceipts()
      const payments = getPayments()
      const selectedPayments = payments.filter((payment) => input.paymentIds.includes(payment.id) && payment.status === 'PENDIENTE_ROC')
      if (selectedPayments.length === 0) {
        throw new Error('No hay cobros pendientes seleccionados para generar el ROC masivo.')
      }

      selectedPayments.forEach((payment, index) => {
        const printableLabels = payment.conceptLabels.filter((label) => !payment.externalConceptLabels.includes(label))
        receipts.unshift({
          id: crypto.randomUUID(),
          rocNumber: `${input.startingRocNumber}-${index + 1}`,
          studentId: payment.studentId,
          studentName: payment.studentName,
          totalAmount: payment.rocTotalAmount,
          issuedAt: new Date().toISOString(),
          status: 'EMITIDO',
          conceptLabels: printableLabels,
        })
      })
      saveReceipts(receipts)

      const updated = payments.map((payment) =>
        input.paymentIds.includes(payment.id) ? { ...payment, status: 'ROC_GENERADO' as const } : payment,
      )
      savePayments(updated)

      return {
        ok: true,
        outputPath: 'browser-download',
        createdCount: selectedPayments.length,
        firstRocNumber: `${input.startingRocNumber}-1`,
        lastRocNumber: `${input.startingRocNumber}-${selectedPayments.length}`,
      }
    },
  },
  receipts: {
    async create(input: RocCreateInput) {
      const students = getStudents()
      const concepts = getConcepts()
      const student = students.find((item) => item.id === input.studentId)
      if (!student) {
        throw new Error('Alumno no encontrado en modo navegador.')
      }

      const studentSummary = toStudentSummary(student)

      const selectedConcepts = concepts.filter((concept) => input.conceptCodes.includes(concept.code))
      const printableConcepts = selectedConcepts.filter((concept) => !concept.excludeFromRoc)
      const receipt: RocReceiptSummary = {
        id: crypto.randomUUID(),
        rocNumber: input.rocNumber,
        studentId: input.studentId,
        studentName: studentSummary.fullName,
        totalAmount: printableConcepts.reduce((sum, concept) => sum + concept.amount, 0),
        issuedAt: new Date().toISOString(),
        status: 'EMITIDO',
        conceptLabels: printableConcepts.map((concept) => `${concept.code} - ${concept.name}`),
      }

      const receipts = getReceipts()
      receipts.unshift(receipt)
      saveReceipts(receipts)
      pushAuditLog({
        id: crypto.randomUUID(),
        action: 'CREATE_ROC',
        entityType: 'ROC_RECEIPT',
        entityId: receipt.id,
        actorName: 'Encargado de Ingresos Propios',
        createdAt: receipt.issuedAt,
        detail: `${receipt.rocNumber} - ${receipt.studentName}`,
      })
      return receipt
    },
    async listByStudent(studentId: string) {
      return getReceipts().filter((receipt) => receipt.studentId === studentId)
    },
    async listAll() {
      return getReceipts()
    },
    async getNextRocNumber() {
      return buildSuggestedRocNumber(getReceipts())
    },
    async getConfig() {
      return getRocConfig()
    },
    async updateConfig(input: RocConfigUpdateInput) {
      return saveRocConfig(input)
    },
    async openOfficialTemplate() {
      window.print()
      return { outputPath: 'browser-print', mode: 'browser-fallback' }
    },
    async reprint() {
      window.print()
      return { outputPath: 'browser-reprint', mode: 'browser-fallback' }
    },
    async cancel(input: RocCancelInput) {
      const receipts = getReceipts()
      const target = receipts.find((receipt) => receipt.id === input.receiptId)
      if (!target) {
        throw new Error('No se encontro el ROC que queres anular en modo navegador.')
      }

      const updatedReceipts = receipts.map((receipt) =>
        receipt.id === input.receiptId
          ? { ...receipt, status: 'ANULADO' }
          : receipt,
      )
      saveReceipts(updatedReceipts)
      pushAuditLog({
        id: crypto.randomUUID(),
        action: 'CANCEL_ROC',
        entityType: 'ROC_RECEIPT',
        entityId: input.receiptId,
        actorName: 'Administrador local',
        createdAt: new Date().toISOString(),
        detail: `${target.rocNumber} anulado. Motivo: ${input.reason}`,
      })
      return updatedReceipts.find((receipt) => receipt.id === input.receiptId) ?? target
    },
    async printBatch(input: RocMonthlyExportInput): Promise<RocMonthlyExportResult & { mode: string }> {
      const receipts = getReceipts().filter((receipt) => {
        const issuedAt = new Date(receipt.issuedAt)
        return issuedAt.getFullYear() === input.year && issuedAt.getMonth() + 1 === input.month && receipt.status !== 'ANULADO'
      })

      if (receipts.length === 0) {
        throw new Error('No hay ROC generados en el mes seleccionado.')
      }

      window.print()
      return {
        ok: true,
        mode: 'browser-fallback',
        outputPath: 'browser-monthly-print',
        exportedCount: receipts.length,
        periodLabel: `${String(input.month).padStart(2, '0')}/${input.year}`,
      }
    },
  },
  groups: {
    async createForIntake() {
      return []
    },
    async listForIntake() {
      return { groups: [], stats: [] }
    },
    async autoAssign() {
      return { ok: true, assignedCount: 0, groupCount: 0 }
    },
    async confirmAssignment() {
      return { ok: true, confirmed: 0 }
    },
    async manualReassign() {
      return { ok: true, assignmentId: 'browser' }
    },
    async markNoShow() {
      return { ok: true }
    },
    async stats() {
      return []
    },
    async previewRoster() {
      return []
    },
      async listAssignedRoster(): Promise<GroupAssignedRosterRow[]> {
        return []
      },
      async importAssignedRoster(_input: { schoolCycle: string; sourcePath?: string | null; rows: GroupRosterImportRow[] }): Promise<GroupRosterImportResult> {
        throw new Error('La importacion de grupos desde Excel solo esta disponible en la app de escritorio.')
      },
      async exportAssignedRoster(): Promise<GroupRosterExportResult> {
        return { outputPath: 'browser-download', exportedCount: 0 }
      },
    async printAssignedRoster() {
      window.print()
      return { ok: true, mode: 'browser-fallback' }
    },
  },
  audit: {
    async listRecent() {
      return getAuditLogs()
    },
  },
  admissions: {
    async list() {
      return getAdmissions()
    },
    async createPayment(input: AdmissionCreatePaymentInput) {
      const now = new Date().toISOString()
      const year = new Date().getFullYear()
      const prefix = `FIC-${year}-`
      const latest = getAdmissions().find((item) => item.folio.startsWith(prefix))
      const latestSequence = latest ? Number(latest.folio.replace(prefix, '')) : 0
      const nextFolio = `${prefix}${String((Number.isFinite(latestSequence) ? latestSequence : 0) + 1).padStart(5, '0')}`
      const folio = (input.folio ?? '').trim().length > 0 ? (input.folio ?? '').trim().toUpperCase() : nextFolio

      if (getAdmissions().some((item) => item.folio === folio)) {
        throw new Error('El folio de pago ya existe. Usa el siguiente folio consecutivo.')
      }

      const item: AdmissionSummary = {
        id: crypto.randomUUID(),
        folio,
        curp: input.curp.trim().toUpperCase(),
        fullName: input.fullName.trim(),
        insurancePaid: input.insurancePaid,
        paidAt: now,
        status: 'PAGADO_PENDIENTE_CAPTURA',
        studentId: null,
        createdAt: now,
        updatedAt: now,
      }
      const items = [item, ...getAdmissions()]
      saveAdmissions(items)
      return item
    },
    async startCapture(admissionId: string) {
      const items = getAdmissions()
      const index = items.findIndex((item) => item.id === admissionId)
      if (index === -1) {
        throw new Error('Pago no encontrado en modo navegador.')
      }
      const updated = { ...items[index], status: 'EN_CAPTURA_CONTROL_ESCOLAR', updatedAt: new Date().toISOString() } as AdmissionSummary
      items[index] = updated
      saveAdmissions(items)
      return updated
    },
    async completeCapture(admissionId: string, studentId: string) {
      const items = getAdmissions()
      const index = items.findIndex((item) => item.id === admissionId)
      if (index === -1) {
        throw new Error('Pago no encontrado en modo navegador.')
      }
      const updated = {
        ...items[index],
        status: 'CAPTURADO_CONTROL_ESCOLAR',
        studentId,
        updatedAt: new Date().toISOString(),
      } as AdmissionSummary
      items[index] = updated
      saveAdmissions(items)
      return updated
    },
    async markPrinted(admissionId: string) {
      const items = getAdmissions()
      const index = items.findIndex((item) => item.id === admissionId)
      if (index === -1) {
        throw new Error('Pago no encontrado en modo navegador.')
      }
      const updated = { ...items[index], status: 'FICHA_IMPRESA', updatedAt: new Date().toISOString() } as AdmissionSummary
      items[index] = updated
      saveAdmissions(items)
      return updated
    },
    async findByFolioOrCurp(query: string) {
      const normalized = query.trim().toUpperCase()
      return getAdmissions().find((item) => item.folio === normalized || item.curp === normalized) ?? null
    },
    async printPaymentReceipt() {
      window.print()
      return { ok: true, mode: 'browser-fallback' }
    },
    async printFicha() {
      window.print()
      return { ok: true, mode: 'browser-fallback' }
    },
  },
}
