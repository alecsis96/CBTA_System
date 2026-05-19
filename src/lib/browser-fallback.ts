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

const STUDENTS_KEY = 'cbta-browser-students'
const CONCEPTS_KEY = 'cbta-browser-concepts'
const RECEIPTS_KEY = 'cbta-browser-receipts'
const AUDIT_KEY = 'cbta-browser-audit'
const PRE_REGISTRATIONS_KEY = 'cbta-browser-pre-registrations'

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
  return safeParse<PreRegistrationSummary[]>(window.localStorage.getItem(PRE_REGISTRATIONS_KEY), [])
}

function savePreRegistrations(items: PreRegistrationSummary[]) {
  window.localStorage.setItem(PRE_REGISTRATIONS_KEY, JSON.stringify(items))
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
    email: input.email,
    addressLine: input.addressLine,
    neighborhood: input.neighborhood,
    locality: input.locality,
    municipality: input.municipality,
    state: input.state,
    postalCode: input.postalCode,
    previousSchool: input.previousSchool,
    secondaryAverage: input.secondaryAverage,
    schoolCycle: input.schoolCycle,
    academicStatus: input.academicStatus,
    guardianFullName: input.guardianFullName,
    guardianRelationship: input.guardianRelationship,
    guardianPhone: input.guardianPhone,
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
    curp: student.curp,
    rfc: student.rfc || null,
    phone: student.phone || null,
    email: student.email || null,
    fullName,
    address,
    statusLabel: student.statusLabel,
  }
}

export const browserFallbackApi = {
  appName: 'CBTA Financieros (Browser Mode)',
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
      return getPreRegistrations()
    },
    async create(input: PreRegistrationCreateInput) {
      const item: PreRegistrationSummary = {
        id: crypto.randomUUID(),
        folio: `PR-${Date.now()}`,
        fullName: `${input.firstName} ${input.paternalLastName} ${input.maternalLastName}`.trim(),
        curp: input.curp,
        schoolCycle: input.schoolCycle,
        status: 'PRE_REGISTRO_ENVIADO',
        submittedAt: new Date().toISOString(),
        reviewedAt: null,
        observationNotes: null,
      }
      const items = [item, ...getPreRegistrations()]
      savePreRegistrations(items)
      return item
    },
    async updateStatus(preRegistrationId: string, input: PreRegistrationStatusUpdateInput) {
      const items = getPreRegistrations()
      const index = items.findIndex((item) => item.id === preRegistrationId)
      if (index === -1) {
        throw new Error('Pre-registro no encontrado en modo navegador.')
      }

      const next: PreRegistrationSummary = {
        ...items[index],
        status: input.status,
        reviewedAt: new Date().toISOString(),
        observationNotes: input.observationNotes?.trim() || null,
      }

      items[index] = next
      savePreRegistrations(items)
      return next
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
  },
  audit: {
    async listRecent() {
      return getAuditLogs()
    },
  },
}
