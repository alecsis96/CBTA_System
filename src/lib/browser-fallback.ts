import type {
  AdmissionCreatePaymentInput,
  AdmissionSummary,
  AuthLoginInput,
  AuthSession,
  AuditLogSummary,
  ChargeConceptSummary,
  GroupAssignedRosterRow,
  GroupRosterExportResult,
  PreRegistrationCreateInput,
  PreRegistrationStatusUpdateInput,
  PreRegistrationSummary,
  RocCreateInput,
  RocReceiptSummary,
  SaveStudentRequirementChecklistInput,
  SepExportResult,
  StudentDetail,
  StudentFormInput,
  StudentRequirementChecklist,
  StudentSummary,
  TariffUpdateInput,
} from '@/types/domain'

const STUDENTS_KEY = 'cbta-browser-students'
const CONCEPTS_KEY = 'cbta-browser-concepts'
const RECEIPTS_KEY = 'cbta-browser-receipts'
const AUDIT_KEY = 'cbta-browser-audit'
const PRE_REGISTRATIONS_KEY = 'cbta-browser-pre-registrations'
const ADMISSIONS_KEY = 'cbta-browser-admissions'
const SESSION_KEY = 'cbta-browser-session'

const browserUsers: Array<AuthSession & { password: string }> = [
  { id: 'browser-control-1', username: 'control.escolar.1', displayName: 'Control Escolar 1', role: 'CONTROL_ESCOLAR', password: 'Control123!' },
  { id: 'browser-ingresos-1', username: 'ingresos.propios.1', displayName: 'Ingresos Propios 1', role: 'INGRESOS_PROPIOS', password: 'Ingresos123!' },
  { id: 'browser-admin-1', username: 'admin.1', displayName: 'Administrador General', role: 'ADMIN', password: 'Admin123!' },
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
  },
  {
    groupCode: 'A000',
    code: 'A001',
    name: 'Acreditacion, certificacion y convalidacion de estudios',
    description: 'Ingresos provenientes de la acreditacion, certificacion y convalidacion de estudios.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    groupCode: 'A000',
    code: 'A002',
    name: 'Expedicion y otorgamiento de documentos oficiales',
    description: 'Ingresos provenientes de la expedicion y otorgamiento de documentos academicos y oficiales.',
    amount: 150,
    periodLabel: '2026-A',
  },
  {
    groupCode: 'A000',
    code: 'A003',
    name: 'Examenes',
    description: 'Ingresos provenientes del pago de derechos por examenes extraordinarios y otros tramites de evaluacion.',
    amount: 100,
    periodLabel: '2026-A',
  },
  {
    groupCode: 'A000',
    code: 'A004',
    name: 'Otros',
    description: 'Conceptos de ingreso afines al grupo A que no se ubiquen especificamente en los anteriores.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    groupCode: 'B000',
    code: 'B000',
    name: 'Aportaciones y cuotas de cooperacion voluntaria',
    description: 'Agrupa los ingresos provenientes de estudiantes y particulares que apoyan la labor educativa.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    groupCode: 'B000',
    code: 'B001',
    name: 'Cuotas de cooperacion voluntaria',
    description: 'Ingresos provenientes de cooperaciones voluntarias aportadas por los alumnos.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    groupCode: 'B000',
    code: 'B002',
    name: 'Aportaciones, cooperaciones y donaciones al plantel',
    description: 'Ingresos provenientes en efectivo y bienes que incrementen el patrimonio de la Secretaria.',
    amount: 372,
    periodLabel: '2026-A',
  },
  {
    groupCode: 'B000',
    code: 'B003',
    name: 'Beneficios',
    description: 'Ingresos provenientes de porcentajes de utilidad neta y beneficios obtenidos por actividades del plantel.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    groupCode: 'B000',
    code: 'B004',
    name: 'Otros',
    description: 'Conceptos de ingreso no ubicados especificamente en los anteriores pero afines al grupo B.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    groupCode: 'C000',
    code: 'C000',
    name: 'Servicios generales',
    description: 'Agrupa los ingresos provenientes de la prestacion de servicios de caracter social.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    groupCode: 'C000',
    code: 'C001',
    name: 'Servicios medicos',
    description: 'Ingresos provenientes del pago de derechos al servicio medico del plantel.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    groupCode: 'C000',
    code: 'C002',
    name: 'Servicios a personas',
    description: 'Ingresos provenientes de la prestacion de servicios de comedor, higiene, limpieza y otros.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    groupCode: 'C000',
    code: 'C003',
    name: 'Servicios de asesoria y orientacion',
    description: 'Ingresos provenientes de la prestacion de servicios de asesoria y orientacion en distintas ramas.',
    amount: 0,
    periodLabel: '2026-A',
  },
]

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

function getStudents() {
  return safeParse<StudentDetail[]>(window.localStorage.getItem(STUDENTS_KEY), [])
}

function saveStudents(students: StudentDetail[]) {
  window.localStorage.setItem(STUDENTS_KEY, JSON.stringify(students))
}

function getConcepts() {
  const saved = safeParse<ChargeConceptSummary[]>(window.localStorage.getItem(CONCEPTS_KEY), [])
  if (saved.length > 0 && saved.every((concept) => 'groupCode' in concept && 'description' in concept)) {
    return saved
  }

  window.localStorage.setItem(CONCEPTS_KEY, JSON.stringify(seededConcepts))
  return seededConcepts
}

function getReceipts() {
  return safeParse<RocReceiptSummary[]>(window.localStorage.getItem(RECEIPTS_KEY), [])
}

function saveReceipts(receipts: RocReceiptSummary[]) {
  window.localStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts))
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

function buildStudentDetail(input: StudentFormInput, id: string = crypto.randomUUID()): StudentDetail {
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
    academicStatus: input.academicStatus,
    guardianFullName: input.guardianFullName,
    guardianRelationship: input.guardianRelationship,
    guardianPhone: input.guardianPhone,
    guardianPhoneSecondary: input.guardianPhoneSecondary,
    guardianEmail: input.guardianEmail,
    validateNow: input.validateNow,
    statusLabel: input.validateNow ? 'LISTO_PARA_COBRO' : 'CAPTURADO',
  }
}

function toStudentSummary(student: StudentDetail): StudentSummary {
  const fullName = `${student.firstName} ${student.paternalLastName} ${student.maternalLastName}`.trim()
  const address = [student.addressLine, student.neighborhood, student.locality, student.municipality, student.state]
    .filter(Boolean)
    .join(', ')

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
    documentationStatus: 'PENDIENTE',
    statusLabel: student.statusLabel,
    groupLabel: null,
    shiftLabel: null,
  }
}

export const browserFallbackApi = {
  appName: 'CBTA 44 Sistema (Browser Mode)',
  auth: {
    async login(input: AuthLoginInput) {
      const username = input.username.trim().toLowerCase()
      const user = browserUsers.find((item) => item.username === username && item.password === input.password)
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
  students: {
    async list() {
      return getStudents().map(toStudentSummary)
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
      const receipt: RocReceiptSummary = {
        id: crypto.randomUUID(),
        rocNumber: input.rocNumber,
        studentId: input.studentId,
        studentName: studentSummary.fullName,
        totalAmount: selectedConcepts.reduce((sum, concept) => sum + concept.amount, 0),
        issuedAt: new Date().toISOString(),
        status: 'EMITIDO',
        conceptLabels: selectedConcepts.map((concept) => `${concept.code} - ${concept.name}`),
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
    async openOfficialTemplate() {
      window.print()
      return { outputPath: 'browser-print', mode: 'browser-fallback' }
    },
    async reprint() {
      window.print()
      return { outputPath: 'browser-reprint', mode: 'browser-fallback' }
    },
    async printBatch() {
      window.print()
      return { ok: true, mode: 'browser-fallback' }
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
