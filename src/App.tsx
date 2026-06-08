import { FormEvent, Fragment, KeyboardEvent as ReactKeyboardEvent, MutableRefObject, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { browserFallbackApi } from '@/lib/browser-fallback'
import { createHybridApi } from '@/lib/hybrid-api'
import {
  AdmissionCaptureTable,
  PreRegistrationInboxPanel,
  type PreRegistrationStatusUpdate,
} from '@/components/control-escolar/panels'
import { StudentCaptureFormPanel } from '@/components/control-escolar/student-capture-form-panel'
import { amountToWords, formatCurrency, formatPrintDate } from '@/lib/formatters'
import { addPendingSyncOp, clearPendingSyncOps, getDeviceId } from '@/lib/sync-queue'
import { getSyncStatusSnapshot, syncAll, type SyncStatusSnapshot } from '@/lib/sync-service'
import type {
  AdmissionCreatePaymentInput,
  AdmissionSummary,
  AppRole,
  AuthLoginInput,
  AuthSession,
  AuditLogSummary,
  CashPaymentBatchCreateResult,
  CashPaymentSummary,
  ChargeConceptSummary,
  GroupAssignedRosterRow,
  GroupRosterImportRow,
  PreRegistrationSummary,
  RocReceiptSummary,
  SaveStudentRequirementChecklistInput,
  GroupStat,
  GroupPreviewRow,
  StudentFormInput,
  StudentRequirementChecklist,
  StudentSummary,
} from '@/types/domain'
import type { DepartmentSummary, UserCreateInput, UserSummary, UserUpdateInput } from '@/types/admin'

type Screen = 'control-escolar' | 'ingresos-propios' | 'configuracion'
type FeedbackScope = 'control-escolar' | 'ingresos-propios' | 'configuracion' | 'sync'

const GROUP_COLUMN_ALIASES = ['grupo', 'group', 'grupo asignado', 'grupo destino', 'group label']
const ENROLLMENT_COLUMN_ALIASES = ['folio interno', 'matricula', 'matricula interna', 'enrollment number', 'enrollmentnumber', 'numero de control']
const CURP_COLUMN_ALIASES = ['curp']

const relationshipOptions = ['Padre', 'Madre', 'Tutor', 'Abuelo', 'Abuela', 'Otro']

const CONTROL_STUDENTS_PER_PAGE = 20
const RECEIPTS_PER_PAGE = 5
const CURRENT_DATE = new Date()
const INSCRIPTION_CONCEPT_CODE = 'B002'

const EMPTY_SYNC_STATUS: SyncStatusSnapshot = {
  lastSuccessfulSyncAt: null,
  lastSyncError: null,
  lastSyncErrorState: null,
  pendingTotal: 0,
  pendingByType: {
    STUDENT_CREATE: 0,
    STUDENT_UPDATE: 0,
    RECEIPT_CREATE: 0,
    RECEIPT_REPRINT: 0,
    CASH_PAYMENT_CREATE: 0,
    CONCEPT_TARIFF_UPDATE: 0,
    CONCEPT_SUGGESTED_UPDATE: 0,
  },
}

function isSelectableConcept(concept: ChargeConceptSummary) {
  return !concept.code.endsWith('000') && !concept.isLifeInsurance
}

function resolveGroupKey(concept: ChargeConceptSummary) {
  if (concept.groupCode && concept.groupCode.trim().length > 0) {
    return concept.groupCode
  }

  const prefix = concept.code.slice(0, 1)
  return `${prefix}000`
}

const conceptGroupHeaders: Record<string, { code: string; name: string; description: string }> = {
  A000: {
    code: 'A000',
    name: 'Servicios administrativos escolares',
    description: 'Agrupa los ingresos por servicios administrativos escolares.',
  },
  B000: {
    code: 'B000',
    name: 'Aportaciones y cuotas de cooperacion voluntaria',
    description: 'Agrupa aportaciones, cooperaciones y donaciones relacionadas.',
  },
  C000: {
    code: 'C000',
    name: 'Servicios generales',
    description: 'Agrupa ingresos por servicios generales a estudiantes y comunidad.',
  },
}

function groupConcepts(concepts: ChargeConceptSummary[], query?: string) {
  const groupOrder: string[] = []
  const groupMap = new Map<
    string,
    { header: ChargeConceptSummary | null; items: ChargeConceptSummary[] }
  >()

  const normalizedQuery = query?.trim().toLowerCase() ?? ''

  for (const concept of concepts) {
    const groupKey = resolveGroupKey(concept)
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, { header: null, items: [] })
      groupOrder.push(groupKey)
    }

    const group = groupMap.get(groupKey)
    if (!group) continue

    if (concept.code === groupKey) {
      group.header = concept
    } else {
      if (!normalizedQuery) {
        group.items.push(concept)
        continue
      }

      const haystack = [concept.code, concept.name, concept.description ?? '', concept.groupCode ?? '']
        .join(' ')
        .toLowerCase()

      if (haystack.includes(normalizedQuery)) {
        group.items.push(concept)
      }
    }
  }

  return groupOrder
    .map((groupKey) => ({
      key: groupKey,
      header: groupMap.get(groupKey)?.header ?? null,
      items: groupMap.get(groupKey)?.items ?? [],
    }))
    .filter((group) => group.items.length > 0)
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightMatch(text: string, query: string) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return text
  const regex = new RegExp(`(${escapeRegex(normalizedQuery)})`, 'gi')
  const parts = text.split(regex)
  if (parts.length === 1) return text
  return parts.map((part, index) =>
    part.toLowerCase() === normalizedQuery.toLowerCase()
      ? <mark key={`${part}-${index}`} className="search-highlight">{part}</mark>
      : part,
  )
}

function deriveGradeFromGroup(groupLabel: string | null) {
  if (!groupLabel) return 'Sin grado'
  const match = groupLabel.trim().match(/^(\d+)/)
  if (!match) return 'Sin grado'
  return `${match[1]}o`
}

function groupSexBalanceLabel(stat: GroupStat) {
  const gap = Math.abs(stat.sex.hombre - stat.sex.mujer)
  return gap <= 4 ? 'OK' : gap <= 8 ? 'Revisar' : 'Ajustar'
}

function groupBandBalanceLabel(stat: GroupStat) {
  const values = [stat.bands.alto, stat.bands.medio, stat.bands.bajo]
  const spread = Math.max(...values) - Math.min(...values)
  return spread <= 6 ? 'OK' : spread <= 12 ? 'Revisar' : 'Ajustar'
}

function groupedSelectableConcepts(concepts: ChargeConceptSummary[]) {
  const items = concepts.filter(isSelectableConcept)
  const grouped = new Map<string, ChargeConceptSummary[]>()

  for (const concept of items) {
    const key = resolveGroupKey(concept)
    const current = grouped.get(key) ?? []
    current.push(concept)
    grouped.set(key, current)
  }

  return Array.from(grouped.entries()).map(([key, groupItems]) => ({
    key,
    header: {
      code: conceptGroupHeaders[key]?.code ?? key,
      groupCode: key,
      name: conceptGroupHeaders[key]?.name ?? `Grupo ${key}`,
      description: conceptGroupHeaders[key]?.description ?? 'Grupo derivado automaticamente desde la clave.',
      amount: 0,
      periodLabel: 'Sin tarifa',
      isSuggested: false,
      excludeFromRoc: false,
      isLifeInsurance: false,
    },
    items: groupItems,
  }))
}

const initialForm: StudentFormInput = {
  enrollmentNumber: '',
  curp: '',
  rfc: '',
  firstName: '',
  paternalLastName: '',
  maternalLastName: '',
  birthDate: '',
  age: null,
  sex: '',
  phone: '',
  studentPhoneSecondary: '',
  email: '',
  motherTongue: '',
  addressLine: '',
  neighborhood: '',
  locality: '',
  municipality: 'Yajalon',
  state: 'Chiapas',
  postalCode: '29930',
  previousSchool: '',
  secondaryAverage: null,
  examRoom: '',
  schoolCycle: '2026-2027',
  academicStatus: 'Regular',
  guardianFullName: '',
  guardianRelationship: '',
  guardianPhone: '',
  guardianPhoneSecondary: '',
  guardianEmail: '',
  validateNow: true,
}

const initialPaymentForm: AdmissionCreatePaymentInput = {
  folio: '',
  curp: '',
  fullName: '',
  insurancePaid: false,
}

function App() {
  const desktopApi = typeof window !== 'undefined' && 'cbta' in window ? window.cbta : null
  const localApi = (desktopApi ?? browserFallbackApi) as Window['cbta']
  const isBrowserMode = !desktopApi
  const [screen, setScreen] = useState<Screen>('control-escolar')
  const [authSession, setAuthSession] = useState<AuthSession | null>(null)
  const [authForm, setAuthForm] = useState<AuthLoginInput>({ username: '', password: '' })
  const [authLoading, setAuthLoading] = useState(true)
  const [authSaving, setAuthSaving] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [students, setStudents] = useState<StudentSummary[]>([])
  const [preRegistrations, setPreRegistrations] = useState<PreRegistrationSummary[]>([])
  const [admissions, setAdmissions] = useState<AdmissionSummary[]>([])
  const [paymentForm, setPaymentForm] = useState<AdmissionCreatePaymentInput>(initialPaymentForm)
  const [captureQuery, setCaptureQuery] = useState('')
  const [activeAdmission, setActiveAdmission] = useState<AdmissionSummary | null>(null)
  const [validatedStudents, setValidatedStudents] = useState<StudentSummary[]>([])
  const [selectedStudent, setSelectedStudent] = useState<StudentSummary | null>(null)
  const [concepts, setConcepts] = useState<ChargeConceptSummary[]>([])
  const [selectedConcepts, setSelectedConcepts] = useState<ChargeConceptSummary[]>([])
  const [conceptAmounts, setConceptAmounts] = useState<Record<string, number>>({})
  const [receipts, setReceipts] = useState<RocReceiptSummary[]>([])
  const [allReceipts, setAllReceipts] = useState<RocReceiptSummary[]>([])
  const [cashPayments, setCashPayments] = useState<CashPaymentSummary[]>([])
  const [recentAuditLogs, setRecentAuditLogs] = useState<AuditLogSummary[]>([])
  const [adminUsers, setAdminUsers] = useState<UserSummary[]>([])
  const [departments, setDepartments] = useState<DepartmentSummary[]>([])
  const [includeLifeInsurance, setIncludeLifeInsurance] = useState(false)
  const [rocNumber, setRocNumber] = useState('DGETAYCM-ROC-0001')
  const [suggestedRocNumber, setSuggestedRocNumber] = useState('DGETAYCM-ROC-0001')
  const [rocInitialNumber, setRocInitialNumber] = useState('DGETAYCM-ROC-0001')
  const [rocBatchMonth, setRocBatchMonth] = useState(CURRENT_DATE.getMonth() + 1)
  const [rocBatchYear, setRocBatchYear] = useState(CURRENT_DATE.getFullYear())
  const [conceptQuery, setConceptQuery] = useState('')
  const [form, setForm] = useState<StudentFormInput>(initialForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingReceipt, setSavingReceipt] = useState(false)
  const [savingRocConfig, setSavingRocConfig] = useState(false)
  const [savingTariffCode, setSavingTariffCode] = useState<string | null>(null)
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null)
  const [feedbackByScope, setFeedbackByScope] = useState<Record<FeedbackScope, string | null>>({
    'control-escolar': null,
    'ingresos-propios': null,
    configuracion: null,
    sync: null,
  })
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [syncStatus, setSyncStatus] = useState<SyncStatusSnapshot>(EMPTY_SYNC_STATUS)
  const [syncing, setSyncing] = useState(false)
  const appApi = useMemo(() => createHybridApi(localApi, () => authSession), [localApi, authSession])
  const insuranceConcept = useMemo(() => concepts.find((concept) => concept.isLifeInsurance) ?? null, [concepts])
  const inscriptionSelected = selectedConcepts.some((concept) => concept.code === INSCRIPTION_CONCEPT_CODE)
  const [isRecentActivityCollapsed, setIsRecentActivityCollapsed] = useState(false)
  const studentsSectionRef = useRef<HTMLElement | null>(null)
  const captureSectionRef = useRef<HTMLElement | null>(null)
  const ingresosFeedbackTimerRef = useRef<number | null>(null)
  const rocNumberEditedRef = useRef(false)

  function setScopedFeedback(scope: FeedbackScope, message: string | null) {
    setFeedbackByScope((current) => ({
      ...current,
      [scope]: message,
    }))
  }

  const feedback = feedbackByScope[screen]

  function setFeedback(message: string | null, scope: FeedbackScope = screen) {
    setScopedFeedback(scope, message)
  }

  function setControlFeedback(message: string | null) {
    setFeedback(message, 'control-escolar')
  }

  function setIngresosFeedback(message: string | null) {
    setFeedback(message, 'ingresos-propios')
  }

  function handleChangeRocNumber(value: string) {
    rocNumberEditedRef.current = true
    setRocNumber(value)
  }

  function applySuggestedRocNumber(value: string, force = false) {
    setSuggestedRocNumber(value)
    setRocNumber((current) => {
      if (force || !rocNumberEditedRef.current || current.trim().length === 0) {
        return value
      }

      return current
    })
  }

  async function refreshSuggestedRocNumber(force = false) {
    if (typeof appApi.receipts.getConfig !== 'function') {
      return
    }

    const config = await appApi.receipts.getConfig()
    setRocInitialNumber(config.initialRocNumber)
    applySuggestedRocNumber(config.nextSuggestedRocNumber, force)
  }

  function scheduleIngresosFeedbackClear(delayMs = 3500) {
    if (ingresosFeedbackTimerRef.current) {
      window.clearTimeout(ingresosFeedbackTimerRef.current)
    }

    ingresosFeedbackTimerRef.current = window.setTimeout(() => {
      setIngresosFeedback(null)
    }, delayMs)
  }

  function setConfigFeedback(message: string | null) {
    setFeedback(message, 'configuracion')
  }

  function setSyncFeedback(message: string | null) {
    setFeedback(message, 'sync')
  }

  function refreshSyncStatus() {
    setSyncStatus(getSyncStatusSnapshot())
  }

  useEffect(() => {
    void initializeSession()
  }, [])

  useEffect(() => {
    if (!feedback) {
      return
    }

    const timer = window.setTimeout(() => {
      setScopedFeedback(screen, null)
    }, 4200)

    return () => window.clearTimeout(timer)
  }, [feedback, screen])

  useEffect(() => {
    if (!authSession) {
      return
    }

    if (!canAccessScreen(authSession.role, screen)) {
      setScreen(defaultScreenByRole(authSession.role))
    }
  }, [authSession, screen])

  async function initializeSession() {
    setAuthLoading(true)
    try {
      const session = await appApi.auth.session()
      setAuthSession(session)
      if (session) {
        setScreen(defaultScreenByRole(session.role))
        await loadData(session)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo validar la sesion actual.'
      setAuthError(message)
    } finally {
      setAuthLoading(false)
    }
  }

  useEffect(() => {
    refreshSyncStatus()

    function onOnline() {
      setIsOnline(true)
    }

    function onOffline() {
      setIsOnline(false)
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    if (!isOnline || syncing) {
      return
    }

    void handleSyncNow()
  }, [isOnline, syncing])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (navigator.onLine && !syncing) {
        void handleSyncNow()
      }
    }, 30000)

    return () => {
      window.clearInterval(timer)
    }
  }, [syncing])

  useEffect(() => {
    if (!selectedStudent) {
      setReceipts([])
      return
    }

    void loadReceipts(selectedStudent.id)
  }, [selectedStudent])

  useEffect(() => {
    if (inscriptionSelected) {
      return
    }

    setIncludeLifeInsurance(false)
    if (!insuranceConcept) {
      return
    }

    setSelectedConcepts((current) => current.filter((concept) => concept.code !== insuranceConcept.code))
    setConceptAmounts((current) => {
      if (!(insuranceConcept.code in current)) {
        return current
      }

      const next = { ...current }
      delete next[insuranceConcept.code]
      return next
    })
  }, [inscriptionSelected, insuranceConcept])

  async function loadData(sessionForAdmin: AuthSession | null = authSession) {
    setLoading(true)
    try {
      const receiptsAllPromise =
        typeof appApi.receipts.listAll === 'function' ? appApi.receipts.listAll() : Promise.resolve([])
      const cashPaymentsPromise =
        typeof appApi.payments?.list === 'function' ? appApi.payments.list() : Promise.resolve([])
      const admissionsPromise =
        typeof appApi.admissions?.list === 'function' ? appApi.admissions.list() : Promise.resolve([])
      const rocConfigPromise =
        typeof appApi.receipts.getConfig === 'function'
          ? appApi.receipts.getConfig()
              .catch(() => ({ initialRocNumber: 'DGETAYCM-ROC-0001', lastRocNumber: null, nextSuggestedRocNumber: 'DGETAYCM-ROC-0001' }))
          : Promise.resolve({ initialRocNumber: 'DGETAYCM-ROC-0001', lastRocNumber: null, nextSuggestedRocNumber: 'DGETAYCM-ROC-0001' })
      const adminUsersPromise =
        sessionForAdmin?.role === 'ADMIN' && typeof appApi.admin?.listUsers === 'function'
          ? appApi.admin.listUsers()
          : Promise.resolve([])
      const departmentsPromise =
        sessionForAdmin?.role === 'ADMIN' && typeof appApi.admin?.listDepartments === 'function'
          ? appApi.admin.listDepartments()
          : Promise.resolve([])

      const [allStudents, preRegistrations, validatedStudents, activeConcepts, auditLogs, receiptsAll, cashPayments, admissions, rocConfig, adminUsers, departments] = await Promise.all([
        appApi.students.list(),
        appApi.preRegistrations.list(),
        appApi.students.listValidated(),
        appApi.concepts.listActive(),
        appApi.audit.listRecent(),
        receiptsAllPromise,
        cashPaymentsPromise,
        admissionsPromise,
        rocConfigPromise,
        adminUsersPromise,
        departmentsPromise,
      ])

      setStudents(allStudents)
      setPreRegistrations(preRegistrations)
      setValidatedStudents(validatedStudents)
      setConcepts(activeConcepts)
      setRecentAuditLogs(auditLogs)
      setAllReceipts(receiptsAll)
      setCashPayments(cashPayments)
      setAdmissions(admissions)
      setAdminUsers(adminUsers)
      setDepartments(departments)
      setRocInitialNumber(rocConfig.initialRocNumber)
      applySuggestedRocNumber(rocConfig.nextSuggestedRocNumber)
      setSelectedStudent((current) => {
        if (current) {
          return validatedStudents.find((student: StudentSummary) => student.id === current.id) ?? validatedStudents[0] ?? null
        }

        return validatedStudents[0] ?? null
      })
      setSelectedConcepts((current) => {
        if (current.length > 0) {
          const refreshedSelection = current
            .map((selected) => activeConcepts.find((concept: ChargeConceptSummary) => concept.code === selected.code))
            .filter((concept): concept is ChargeConceptSummary => Boolean(concept))

          if (refreshedSelection.length > 0) {
            return refreshedSelection
          }
        }

        const firstSelectable = activeConcepts.find(isSelectableConcept)
        return firstSelectable ? [firstSelectable] : []
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cargar la informacion inicial.'
      setSyncFeedback(message)
    } finally {
      setLoading(false)
    }
  }

  function defaultScreenByRole(role: AppRole): Screen {
    if (role === 'CONTROL_ESCOLAR') return 'control-escolar'
    if (role === 'INGRESOS_PROPIOS') return 'ingresos-propios'
    return 'configuracion'
  }

  function canAccessScreen(role: AppRole, target: Screen) {
    if (role === 'ADMIN') return true
    if (role === 'CONTROL_ESCOLAR') return target === 'control-escolar'
    if (role === 'INGRESOS_PROPIOS') return target === 'ingresos-propios'
    return false
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthSaving(true)
    setAuthError(null)
    try {
      const session = await appApi.auth.login(authForm)
      setAuthSession(session)
      setScreen(defaultScreenByRole(session.role))
      await loadData(session)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo iniciar sesion.'
      setAuthError(message)
    } finally {
      setAuthSaving(false)
    }
  }

  async function handleLogout() {
    await appApi.auth.logout()
    setAuthSession(null)
    setAuthForm({ username: '', password: '' })
    setControlFeedback(null)
    setIngresosFeedback(null)
    setConfigFeedback(null)
    setSyncFeedback(null)
  }

  async function loadReceipts(studentId: string) {
    const studentReceipts = await appApi.receipts.listByStudent(studentId)
    setReceipts(studentReceipts)
  }

  async function prepareNextInternalFolio() {
    if (typeof appApi.students.getNextInternalFolioPreview !== 'function') {
      return
    }

    const nextFolio = await appApi.students.getNextInternalFolioPreview()
    setForm((current) => ({ ...current, enrollmentNumber: nextFolio }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setControlFeedback(null)

    try {
      if (editingStudentId) {
        const updated = await appApi.students.update(editingStudentId, form)
        if (activeAdmission && typeof appApi.admissions?.completeCapture === 'function') {
          await appApi.admissions.completeCapture(activeAdmission.id, updated.id)
        }
      } else {
        const created = await appApi.students.create(form)
        if (activeAdmission && typeof appApi.admissions?.completeCapture === 'function') {
          await appApi.admissions.completeCapture(activeAdmission.id, created.id)
        }
      }
      refreshSyncStatus()

      const wasEditing = editingStudentId !== null
      setEditingStudentId(null)
      setActiveAdmission(null)
      setForm(initialForm)
      setControlFeedback(
        wasEditing
          ? 'Alumno actualizado correctamente desde Control Escolar.'
          : isBrowserMode
            ? 'Alumno guardado en modo navegador usando almacenamiento local del navegador.'
            : 'Alumno guardado correctamente y disponible para Ingresos Propios si quedo validado.',
      )
      await loadData()
      if (!wasEditing) {
        await prepareNextInternalFolio()
      }
      if (!wasEditing) {
        setScreen('ingresos-propios')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar el alumno.'
      setControlFeedback(message)
    } finally {
      setSaving(false)
    }
  }

  function updateField<K extends keyof StudentFormInput>(field: K, value: StudentFormInput[K]) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  async function handleCreatePayment() {
    if (typeof appApi.admissions?.createPayment !== 'function') {
      return
    }

    setIngresosFeedback(null)
    try {
      await appApi.admissions.createPayment(paymentForm)
      setPaymentForm(initialPaymentForm)
      await loadData()
      setIngresosFeedback('Pago de inscripcion registrado. Control Escolar ya puede identificar este CURP como pagado.')
      scheduleIngresosFeedbackClear()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar el pago de inscripcion.'
      setIngresosFeedback(message)
    }
  }

  async function printPaymentReceipt(admission: AdmissionSummary) {
    if (typeof appApi.admissions?.printPaymentReceipt === 'function') {
      await appApi.admissions.printPaymentReceipt(admission)
      return
    }

    window.print()
  }

  function splitFullName(fullName: string) {
    const parts = fullName
      .trim()
      .split(/\s+/)
      .filter(Boolean)

    if (parts.length <= 1) {
      return { firstName: fullName.trim(), paternalLastName: '', maternalLastName: '' }
    }

    if (parts.length === 2) {
      return { firstName: parts[0], paternalLastName: parts[1], maternalLastName: '' }
    }

    const maternalLastName = parts[parts.length - 1]
    const paternalLastName = parts[parts.length - 2]
    const firstName = parts.slice(0, -2).join(' ')
    return { firstName, paternalLastName, maternalLastName }
  }

  async function handleSelectAdmissionForCapture(admission: AdmissionSummary) {
    setControlFeedback(null)
    try {
      const started =
        typeof appApi.admissions?.startCapture === 'function' ? await appApi.admissions.startCapture(admission.id) : admission

      setActiveAdmission(started)
      const parsedName = splitFullName(admission.fullName)
      setForm((current) => ({
        ...current,
        curp: admission.curp,
        firstName: parsedName.firstName,
        paternalLastName: parsedName.paternalLastName,
        maternalLastName: parsedName.maternalLastName,
      }))
      await prepareNextInternalFolio()
      setControlFeedback('Pago selecci?nado. Completa la captura y guarda el alumno.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo abrir la captura de ficha.'
      setControlFeedback(message)
    }
  }

  async function handlePrintAdmission(admission: AdmissionSummary) {
    if (admission.status !== 'CAPTURADO_CONTROL_ESCOLAR' && admission.status !== 'FICHA_IMPRESA') {
      setIngresosFeedback('La ficha solo se imprime cuando la captura esta completa.')
      return
    }

    if (typeof appApi.admissions?.printFicha === 'function') {
      await appApi.admissions.printFicha(admission)
    } else {
      window.print()
    }

    if (typeof appApi.admissions?.markPrinted === 'function') {
      await appApi.admissions.markPrinted(admission.id)
      await loadData()
    }
  }

  async function handleEditStudent(studentId: string) {
    setControlFeedback(null)

    try {
      const student = await appApi.students.get(studentId)
      const { id, statusLabel: _statusLabel, ...studentForm } = student
      void _statusLabel
      setEditingStudentId(id)
      setForm(studentForm)
      setScreen('control-escolar')
      setTimeout(() => {
        captureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 0)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cargar el alumno para editar.'
      setControlFeedback(message)
    }
  }

  function handleCancelEdit() {
    setEditingStudentId(null)
    setForm(initialForm)
    setControlFeedback(null)
    void prepareNextInternalFolio()
  }

  function toggleConcept(concept: ChargeConceptSummary) {
    setSelectedConcepts((current) => {
      const exists = current.some((item) => item.code === concept.code)
      if (exists) {
        if (concept.code === INSCRIPTION_CONCEPT_CODE) {
          setIncludeLifeInsurance(false)
        }
        setConceptAmounts((amounts) => {
          const next = { ...amounts }
          delete next[concept.code]
          return next
        })
        return current.filter((item) => item.code !== concept.code)
      }

      setConceptAmounts((amounts) => ({ ...amounts, [concept.code]: amounts[concept.code] ?? concept.amount }))

      return [...current, concept]
    })
  }

  function handleToggleLifeInsurance(checked: boolean) {
    setIncludeLifeInsurance(checked)

    if (!insuranceConcept) {
      return
    }

    setSelectedConcepts((current) => {
      const exists = current.some((item) => item.code === insuranceConcept.code)
      if (checked && !exists) {
        return [...current, insuranceConcept]
      }

      if (!checked && exists) {
        return current.filter((item) => item.code !== insuranceConcept.code)
      }

      return current
    })

    setConceptAmounts((amounts) => {
      if (checked) {
        return { ...amounts, [insuranceConcept.code]: amounts[insuranceConcept.code] ?? insuranceConcept.amount }
      }

      if (!(insuranceConcept.code in amounts)) {
        return amounts
      }

      const next = { ...amounts }
      delete next[insuranceConcept.code]
      return next
    })
  }

  function updateConceptAmount(code: string, amount: number) {
    setConceptAmounts((current) => ({ ...current, [code]: amount }))
  }

  async function handleCreateReceipt() {
    if (!selectedStudent) {
      setIngresosFeedback('Selecciona primero un alumno validado.')
      return
    }

    if (!rocNumber.trim()) {
      setIngresosFeedback('Captura el numero de ROC antes de emitir.')
      return
    }

    if (selectedConcepts.length === 0) {
      setIngresosFeedback('Selecciona al menos un concepto para emitir el ROC.')
      return
    }

    setSavingReceipt(true)
    setIngresosFeedback(null)

    try {
      const createdReceipt = await appApi.receipts.create({
        rocNumber,
        studentId: selectedStudent.id,
        conceptCodes: selectedConcepts.map((concept) => concept.code),
        conceptItems: selectedConcepts.map((concept) => ({ code: concept.code, amount: conceptAmounts[concept.code] ?? concept.amount })),
      })
      addPendingSyncOp({
        type: 'RECEIPT_CREATE',
        entityId: createdReceipt.id,
        payload: { receiptId: createdReceipt.id, studentId: selectedStudent.id },
        deviceId: getDeviceId(),
      })
      refreshSyncStatus()
      setAllReceipts((current) => [createdReceipt, ...current])
      await loadReceipts(selectedStudent.id)
      await loadData()
      rocNumberEditedRef.current = false
      await refreshSuggestedRocNumber(true)
      setIngresosFeedback('ROC guardado correctamente en el historial del alumno.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar el ROC.'
      setIngresosFeedback(message)
    } finally {
      setSavingReceipt(false)
    }
  }

  async function handleReprintReceipt(receiptId: string) {
    setIngresosFeedback(null)

    try {
      await appApi.receipts.reprint(receiptId)
      addPendingSyncOp({
        type: 'RECEIPT_REPRINT',
        entityId: receiptId,
        payload: { receiptId },
        deviceId: getDeviceId(),
      })
      refreshSyncStatus()

      setAllReceipts((current) =>
        current.map((receipt) =>
          receipt.id === receiptId ? { ...receipt, status: 'REIMPRESO' } : receipt,
        ),
      )

      if (selectedStudent) {
        await loadReceipts(selectedStudent.id)
      }

      await loadData()
      setIngresosFeedback(
        isBrowserMode
          ? 'Reimpresion lanzada en modo navegador.'
          : 'Se genero una nueva copia del ROC oficial desde el historial.',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo reimprimir el ROC.'
      setIngresosFeedback(message)
    }
  }

  async function handleCancelReceipt(receiptId: string, reason: string) {
    setIngresosFeedback(null)

    try {
      const cancelled = await appApi.receipts.cancel({
        receiptId,
        reason: reason.trim(),
      })

      setAllReceipts((current) =>
        current.map((receipt) =>
          receipt.id === receiptId ? cancelled : receipt,
        ),
      )

      if (selectedStudent) {
        await loadReceipts(selectedStudent.id)
      }

      await loadData()
      await refreshSuggestedRocNumber(true)
      setIngresosFeedback(`ROC ${cancelled.rocNumber} anulado correctamente.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo anular el ROC.'
      setIngresosFeedback(message)
    }
  }

  async function handleUpdateTariff(code: string, amount: number, periodLabel: string) {
    setSavingTariffCode(code)
    setConfigFeedback(null)

    try {
      await appApi.concepts.updateTariff({ code, amount, periodLabel })
      await loadData()
      setConfigFeedback(`Tarifa actualizada para ${code}: $${amount.toFixed(2)} en ${periodLabel}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar la tarifa.'
      setConfigFeedback(message)
    } finally {
      setSavingTariffCode(null)
    }
  }

  async function handleUpdateConceptSuggested(code: string, isSuggested: boolean) {
    setSavingTariffCode(code)
    setConfigFeedback(null)

    try {
      await appApi.concepts.updateSuggested({ code, isSuggested })
      await loadData()
      setConfigFeedback(
        isSuggested
          ? `La clave ${code} quedo marcada como sugerida para Caja.`
          : `La clave ${code} ya no se mostrara como sugerida en Caja.`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar la sugerencia de la clave.'
      setConfigFeedback(message)
    } finally {
      setSavingTariffCode(null)
    }
  }

  async function handleUpdateRocConfig(initialRocNumber: string) {
    if (typeof appApi.receipts.updateConfig !== 'function') {
      setConfigFeedback('La configuracion de ROC no esta disponible en este modo.')
      return
    }

    setSavingRocConfig(true)
    setConfigFeedback(null)

    try {
      const config = await appApi.receipts.updateConfig({ initialRocNumber })
      setRocInitialNumber(config.initialRocNumber)
      rocNumberEditedRef.current = false
      applySuggestedRocNumber(config.nextSuggestedRocNumber, true)
      setConfigFeedback(`ROC inicial guardado. Siguiente sugerido: ${config.nextSuggestedRocNumber}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar la configuracion de ROC.'
      setConfigFeedback(message)
    } finally {
      setSavingRocConfig(false)
    }
  }

  async function handleCreateAdminUser(input: UserCreateInput) {
    setSavingUserId('new')
    setConfigFeedback(null)

    try {
      await appApi.admin.createUser(input)
      await loadData(authSession)
      setConfigFeedback(`Usuario ${input.username.trim().toLowerCase()} creado correctamente.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo crear el usuario.'
      setConfigFeedback(message)
    } finally {
      setSavingUserId(null)
    }
  }

  async function handleUpdateAdminUser(userId: string, input: UserUpdateInput) {
    setSavingUserId(userId)
    setConfigFeedback(null)

    try {
      await appApi.admin.updateUser(userId, input)
      await loadData(authSession)
      setConfigFeedback('Usuario actualizado correctamente.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar el usuario.'
      setConfigFeedback(message)
    } finally {
      setSavingUserId(null)
    }
  }

  async function handleResetAdminUserPassword(userId: string, password: string) {
    setSavingUserId(userId)
    setConfigFeedback(null)

    try {
      await appApi.admin.resetUserPassword(userId, { password })
      await loadData(authSession)
      setConfigFeedback('Contrasena restablecida correctamente.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo restablecer la contrasena.'
      setConfigFeedback(message)
    } finally {
      setSavingUserId(null)
    }
  }

  async function handleUpdatePreRegistrationStatus(
    preRegistrationId: string,
    status: 'EN_REVISION_CONTROL_ESCOLAR' | 'OBSERVADO' | 'RECHAZADO' | 'VALIDADO_PARA_PAGO' | 'PAGADO',
  ) {
    setControlFeedback(null)

    try {
      await appApi.preRegistrations.updateStatus(preRegistrationId, { status })
      await loadData()
      setControlFeedback(`Pre-registro actualizado a ${status}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar el estatus del pre-registro.'
      setControlFeedback(message)
    }
  }

  async function handlePrintReceipt() {
    if (!selectedStudent || selectedConcepts.length === 0) {
      setIngresosFeedback('Selecciona un alumno y al menos un concepto antes de imprimir.')
      return
    }

    if (!rocNumber.trim()) {
      setIngresosFeedback('Captura el numero de ROC antes de imprimir.')
      return
    }

    setSavingReceipt(true)
    setIngresosFeedback(null)
    try {
      const createdReceipt = await appApi.receipts.create({
        rocNumber,
        studentId: selectedStudent.id,
        conceptCodes: selectedConcepts.map((concept) => concept.code),
        conceptItems: selectedConcepts.map((concept) => ({ code: concept.code, amount: conceptAmounts[concept.code] ?? concept.amount })),
      })
      await appApi.receipts.reprint(createdReceipt.id)
      await loadReceipts(selectedStudent.id)
      await loadData()
      rocNumberEditedRef.current = false
      await refreshSuggestedRocNumber(true)
      setIngresosFeedback('ROC guardado e impreso correctamente.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar e imprimir el ROC.'
      setIngresosFeedback(message)
    } finally {
      setSavingReceipt(false)
    }
  }

  async function handleCreateCashPayment() {
    if (!selectedStudent) {
      setIngresosFeedback('Selecciona primero un alumno validado para registrar el cobro.')
      return false
    }

    if (selectedConcepts.length === 0) {
      setIngresosFeedback('Selecciona al menos una clave antes de registrar el cobro.')
      return false
    }

    setSavingReceipt(true)
    setIngresosFeedback(null)

    try {
      await appApi.payments.create({
        studentId: selectedStudent.id,
        conceptItems: selectedConcepts.map((concept) => ({
          code: concept.code,
          amount: conceptAmounts[concept.code] ?? concept.amount,
        })),
      })
      await loadData()
      await loadReceipts(selectedStudent.id)
      setSelectedConcepts([])
      setConceptAmounts({})
      setIncludeLifeInsurance(false)
      setIngresosFeedback('Cobro registrado. El alumno ya esta en pendientes de ROC.')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar el cobro.'
      setIngresosFeedback(message)
      return false
    } finally {
      setSavingReceipt(false)
    }
  }

  async function handlePreviewOfficialReceipt() {
    if (!selectedStudent) {
      setIngresosFeedback('Selecciona primero un alumno para generar el ejemplo del ROC.')
      return
    }

    if (selectedConcepts.length === 0) {
      setIngresosFeedback('Selecciona al menos una clave para abrir el ejemplo del ROC.')
      return
    }

    setSavingReceipt(true)
    setIngresosFeedback(null)

    try {
      await appApi.receipts.openOfficialTemplate({
        rocNumber: rocNumber.trim() || `EJEMPLO-${Date.now()}`,
        studentId: selectedStudent.id,
        conceptCodes: selectedConcepts.map((concept) => concept.code),
      })
      setIngresosFeedback('Ejemplo del ROC abierto con los datos actuales.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo abrir el ejemplo del ROC.'
      setIngresosFeedback(message)
    } finally {
      setSavingReceipt(false)
    }
  }

  async function handleGenerateBatchReceipts(paymentIds: string[]): Promise<CashPaymentBatchCreateResult | null> {
    const today = new Date()
    const currentMonth = today.getMonth() + 1
    const currentYear = today.getFullYear()

    if (rocBatchMonth !== currentMonth || rocBatchYear !== currentYear) {
      setIngresosFeedback('Para generar nuevos ROC y acumularlos correctamente, selecci?na el mes actual. Los meses anteriores se reimprimen con "Reimprimir mes completo".')
      return null
    }

    if (paymentIds.length === 0) {
      setIngresosFeedback('Selecciona al menos un cobro pendiente para generar el ROC masivo.')
      return null
    }

    if (!suggestedRocNumber.trim()) {
      setIngresosFeedback('No hay un ROC sugerido disponible. Revisa la configuracion de Ingresos Propios.')
      return null
    }

    setSavingReceipt(true)
    setIngresosFeedback(null)

    try {
      const result = await appApi.payments.generateBatch({
        paymentIds,
        startingRocNumber: suggestedRocNumber.trim(),
      })
      await loadData()
      if (selectedStudent) {
        await loadReceipts(selectedStudent.id)
      }
      rocNumberEditedRef.current = false
      await refreshSuggestedRocNumber(true)
      setIngresosFeedback(`ROC del mes actualizado (${result.createdCount} alumnos nuevos). Archivo: ${getOutputFileName(result.outputPath)}.`)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo generar el ROC mensual.'
      setIngresosFeedback(message)
      return null
    } finally {
      setSavingReceipt(false)
    }
  }

  function handleSelectIngresosStudent(student: StudentSummary | null) {
    setSelectedStudent(student)
    setSelectedConcepts([])
    setConceptAmounts({})
    setIncludeLifeInsurance(false)
    setConceptQuery('')
    setIngresosFeedback(null)
  }

  async function handlePrintMonthlyReceipts() {
    setSavingReceipt(true)
    setIngresosFeedback(null)

    try {
      const result = await appApi.receipts.printBatch({
        month: rocBatchMonth,
        year: rocBatchYear,
      })
      setIngresosFeedback(`ROC mensual ${result.periodLabel} generado (${result.exportedCount} ROC). Archivo: ${getOutputFileName(result.outputPath)}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo generar el ROC mensual.'
      setIngresosFeedback(message)
    } finally {
      setSavingReceipt(false)
    }
  }

  const total = selectedConcepts.reduce((sum, concept) => sum + (conceptAmounts[concept.code] ?? concept.amount), 0)

  function handleSimulateSync() {
    clearPendingSyncOps()
    refreshSyncStatus()
    setSyncFeedback('Cola local de sincronizacion marcada como enviada.')
  }

  async function handleSyncNow() {
    setSyncing(true)
    try {
      const result = await syncAll()
      refreshSyncStatus()
      if (result.pulled > 0 || result.sent > 0) {
        await loadData()
      }
      setSyncFeedback(result.message)
    } finally {
      setSyncing(false)
    }
  }

  async function handleExportSep() {
    if (typeof appApi.preRegistrations?.exportSep !== 'function') {
      setControlFeedback('La exportacion SEP no esta disponible en este modo.')
      return
    }

    try {
      const result = await appApi.preRegistrations.exportSep({ status: 'VALIDADO_PARA_PAGO' })
      setControlFeedback(`Exportacion SEP generada (${result.exportedCount} registros): ${result.outputPath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo generar la exportacion SEP.'
      setControlFeedback(message)
    }
  }

  if (authLoading) {
    return <div className="auth-shell"><p>Cargando sesion...</p></div>
  }

  if (!authSession) {
    return (
      <div className="auth-shell">
        <section className="auth-hero">
          <div className="auth-hero-copy">
            <p className="auth-kicker">CBTA 44 Sistema</p>
            <h1>Operacion escolar y financiera en una sola ventanilla</h1>
            <p>
              Control Escolar e Ingresos Propios comparten el mismo seguimiento para inscripcion,
              pagos, grupos y ROC institucional.
            </p>
          </div>
          <div className="auth-hero-metrics">
            <article>
              <strong>Control Escolar</strong>
              <span>Captura, grupos y seguimiento documental</span>
            </article>
            <article>
              <strong>Ingresos Propios</strong>
              <span>Pagos de inscripcion, historial y ROC por lote</span>
            </article>
          </div>
        </section>

        <form className="auth-card" onSubmit={handleLogin}>
          <div className="auth-card-header">
            <p className="eyebrow">Acceso institucional</p>
            <h2>Iniciar sesion</h2>
            <p>EntrÃ¡ con tu usuario asignado para continuar con la operacion del plantel.</p>
          </div>
          <label className="form-field">
            <span>Usuario</span>
            <input
              placeholder="Ej. admin.1"
              value={authForm.username}
              onChange={(event) => setAuthForm((current) => ({ ...current, username: event.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Contrasena</span>
            <input
              type="password"
              placeholder="Tu contrasena"
              value={authForm.password}
              onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
            />
          </label>
          {authError ? <p className="feedback-banner">{authError}</p> : null}
          <button className="primary-button auth-submit" disabled={authSaving} type="submit">
            {authSaving ? 'Ingresando...' : 'Entrar al sistema'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className={isSidebarCollapsed ? 'shell collapsed' : 'shell'}>
      <aside className={isSidebarCollapsed ? 'sidebar collapsed' : 'sidebar'}>
        <div className="sidebar-brand">
          <div>
            <p className="eyebrow">CBTA 44 Sistema</p>
            <h1>Operacion escolar</h1>
            <p className="muted">Inscripciones, grupos y ROC oficial.</p>
          </div>
          <button className="sidebar-toggle" onClick={() => setIsSidebarCollapsed((current) => !current)} type="button">
            {isSidebarCollapsed ? 'Expandir' : 'Colapsar'}
          </button>
        </div>

        <section className="panel compact">
          <h2>Sesion</h2>
          <p className="muted">{authSession.displayName}</p>
          <p className="muted">{authSession.role}</p>
          <button className="secondary-button small-button" onClick={() => void handleLogout()} type="button">
            Cerrar sesion
          </button>
        </section>

        <nav className="nav">
          {canAccessScreen(authSession.role, 'control-escolar') ? <button
            className={screen === 'control-escolar' ? 'nav-item active' : 'nav-item'}
            data-short="CE"
            onClick={() => setScreen('control-escolar')}
          >
            <span>Control Escolar</span>
          </button> : null}
          {canAccessScreen(authSession.role, 'ingresos-propios') ? <button
            className={screen === 'ingresos-propios' ? 'nav-item active' : 'nav-item'}
            data-short="IP"
            onClick={() => setScreen('ingresos-propios')}
          >
            <span>Ingresos Propios</span>
          </button> : null}
          {canAccessScreen(authSession.role, 'configuracion') ? <button
            className={screen === 'configuracion' ? 'nav-item active' : 'nav-item'}
            data-short="CF"
            onClick={() => setScreen('configuracion')}
          >
            <span>Configuracion</span>
          </button> : null}
        </nav>

        <details className="panel compact secondary-details">
          <summary>Resumen rapido</summary>
          <p className="muted">Ficha entregada: {students.filter((item) => item.statusLabel === 'Ficha entregada').length}</p>
          <p className="muted">Sin grupo: {students.filter((item) => !item.groupLabel).length}</p>
          <p className="muted">No presentados: {students.filter((item) => item.statusLabel === 'No presentado').length}</p>
          <p className="muted">Pagos pendientes: {admissions.filter((item) => item.status === 'PAGADO_PENDIENTE_CAPTURA').length}</p>
        </details>

        <details className="panel compact secondary-details">
          <summary>Sincronizacion</summary>
          <p className="muted">Estado: {isOnline ? 'Online' : 'Offline'}</p>
          <p className="muted">Pendientes locales: {syncStatus.pendingTotal}</p>
          <p className="muted">
            Ultimo sync exitoso:{' '}
            {syncStatus.lastSuccessfulSyncAt ? new Date(syncStatus.lastSuccessfulSyncAt).toLocaleString() : 'Sin registro'}
          </p>
          {feedbackByScope.sync ? <p className="muted">Mensaje: {feedbackByScope.sync}</p> : null}
          {syncStatus.lastSyncError ? <p className="muted">Ultimo error: {syncStatus.lastSyncError}</p> : null}
          {syncStatus.lastSyncErrorState ? (
            <p className="muted">Error reintentable: {syncStatus.lastSyncErrorState.retryable ? 'Si' : 'No'}</p>
          ) : null}
          <button className="primary-button small-button" disabled={syncing} onClick={() => void handleSyncNow()} type="button">
            {syncing ? 'Sincronizando...' : 'Sincronizar ahora'}
          </button>
          <button className="secondary-button small-button" onClick={handleSimulateSync} type="button">
            Marcar pendientes como enviados
          </button>
        </details>
      </aside>

      <main className="content">
        {feedback ? <FloatingFeedbackToast message={feedback} onClose={() => setScopedFeedback(screen, null)} /> : null}
        {screen !== 'ingresos-propios' ? (
          <section className="panel compact">
            <div className="section-header">
              <div>
                <p className="eyebrow">Panel operativo</p>
                <h2>{screen === 'control-escolar' ? 'Control Escolar' : 'Configuracion'}</h2>
              </div>
              <span className="status-tag">{isOnline ? 'Online' : 'Offline'}</span>
            </div>
            <div className="button-row">
              <span className="chip">Alumnos validados: {validatedStudents.length}</span>
              <span className="chip">Sync pendientes: {syncStatus.pendingTotal}</span>
            </div>
          </section>
        ) : null}

        {isBrowserMode ? (
          <p className="feedback-banner">
            Estas en modo navegador. La captura y consulta funcionan con almacenamiento local de prueba.
            Para usar SQLite real y Prisma, abri la app desde Electron.
          </p>
        ) : null}

        {screen === 'control-escolar' ? (
          <ControlEscolarOverview
            feedback={feedback}
            form={form}
            students={students}
            preRegistrations={preRegistrations}
            admissions={admissions}
            captureQuery={captureQuery}
            activeAdmission={activeAdmission}
            editingStudentId={editingStudentId}
            saving={saving}
            studentsSectionRef={studentsSectionRef}
            captureSectionRef={captureSectionRef}
            onCancelEdit={handleCancelEdit}
            onEditStudent={handleEditStudent}
            onUpdatePreRegistrationStatus={handleUpdatePreRegistrationStatus}
            onSubmit={handleSubmit}
            onUpdateField={updateField}
            onSelectAdmissionForCapture={handleSelectAdmissionForCapture}
            onUpdateCaptureQuery={setCaptureQuery}
            onExportSep={handleExportSep}
            onReloadData={loadData}
            groupsApi={appApi.groups}
          />
        ) : screen === 'ingresos-propios' ? (
          <IngresosPropiosOverview
            concepts={concepts}
            cashPayments={cashPayments}
            loading={loading}
            receipts={receipts}
            allReceipts={allReceipts}
            suggestedRocNumber={suggestedRocNumber}
            savingReceipt={savingReceipt}
            selectedConcepts={selectedConcepts}
            selectedStudent={selectedStudent}
            students={validatedStudents}
            total={total}
            includeLifeInsurance={includeLifeInsurance}
            lifeInsuranceAmount={insuranceConcept ? conceptAmounts[insuranceConcept.code] ?? insuranceConcept.amount : 0}
            showLifeInsuranceOption={inscriptionSelected && Boolean(insuranceConcept)}
            conceptAmounts={conceptAmounts}
            conceptQuery={conceptQuery}
            feedback={feedbackByScope['ingresos-propios']}
            isOnline={isOnline}
            rocInitialNumber={rocInitialNumber}
            rocBatchMonth={rocBatchMonth}
            rocBatchYear={rocBatchYear}
            onChangeRocBatchMonth={setRocBatchMonth}
            onChangeRocBatchYear={setRocBatchYear}
            onCreateCashPayment={handleCreateCashPayment}
            onChangeConceptQuery={setConceptQuery}
            onGenerateBatchReceipts={handleGenerateBatchReceipts}
            onPrintMonthlyReceipts={handlePrintMonthlyReceipts}
            onReprintReceipt={handleReprintReceipt}
            onCancelReceipt={handleCancelReceipt}
            onSelectStudent={handleSelectIngresosStudent}
            onToggleLifeInsurance={handleToggleLifeInsurance}
            onToggleConcept={toggleConcept}
            onUpdateConceptAmount={updateConceptAmount}
          />
        ) : (
          <ConfiguracionTarifasOverview
            concepts={concepts}
            rocInitialNumber={rocInitialNumber}
            suggestedRocNumber={suggestedRocNumber}
            savingTariffCode={savingTariffCode}
            savingRocConfig={savingRocConfig}
            savingUserId={savingUserId}
            users={adminUsers}
            departments={departments}
            currentUserId={authSession.id}
            onUpdateTariff={handleUpdateTariff}
            onUpdateRocConfig={handleUpdateRocConfig}
            onUpdateSuggested={handleUpdateConceptSuggested}
            onCreateUser={handleCreateAdminUser}
            onUpdateUser={handleUpdateAdminUser}
            onResetUserPassword={handleResetAdminUserPassword}
          />
        )}

        <section className="panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Bitacora</p>
              <h2>Actividad reciente</h2>
            </div>
            <div className="button-row">
              <span className="status-tag">{recentAuditLogs.length} eventos recientes</span>
              <button
                className="secondary-button small-button"
                onClick={() => setIsRecentActivityCollapsed((current) => !current)}
                type="button"
              >
                {isRecentActivityCollapsed ? 'Mostrar actividad' : 'Ocultar actividad'}
              </button>
            </div>
          </div>

          <div className={isRecentActivityCollapsed ? 'receipt-history collapsed' : 'receipt-history'}>
            {recentAuditLogs.length === 0 ? <p className="empty-state">Todavia no hay actividad registrada.</p> : null}
            {!isRecentActivityCollapsed ? recentAuditLogs.map((log) => (
              <article className="history-card" key={log.id}>
                <strong>{log.action}</strong>
                <span>{log.actorName}</span>
                <span>{new Date(log.createdAt).toLocaleString('es-MX')}</span>
                <em>{log.detail || `${log.entityType} ${log.entityId}`}</em>
              </article>
            )) : null}
          </div>
        </section>
      </main>
    </div>
  )
}

type ConfiguracionTarifasProps = {
  concepts: ChargeConceptSummary[]
  rocInitialNumber: string
  suggestedRocNumber: string
  savingTariffCode: string | null
  savingRocConfig: boolean
  savingUserId: string | null
  users: UserSummary[]
  departments: DepartmentSummary[]
  currentUserId: string
  onUpdateTariff: (code: string, amount: number, periodLabel: string) => Promise<void>
  onUpdateRocConfig: (initialRocNumber: string) => Promise<void>
  onUpdateSuggested: (code: string, isSuggested: boolean) => Promise<void>
  onCreateUser: (input: UserCreateInput) => Promise<void>
  onUpdateUser: (userId: string, input: UserUpdateInput) => Promise<void>
  onResetUserPassword: (userId: string, password: string) => Promise<void>
}

function getOutputFileName(outputPath: string) {
  const parts = outputPath.split(/[\\/]/)
  return parts[parts.length - 1] || outputPath
}

function normalizeSheetCell(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeSheetUpper(value: unknown) {
  return normalizeSheetCell(value).toUpperCase()
}

function normalizeSheetHeader(value: unknown) {
  return normalizeSheetCell(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function pickSheetValue(row: Record<string, unknown>, aliases: string[]) {
  for (const [rawKey, rawValue] of Object.entries(row)) {
    if (aliases.includes(normalizeSheetHeader(rawKey))) {
      return rawValue
    }
  }

  return ''
}

function normalizeImportedGroupLabel(value: unknown) {
  const normalized = normalizeSheetUpper(value)
  if (/^[A-Z]$/.test(normalized)) {
    return `1${normalized}`
  }
  if (/^1[A-Z]$/.test(normalized)) {
    return normalized
  }
  return normalized
}

async function pickRosterWorkbookFile() {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xls'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

async function parseRosterWorkbook(file: File) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const rows: GroupRosterImportRow[] = []
  const issues: string[] = []
  let skippedCount = 0

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const populatedCells = Object.keys(sheet)
      .filter((key) => !key.startsWith('!'))
      .map((key) => XLSX.utils.decode_cell(key))
    if (populatedCells.length === 0) {
      continue
    }

    const range = populatedCells.reduce(
      (acc, cell) => ({
        s: {
          r: Math.min(acc.s.r, cell.r),
          c: Math.min(acc.s.c, cell.c),
        },
        e: {
          r: Math.max(acc.e.r, cell.r),
          c: Math.max(acc.e.c, cell.c),
        },
      }),
      {
        s: { r: populatedCells[0].r, c: populatedCells[0].c },
        e: { r: populatedCells[0].r, c: populatedCells[0].c },
      },
    )

    const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', range })
    const wideHeaderIndex = sheetRows.findIndex((row) => {
      if (!Array.isArray(row)) return false
      const normalized = row.map((cell) => normalizeSheetHeader(cell))
      const folioCount = normalized.filter((cell) => cell === 'folio').length
      const groupCount = normalized.filter((cell) => cell === 'grupo').length
      return folioCount >= 2 && groupCount >= 2
    })

    if (wideHeaderIndex >= 0) {
      for (let rowIndex = wideHeaderIndex + 1; rowIndex < sheetRows.length; rowIndex += 1) {
        const row = Array.isArray(sheetRows[rowIndex]) ? sheetRows[rowIndex] : []
        let hasAnyValue = false
        for (let columnIndex = 0; columnIndex < row.length; columnIndex += 2) {
          const enrollmentNumber = normalizeSheetCell(row[columnIndex]) || null
          const groupLabel = normalizeImportedGroupLabel(row[columnIndex + 1])
          if (!enrollmentNumber && !groupLabel) {
            continue
          }
          hasAnyValue = true
          if (!groupLabel || !enrollmentNumber) {
            skippedCount += 1
            issues.push(`Fila ${rowIndex + 1} en ${sheetName}: falta folio o grupo en uno de los pares de columnas.`)
            continue
          }
          rows.push({
            sheetName,
            rowNumber: rowIndex + 1,
            groupLabel,
            enrollmentNumber,
            curp: null,
          })
        }
        if (!hasAnyValue) {
          continue
        }
      }
      continue
    }

    const headerRowIndex = sheetRows.findIndex((row) => Array.isArray(row) && row.some((cell) => {
      const header = normalizeSheetHeader(cell)
      return GROUP_COLUMN_ALIASES.includes(header) || header === 'columna1' || ENROLLMENT_COLUMN_ALIASES.includes(header) || CURP_COLUMN_ALIASES.includes(header)
    }))
    if (headerRowIndex < 0) {
      continue
    }

    const headers = (Array.isArray(sheetRows[headerRowIndex]) ? sheetRows[headerRowIndex] : []).map((cell) => normalizeSheetCell(cell))
    for (let rowIndex = headerRowIndex + 1; rowIndex < sheetRows.length; rowIndex += 1) {
      const rawRow = Array.isArray(sheetRows[rowIndex]) ? sheetRows[rowIndex] : []
      const row = Object.fromEntries(headers.map((header, index) => [header, rawRow[index] ?? '']))
      const rowNumber = rowIndex + 1
      const groupLabel = normalizeImportedGroupLabel(pickSheetValue(row, [...GROUP_COLUMN_ALIASES, 'columna1'])) || normalizeImportedGroupLabel(sheetName)
      const enrollmentNumber = normalizeSheetCell(pickSheetValue(row, ENROLLMENT_COLUMN_ALIASES)) || null
      const curp = normalizeSheetUpper(pickSheetValue(row, CURP_COLUMN_ALIASES)) || null

      if (!groupLabel && !enrollmentNumber && !curp) {
        continue
      }

      if (!groupLabel) {
        skippedCount += 1
        issues.push(`Fila ${rowNumber} en ${sheetName}: falta Grupo.`)
        continue
      }

      if (!enrollmentNumber && !curp) {
        skippedCount += 1
        issues.push(`Fila ${rowNumber} en ${sheetName}: agrega CURP o Folio interno.`)
        continue
      }

      rows.push({
        sheetName,
        rowNumber,
        groupLabel,
        enrollmentNumber,
        curp,
      })
    }
  }

  return { rows, skippedCount, issues }
}

function extractOutputFileNameFromFeedback(message: string) {
  const match = message.match(/Archivo:\s*([^.\n]+\.xlsx)/i)
  return match ? getOutputFileName(match[1].trim()) : null
}

function normalizeFeedbackMessage(message: string) {
  return message.replace(/\s*Archivo:\s*([^.\n]+\.xlsx)\.?/i, '').trim()
}

type FloatingFeedbackToastProps = {
  message: string
  onClose: () => void
}

function FloatingFeedbackToast({ message, onClose }: FloatingFeedbackToastProps) {
  const isError = /(no se pudo|error|fall[oÃ³])/i.test(message)
  const fileName = extractOutputFileNameFromFeedback(message)
  const title = isError
    ? 'Hay que revisar esta operacion'
    : fileName
      ? 'ROC mensual generado correctamente'
      : 'Operacion registrada'

  return (
    <article className={isError ? 'feedback-toast feedback-toast-error' : 'feedback-toast'} role="status">
      <div className="feedback-card-header">
        <strong>{title}</strong>
        <div className="feedback-toast-actions">
          <span className={isError ? 'status-tag status-tag-danger' : 'status-tag'}>
            {isError ? 'Error' : 'Listo'}
          </span>
          <button aria-label="Cerrar notificacion" className="toast-close-button" onClick={onClose} type="button">
            Ã—
          </button>
        </div>
      </div>
      <p>{normalizeFeedbackMessage(message)}</p>
      {fileName ? (
        <div className="feedback-file-chip">
          <span>Archivo abierto:</span>
          <strong>{fileName}</strong>
        </div>
      ) : null}
    </article>
  )
}

function ConfiguracionTarifasOverview({
  concepts,
  rocInitialNumber,
  suggestedRocNumber,
  savingTariffCode,
  savingRocConfig,
  savingUserId,
  users,
  departments,
  currentUserId,
  onUpdateTariff,
  onUpdateRocConfig,
  onUpdateSuggested,
  onCreateUser,
  onUpdateUser,
  onResetUserPassword,
}: ConfiguracionTarifasProps) {
  const groupedConcepts = groupedSelectableConcepts(concepts)
  const [selectedGroupKey, setSelectedGroupKey] = useState(groupedConcepts[0]?.key ?? 'A000')
  const [rocInitialDraft, setRocInitialDraft] = useState(rocInitialNumber)
  const [configTab, setConfigTab] = useState<'tarifas' | 'usuarios'>('tarifas')

  useEffect(() => {
    setRocInitialDraft(rocInitialNumber)
  }, [rocInitialNumber])

  useEffect(() => {
    if (groupedConcepts.length === 0) {
      return
    }

    const exists = groupedConcepts.some((group) => group.key === selectedGroupKey)
    if (!exists) {
      setSelectedGroupKey(groupedConcepts[0].key)
    }
  }, [groupedConcepts, selectedGroupKey])

  const activeGroup = groupedConcepts.find((group) => group.key === selectedGroupKey) ?? groupedConcepts[0] ?? null

  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Configuracion</p>
          <h2>{configTab === 'tarifas' ? 'Tarifas y ROC' : 'Usuarios y departamentos'}</h2>
        </div>
        <span className="status-tag">Solo ADMIN</span>
      </div>

      <div className="config-tabs" role="tablist" aria-label="Configuracion">
        <button className={configTab === 'tarifas' ? 'config-tab active' : 'config-tab'} onClick={() => setConfigTab('tarifas')} type="button">
          Tarifas y ROC
        </button>
        <button className={configTab === 'usuarios' ? 'config-tab active' : 'config-tab'} onClick={() => setConfigTab('usuarios')} type="button">
          Usuarios y departamentos
        </button>
      </div>

      {configTab === 'usuarios' ? (
        <AdminUsersOverview
          currentUserId={currentUserId}
          departments={departments}
          savingUserId={savingUserId}
          users={users}
          onCreateUser={onCreateUser}
          onResetUserPassword={onResetUserPassword}
          onUpdateUser={onUpdateUser}
        />
      ) : (
        <>
      <article className="panel sub-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">ROC</p>
            <h3>Configuracion de consecutivo</h3>
          </div>
          <span className="status-tag">Se captura una vez</span>
        </div>
        <div className="button-row">
          <Field label="ROC inicial base">
            <input value={rocInitialDraft} onChange={(event) => setRocInitialDraft(event.target.value)} />
          </Field>
          <div className="selected-student-summary compact-summary">
            <div>
              <span className="detail-label">Configurado</span>
              <strong>{rocInitialNumber}</strong>
            </div>
            <div>
              <span className="detail-label">Siguiente sugerido</span>
              <strong>{suggestedRocNumber}</strong>
            </div>
          </div>
        </div>
        <div className="button-row">
          <button className="primary-button small-button" disabled={savingRocConfig} onClick={() => void onUpdateRocConfig(rocInitialDraft)} type="button">
            Guardar ROC inicial
          </button>
        </div>
      </article>

      <div className="tariff-groups">
        <div className="tariff-toolbar">
          <Field label="Grupo de claves">
            <select className="group-select" value={selectedGroupKey} onChange={(event) => setSelectedGroupKey(event.target.value)}>
              {groupedConcepts.map((group) => (
                <option key={group.key} value={group.key}>
                  {(group.header?.code ?? group.key) + ' - ' + (group.header?.name ?? group.key)}
                </option>
              ))}
            </select>
          </Field>
          <p className="tariff-help-text">
            {concepts.filter(isSelectableConcept).length} claves configurables cargadas. La tarifa del seguro de vida se cambia acÃ¡ y queda marcada como "Seguro de vida / No se imprime en ROC".
          </p>
        </div>

        {!activeGroup ? <p className="empty-state">No hay claves configurables para este catalogo.</p> : null}

        {activeGroup ? (
          <section className="concept-group-panel">
            <div className="concept-group-header static">
              <div>
                <strong>{activeGroup.header?.code ?? activeGroup.key}</strong>
                <h3>{activeGroup.header?.name ?? activeGroup.key}</h3>
                {activeGroup.header?.description ? <p>{activeGroup.header.description}</p> : null}
              </div>
              <span>{activeGroup.items.length} claves</span>
            </div>

            <div className="tariff-table-wrap">
              <table className="tariff-table">
                <thead>
                  <tr>
                    <th>Clave</th>
                    <th>Concepto</th>
                    <th>Tarifa</th>
                    <th>Periodo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {activeGroup.items.map((concept) => (
                    <TariffEditorRow
                      concept={concept}
                      isSaving={savingTariffCode === concept.code}
                      key={concept.code}
                      onSave={onUpdateTariff}
                      onToggleSuggested={onUpdateSuggested}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
        </>
      )}
    </section>
  )
}

type AdminUsersOverviewProps = {
  users: UserSummary[]
  departments: DepartmentSummary[]
  currentUserId: string
  savingUserId: string | null
  onCreateUser: (input: UserCreateInput) => Promise<void>
  onUpdateUser: (userId: string, input: UserUpdateInput) => Promise<void>
  onResetUserPassword: (userId: string, password: string) => Promise<void>
}

const roleOptions: Array<{ value: AppRole; label: string }> = [
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'CONTROL_ESCOLAR', label: 'Control Escolar' },
  { value: 'INGRESOS_PROPIOS', label: 'Ingresos Propios' },
]

function AdminUsersOverview({
  users,
  departments,
  currentUserId,
  savingUserId,
  onCreateUser,
  onUpdateUser,
  onResetUserPassword,
}: AdminUsersOverviewProps) {
  const activeDepartments = departments.filter((department) => department.isActive)
  const defaultDepartmentId = activeDepartments[0]?.id ?? ''
  const [draft, setDraft] = useState<UserCreateInput>({
    username: '',
    displayName: '',
    role: 'CONTROL_ESCOLAR',
    departmentId: defaultDepartmentId || null,
    isActive: true,
    password: '',
  })
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')

  useEffect(() => {
    setDraft((current) => current.departmentId ? current : { ...current, departmentId: defaultDepartmentId || null })
  }, [defaultDepartmentId])

  const editingUser = users.find((user) => user.id === editingUserId) ?? null

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await onCreateUser({
      ...draft,
      username: draft.username.trim().toLowerCase(),
      displayName: draft.displayName.trim(),
      departmentId: draft.departmentId || null,
    })
    setDraft({
      username: '',
      displayName: '',
      role: 'CONTROL_ESCOLAR',
      departmentId: defaultDepartmentId || null,
      isActive: true,
      password: '',
    })
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!resetPasswordUserId) return
    await onResetUserPassword(resetPasswordUserId, resetPassword)
    setResetPasswordUserId(null)
    setResetPassword('')
  }

  return (
    <div className="admin-users-layout">
      <form className="panel sub-panel admin-user-form" onSubmit={handleCreate}>
        <div className="section-header">
          <div>
            <p className="eyebrow">Nuevo usuario</p>
            <h3>Alta de acceso</h3>
          </div>
          <span className="status-tag">Clave temporal</span>
        </div>
        <div className="form-grid compact-form-grid">
          <Field label="Usuario">
            <input value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))} placeholder="ej. direccion.1" required />
          </Field>
          <Field label="Nombre visible">
            <input value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} required />
          </Field>
          <Field label="Rol">
            <select value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value as AppRole }))}>
              {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
          </Field>
          <Field label="Departamento">
            <select value={draft.departmentId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, departmentId: event.target.value || null }))}>
              <option value="">Sin departamento</option>
              {activeDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </Field>
          <Field label="Contrasena temporal">
            <input minLength={8} type="password" value={draft.password} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} required />
          </Field>
          <label className="checkbox-row admin-active-toggle">
            <input checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} type="checkbox" />
            Activo
          </label>
        </div>
        <div className="form-actions">
          <button className="primary-button" disabled={savingUserId === 'new'} type="submit">
            {savingUserId === 'new' ? 'Creando...' : 'Crear usuario'}
          </button>
        </div>
      </form>

      <section className="panel sub-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Usuarios</p>
            <h3>Accesos existentes</h3>
          </div>
          <span className="status-tag">{users.length} usuarios</span>
        </div>
        <div className="student-table-wrap">
          <table className="student-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Departamento</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.displayName}</td>
                  <td>{roleOptions.find((role) => role.value === user.role)?.label ?? user.role}</td>
                  <td>{user.departmentName ?? 'Sin departamento'}</td>
                  <td><span className={user.isActive ? 'status-tag' : 'status-tag status-tag-muted'}>{user.isActive ? 'Activo' : 'Inactivo'}</span></td>
                  <td>
                    <div className="button-row">
                      <button className="secondary-button small-button" onClick={() => setEditingUserId(user.id)} type="button">Editar</button>
                      <button className="tertiary-button small-button" onClick={() => setResetPasswordUserId(user.id)} type="button">Restablecer</button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 ? (
                <tr><td colSpan={6}>No hay usuarios registrados.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {editingUser ? (
        <EditUserModal
          currentUserId={currentUserId}
          departments={activeDepartments}
          isSaving={savingUserId === editingUser.id}
          user={editingUser}
          onClose={() => setEditingUserId(null)}
          onSubmit={onUpdateUser}
        />
      ) : null}

      {resetPasswordUserId ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <form className="modal-card checklist-modal" onSubmit={handleResetPassword}>
            <div className="section-header">
              <div>
                <p className="eyebrow">Contrasena</p>
                <h2>Restablecer acceso</h2>
              </div>
              <button className="secondary-button small-button" onClick={() => setResetPasswordUserId(null)} type="button">Cerrar</button>
            </div>
            <Field label="Nueva contrasena temporal">
              <input minLength={8} type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} required />
            </Field>
            <div className="form-actions">
              <button className="primary-button" disabled={savingUserId === resetPasswordUserId} type="submit">
                {savingUserId === resetPasswordUserId ? 'Guardando...' : 'Restablecer contrasena'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

type EditUserModalProps = {
  user: UserSummary
  departments: DepartmentSummary[]
  currentUserId: string
  isSaving: boolean
  onClose: () => void
  onSubmit: (userId: string, input: UserUpdateInput) => Promise<void>
}

function EditUserModal({ user, departments, currentUserId, isSaving, onClose, onSubmit }: EditUserModalProps) {
  const [draft, setDraft] = useState<UserUpdateInput>({
    displayName: user.displayName,
    role: user.role,
    departmentId: user.departmentId,
    isActive: user.isActive,
  })
  const isSelf = user.id === currentUserId

  useEffect(() => {
    setDraft({
      displayName: user.displayName,
      role: user.role,
      departmentId: user.departmentId,
      isActive: user.isActive,
    })
  }, [user])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await onSubmit(user.id, { ...draft, displayName: draft.displayName.trim(), departmentId: draft.departmentId || null })
    onClose()
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <form className="modal-card checklist-modal" onSubmit={handleSubmit}>
        <div className="section-header">
          <div>
            <p className="eyebrow">Editar usuario</p>
            <h2>{user.username}</h2>
          </div>
          <button className="secondary-button small-button" onClick={onClose} type="button">Cerrar</button>
        </div>
        <div className="form-grid compact-form-grid">
          <Field label="Nombre visible">
            <input value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} required />
          </Field>
          <Field label="Rol">
            <select value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value as AppRole }))}>
              {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
          </Field>
          <Field label="Departamento">
            <select value={draft.departmentId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, departmentId: event.target.value || null }))}>
              <option value="">Sin departamento</option>
              {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </Field>
          <label className="checkbox-row admin-active-toggle">
            <input checked={draft.isActive} disabled={isSelf && user.role === 'ADMIN'} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} type="checkbox" />
            Activo
          </label>
        </div>
        {isSelf ? <p className="feedback-banner">Estas editando tu propio usuario. El sistema protege que quede al menos un admin activo.</p> : null}
        <div className="form-actions">
          <button className="primary-button" disabled={isSaving} type="submit">
            {isSaving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  )
}

type TariffEditorRowProps = {
  concept: ChargeConceptSummary
  isSaving: boolean
  onSave: (code: string, amount: number, periodLabel: string) => Promise<void>
  onToggleSuggested: (code: string, isSuggested: boolean) => Promise<void>
}

function TariffEditorRow({ concept, isSaving, onSave, onToggleSuggested }: TariffEditorRowProps) {
  const [amount, setAmount] = useState(String(concept.amount))
  const [periodLabel, setPeriodLabel] = useState(concept.periodLabel)

  useEffect(() => {
    setAmount(String(concept.amount))
    setPeriodLabel(concept.periodLabel)
  }, [concept.amount, concept.periodLabel])

  return (
    <tr>
      <td>{concept.code}</td>
      <td>
        {concept.name}
        {concept.isLifeInsurance ? <div><small>Seguro de vida</small></div> : null}
        {concept.excludeFromRoc ? <div><small>No se imprime en ROC</small></div> : null}
      </td>
      <td>
        <input className="table-input" type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </td>
      <td>
        <input className="table-input" value={periodLabel} onChange={(event) => setPeriodLabel(event.target.value)} />
      </td>
      <td>
        <div className="button-row">
          <button
            className="primary-button small-button"
            disabled={isSaving}
            onClick={() => void onSave(concept.code, Number(amount || 0), periodLabel)}
            type="button"
          >
            {isSaving ? '...' : 'Guardar'}
          </button>
          <button
            className={concept.isSuggested ? 'secondary-button small-button' : 'tertiary-button small-button'}
            disabled={isSaving}
            onClick={() => void onToggleSuggested(concept.code, !concept.isSuggested)}
            type="button"
          >
            {concept.isSuggested ? 'Quitar sugerida' : 'Marcar sugerida'}
          </button>
        </div>
      </td>
    </tr>
  )
}

type ControlEscolarProps = {
  form: StudentFormInput
  students: StudentSummary[]
  preRegistrations: PreRegistrationSummary[]
  admissions: AdmissionSummary[]
  captureQuery: string
  activeAdmission: AdmissionSummary | null
  editingStudentId: string | null
  saving: boolean
  feedback: string | null
  studentsSectionRef: MutableRefObject<HTMLElement | null>
  captureSectionRef: MutableRefObject<HTMLElement | null>
  onCancelEdit: () => void
  onEditStudent: (studentId: string) => Promise<void>
  onUpdatePreRegistrationStatus: (
    preRegistrationId: string,
    status: PreRegistrationStatusUpdate,
  ) => Promise<void>
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onUpdateField: <K extends keyof StudentFormInput>(field: K, value: StudentFormInput[K]) => void
  onSelectAdmissionForCapture: (admission: AdmissionSummary) => Promise<void>
  onUpdateCaptureQuery: (value: string) => void
  onExportSep: () => Promise<void>
  onReloadData: () => Promise<void>
  groupsApi: Window['cbta']['groups']
}

function ControlEscolarOverview({
  form,
  students,
  preRegistrations,
  admissions,
  captureQuery,
  activeAdmission,
  editingStudentId,
  saving,
  feedback,
  studentsSectionRef,
  captureSectionRef,
  onCancelEdit,
  onEditStudent,
  onUpdatePreRegistrationStatus,
  onSubmit,
  onUpdateField,
  onSelectAdmissionForCapture,
  onUpdateCaptureQuery,
  onExportSep,
  onReloadData,
  groupsApi,
}: ControlEscolarProps) {
  const [captureTab, setCaptureTab] = useState<'fichas' | 'formulario'>('fichas')
  const [operationsTab, setOperationsTab] = useState<'captura' | 'bandeja' | 'grupos' | 'inscripcion' | 'alumnos'>('alumnos')
  const [studentQuery, setStudentQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [studentPage, setStudentPage] = useState(1)
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null)
  const [selectedPreRegistrationId, setSelectedPreRegistrationId] = useState<string | null>(null)
  const [groupStats, setGroupStats] = useState<GroupStat[]>([])
  const [groupPreviewRows, setGroupPreviewRows] = useState<GroupPreviewRow[]>([])
  const [isPreviewStats, setIsPreviewStats] = useState(false)
  const [previewGroupFilter, setPreviewGroupFilter] = useState('all')
  const [previewSexFilter, setPreviewSexFilter] = useState('all')
  const [previewPage, setPreviewPage] = useState(1)
  const [moveStudentId, setMoveStudentId] = useState('')
  const [moveGroupId, setMoveGroupId] = useState('')
  const [moveReason, setMoveReason] = useState('')
  const [noShowStudentId, setNoShowStudentId] = useState('')
  const [noShowReason, setNoShowReason] = useState('')
  const [selectedChecklistStudentId, setSelectedChecklistStudentId] = useState('')
  const [requirementChecklist, setRequirementChecklist] = useState<StudentRequirementChecklist | null>(null)
  const [savingChecklist, setSavingChecklist] = useState(false)
  const [checklistFeedback, setChecklistFeedback] = useState<string | null>(null)
  const [isChecklistModalOpen, setIsChecklistModalOpen] = useState(false)
  const [inscriptionQuery, setInscriptionQuery] = useState('')
  const [inscriptionPage, setInscriptionPage] = useState(1)
  const normalizedStudentQuery = studentQuery.trim().toLowerCase()
  const filteredStudents = students.filter((student) => {
    const haystack = `${student.enrollmentNumber} ${student.fullName} ${student.curp}`.toLowerCase()
    const matchesQuery = normalizedStudentQuery.length === 0 || haystack.includes(normalizedStudentQuery)
    const matchesStatus = statusFilter === 'all' || student.statusLabel === statusFilter
    return matchesQuery && matchesStatus
  })
  const totalStudentPages = Math.max(1, Math.ceil(filteredStudents.length / CONTROL_STUDENTS_PER_PAGE))
  const paginatedStudents = filteredStudents.slice(
    (studentPage - 1) * CONTROL_STUDENTS_PER_PAGE,
    studentPage * CONTROL_STUDENTS_PER_PAGE,
  )

  useEffect(() => {
    setStudentPage(1)
  }, [normalizedStudentQuery, statusFilter])

  useEffect(() => {
    if (studentPage > totalStudentPages) {
      setStudentPage(totalStudentPages)
    }
  }, [studentPage, totalStudentPages])

  useEffect(() => {
    setPreviewPage(1)
  }, [previewGroupFilter, previewSexFilter, groupPreviewRows.length])

  useEffect(() => {
    if (preRegistrations.length > 0 && !selectedPreRegistrationId) {
      setSelectedPreRegistrationId(preRegistrations[0].id)
    }
  }, [preRegistrations, selectedPreRegistrationId])

  const selectedPreRegistration =
    preRegistrations.find((item) => item.id === selectedPreRegistrationId) ?? preRegistrations[0] ?? null

  const normalizedCaptureQuery = captureQuery.trim().toLowerCase()
  const filteredAdmissions = admissions.filter((item) => {
    if (!normalizedCaptureQuery) return true
    const haystack = `${item.folio} ${item.curp} ${item.fullName}`.toLowerCase()
    return haystack.includes(normalizedCaptureQuery)
  })
  const previewGroups = Array.from(new Set(groupPreviewRows.map((row) => row.groupLabel))).sort((a, b) => a.localeCompare(b))
  const filteredPreviewRows = groupPreviewRows.filter((row) => {
    const matchesGroup = previewGroupFilter === 'all' || row.groupLabel === previewGroupFilter
    const normalizedSex = row.sex.trim().toUpperCase()
    const matchesSex =
      previewSexFilter === 'all' ||
      (previewSexFilter === 'H' && normalizedSex.startsWith('H')) ||
      (previewSexFilter === 'M' && (normalizedSex.startsWith('M') || normalizedSex.startsWith('F')))
    return matchesGroup && matchesSex
  })
  const previewTotalPages = Math.max(1, Math.ceil(filteredPreviewRows.length / 20))
  const paginatedPreviewRows = filteredPreviewRows.slice((previewPage - 1) * 20, previewPage * 20)
  const normalizedInscriptionQuery = inscriptionQuery.trim().toLowerCase()
  const filteredInscriptionStudents = students.filter((student) => {
    const haystack = `${student.enrollmentNumber} ${student.fullName} ${student.curp}`.toLowerCase()
    return normalizedInscriptionQuery.length === 0 || haystack.includes(normalizedInscriptionQuery)
  })
  const totalInscriptionPages = Math.max(1, Math.ceil(filteredInscriptionStudents.length / CONTROL_STUDENTS_PER_PAGE))
  const paginatedInscriptionStudents = filteredInscriptionStudents.slice(
    (inscriptionPage - 1) * CONTROL_STUDENTS_PER_PAGE,
    inscriptionPage * CONTROL_STUDENTS_PER_PAGE,
  )

  useEffect(() => {
    if (previewPage > previewTotalPages) {
      setPreviewPage(previewTotalPages)
    }
  }, [previewPage, previewTotalPages])

  useEffect(() => {
    setInscriptionPage(1)
  }, [normalizedInscriptionQuery])

  useEffect(() => {
    if (inscriptionPage > totalInscriptionPages) {
      setInscriptionPage(totalInscriptionPages)
    }
  }, [inscriptionPage, totalInscriptionPages])

  async function handleSelectAdmissionRow(admission: AdmissionSummary) {
    await onSelectAdmissionForCapture(admission)
    setCaptureTab('formulario')
    setTimeout(() => {
      captureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  async function handleStartEditStudent(studentId: string) {
    await onEditStudent(studentId)
    setCaptureTab('formulario')
    setTimeout(() => {
      captureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  async function refreshGroupStats() {
    if (!groupsApi?.stats) return
    const stats = await groupsApi.stats({ schoolCycle: form.schoolCycle })
    setGroupStats(stats)
  }

  async function handleAutoAssign() {
    if (!groupsApi?.autoAssign) return
    await groupsApi.autoAssign({ schoolCycle: form.schoolCycle })
    setIsPreviewStats(false)
    setGroupPreviewRows([])
    setPreviewGroupFilter('all')
    setPreviewSexFilter('all')
    await refreshGroupStats()
    await onReloadData()
  }

  async function handlePreviewAssign() {
    if (!groupsApi?.preview) return
    const stats = await groupsApi.preview({ schoolCycle: form.schoolCycle })
    setGroupStats(stats)
    if (groupsApi?.previewRoster) {
      const rows = await groupsApi.previewRoster({ schoolCycle: form.schoolCycle })
      setGroupPreviewRows(rows)
    }
    setIsPreviewStats(true)
  }

  async function handleConfirmGroups() {
    if (!groupsApi?.confirmAssignment) return
    await groupsApi.confirmAssignment({ schoolCycle: form.schoolCycle })
    await refreshGroupStats()
    await onReloadData()
  }

  async function handleManualMove() {
    if (!groupsApi?.manualReassign || !moveStudentId || !moveGroupId) return
    await groupsApi.manualReassign({ studentId: moveStudentId, toGroupId: moveGroupId, reason: moveReason || 'Ajuste operativo' })
    await refreshGroupStats()
    await onReloadData()
  }

  async function handleNoShow() {
    if (!groupsApi?.markNoShow || !noShowStudentId) return
    await groupsApi.markNoShow({ studentId: noShowStudentId, reason: noShowReason || 'No se presento a inscripcion' })
    await refreshGroupStats()
    await onReloadData()
  }

  async function handleImportAssignedRoster() {
    if (!groupsApi?.importAssignedRoster) return
    try {
      const file = await pickRosterWorkbookFile()
      if (!file) {
        setChecklistFeedback('Importacion cancelada.')
        return
      }

      const parsed = await parseRosterWorkbook(file)
      if (parsed.rows.length === 0) {
        setChecklistFeedback('El archivo no contiene filas validas para importar grupos.')
        return
      }

      const result = await groupsApi.importAssignedRoster({
        schoolCycle: form.schoolCycle,
        sourcePath: file.name,
        rows: parsed.rows,
      })
      const allIssues = [...parsed.issues, ...result.issues].slice(0, 12)
      const issuesSuffix = allIssues.length > 0 ? ` Avisos: ${allIssues.join(' | ')}` : ''
      const sourceFile = result.sourcePath ? getOutputFileName(result.sourcePath) : file.name
      setChecklistFeedback(
        `Importacion completada desde ${sourceFile}: ${result.importedCount} asignaciones, ${result.createdGroupCount} grupos nuevos, ${result.unmatchedCount} sin match, ${result.skippedCount + parsed.skippedCount} filas omitidas.${issuesSuffix}`,
      )
      await refreshGroupStats()
      await onReloadData()
    } catch (error) {
      setChecklistFeedback(error instanceof Error ? `No se pudo importar el Excel: ${error.message}` : 'No se pudo importar el Excel.')
    }
  }

  async function handleExportAssignedRoster() {
    if (!groupsApi?.exportAssignedRoster) return
    const result = await groupsApi.exportAssignedRoster({ schoolCycle: form.schoolCycle })
    setChecklistFeedback(`Listado exportado (${result.exportedCount} alumnos): ${result.outputPath}`)
  }

  async function handlePrintAssignedRoster() {
    if (!groupsApi?.printAssignedRoster) return
    await groupsApi.printAssignedRoster({ schoolCycle: form.schoolCycle })
    setChecklistFeedback('Listado de grupos enviado a impresion.')
  }

  async function handleLoadRequirementChecklist(studentId: string) {
    if (!window.cbta?.students?.getRequirementChecklist) return
    const checklist = await window.cbta.students.getRequirementChecklist(studentId)
    setSelectedChecklistStudentId(studentId)
    setRequirementChecklist(checklist)
    setChecklistFeedback(null)
    setIsChecklistModalOpen(true)
  }

  function handleCloseChecklistModal() {
    setIsChecklistModalOpen(false)
  }

  function handleChecklistItemChange(index: number, patch: Partial<StudentRequirementChecklist['items'][number]>) {
    setRequirementChecklist((current) => {
      if (!current) return current
      const items = current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        return { ...item, ...patch }
      })
      return { ...current, items }
    })
  }

  async function handleSaveRequirementChecklist() {
    if (!window.cbta?.students?.saveRequirementChecklist || !selectedChecklistStudentId || !requirementChecklist) return
    setSavingChecklist(true)
    try {
      const payload: SaveStudentRequirementChecklistInput = {
        items: requirementChecklist.items.map((item) => ({
          requirementId: item.requirementId,
          isDelivered: item.isDelivered,
          missingJustification: item.missingJustification,
          deadlineAt: item.deadlineAt,
          notes: item.notes,
        })),
      }
      const saved = await window.cbta.students.saveRequirementChecklist(selectedChecklistStudentId, payload)
      setRequirementChecklist(saved)
      setChecklistFeedback('Checklist documental guardado correctamente.')
      await onReloadData()
      setIsChecklistModalOpen(false)
    } finally {
      setSavingChecklist(false)
    }
  }

  useEffect(() => {
    if (!isChecklistModalOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsChecklistModalOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isChecklistModalOpen])

  useEffect(() => {
    void refreshGroupStats()
  }, [form.schoolCycle])

  return (
    <>
      {captureTab === 'fichas' ? (
      <>
      <section className="panel compact">
        <div className="button-row">
          <button
            className={operationsTab === 'captura' ? 'primary-button small-button' : 'secondary-button small-button'}
            onClick={() => setOperationsTab('captura')}
            type="button"
          >
            Fichas
          </button>
          <button
            className={operationsTab === 'bandeja' ? 'primary-button small-button' : 'secondary-button small-button'}
            onClick={() => setOperationsTab('bandeja')}
            type="button"
          >
            Bandeja
          </button>
          <button
            className={operationsTab === 'grupos' ? 'primary-button small-button' : 'secondary-button small-button'}
            onClick={() => setOperationsTab('grupos')}
            type="button"
          >
            Asignacion
          </button>
          <button
            className={operationsTab === 'inscripcion' ? 'primary-button small-button' : 'secondary-button small-button'}
            onClick={() => setOperationsTab('inscripcion')}
            type="button"
          >
            Inscripcion
          </button>
          <button
            className={operationsTab === 'alumnos' ? 'primary-button small-button' : 'secondary-button small-button'}
            onClick={() => setOperationsTab('alumnos')}
            type="button"
          >
            Alumnos
          </button>
        </div>
      </section>

      {operationsTab === 'captura' ? (
      <section className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Control Escolar</p>
            <h2>Captura de fichas</h2>
          </div>
          <span className="status-tag">Seleccion en tiempo real</span>
        </div>
        <div className="student-search-row">
          <Field className="span-2" label="Buscar pago">
            <input placeholder="Folio o CURP" value={captureQuery} onChange={(event) => onUpdateCaptureQuery(event.target.value)} />
          </Field>
        </div>
        {activeAdmission ? (
          <p className="feedback-banner">
            Captura activa para folio {activeAdmission.folio} ({activeAdmission.curp}) - estatus {activeAdmission.status}
          </p>
        ) : null}

        <AdmissionCaptureTable
          activeAdmissionId={activeAdmission?.id ?? null}
          admissions={filteredAdmissions}
          onSelect={handleSelectAdmissionRow}
        />
        {filteredAdmissions.length === 0 ? <p className="empty-state">No hay pagos que coincidan con la busqueda.</p> : null}
      </section>
      ) : null}

      {operationsTab === 'bandeja' ? (
      <PreRegistrationInboxPanel
        onExportSep={onExportSep}
        onSelectPreRegistration={setSelectedPreRegistrationId}
        onUpdateStatus={onUpdatePreRegistrationStatus}
        preRegistrations={preRegistrations}
        selectedPreRegistration={selectedPreRegistration}
      />
      ) : null}

      {operationsTab === 'grupos' ? (
      <section className="panel">
        <div className="section-header">
          <div><p className="eyebrow">Control Escolar</p><h2>Asignacion de grupos</h2></div>
          <span className="status-tag">{isPreviewStats ? 'Vista previa' : 'Nuevo ingreso MATUTINO'}</span>
        </div>
          <div className="button-row">
            <button className="secondary-button small-button" onClick={() => void handlePreviewAssign()} type="button">Ver vista previa</button>
            <button className="primary-button small-button" onClick={() => void handleAutoAssign()} type="button">Generar asignacion</button>
            <button className="secondary-button small-button" onClick={() => void handleConfirmGroups()} type="button">Confirmar asignacion</button>
            <button className="secondary-button small-button" onClick={() => void handleImportAssignedRoster()} type="button">Importar Excel</button>
            <button className="secondary-button small-button" onClick={() => void handleExportAssignedRoster()} type="button">Exportar Excel</button>
            <button className="secondary-button small-button" onClick={() => void handlePrintAssignedRoster()} type="button">Imprimir listado</button>
          </div>
          <p className="table-summary">La importacion acepta el Excel exportado por este listado o cualquier archivo con columnas Grupo y CURP o Folio interno.</p>
          {checklistFeedback ? <p className="feedback-banner">{checklistFeedback}</p> : null}
        {isPreviewStats ? <p className="table-summary">Previsualizacion calculada sin guardar cambios.</p> : null}
        <div className="student-table-wrap">
          <table className="student-table"><thead><tr><th>Grupo</th><th>Asignados</th><th>Cupo</th><th>Alto</th><th>Medio</th><th>Bajo</th><th>H</th><th>M</th><th>Balance sexo</th><th>Balance promedio</th></tr></thead><tbody>
            {groupStats.map((stat) => <tr key={stat.groupId}><td>{stat.label}</td><td>{stat.assignedCount}</td><td>{stat.capacity}</td><td>{stat.bands.alto}</td><td>{stat.bands.medio}</td><td>{stat.bands.bajo}</td><td>{stat.sex.hombre}</td><td>{stat.sex.mujer}</td><td>{groupSexBalanceLabel(stat)}</td><td>{groupBandBalanceLabel(stat)}</td></tr>)}
          </tbody></table>
        </div>
        {isPreviewStats && groupPreviewRows.length > 0 ? (
          <>
            <p className="table-summary">Listado preliminar por grupo (sin confirmar).</p>
            <div className="student-search-row">
              <Field label="Grupo">
                <select className="group-select" value={previewGroupFilter} onChange={(event) => setPreviewGroupFilter(event.target.value)}>
                  <option value="all">Todos</option>
                  {previewGroups.map((group) => (
                    <option key={group} value={group}>{group}</option>
                  ))}
                </select>
              </Field>
              <Field label="Sexo">
                <select className="group-select" value={previewSexFilter} onChange={(event) => setPreviewSexFilter(event.target.value)}>
                  <option value="all">Todos</option>
                  <option value="H">Hombre</option>
                  <option value="M">Mujer</option>
                </select>
              </Field>
            </div>
            <div className="student-table-wrap">
              <table className="student-table">
                <thead>
                  <tr>
                    <th>Grupo</th>
                    <th>Folio interno</th>
                    <th>Alumno</th>
                    <th>CURP</th>
                    <th>Sexo</th>
                    <th>Promedio</th>
                    <th>Banda</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPreviewRows.map((row) => (
                    <tr key={`${row.groupLabel}-${row.enrollmentNumber}`}>
                      <td>{row.groupLabel}</td>
                      <td>{row.enrollmentNumber}</td>
                      <td>{row.fullName}</td>
                      <td>{row.curp}</td>
                      <td>{row.sex}</td>
                      <td>{row.secondaryAverage == null ? 'N/E' : row.secondaryAverage.toFixed(1)}</td>
                      <td>{row.averageBand.toUpperCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredPreviewRows.length > 20 ? (
              <div className="pagination-row">
                <button
                  className="secondary-button small-button"
                  disabled={previewPage === 1}
                  onClick={() => setPreviewPage((page) => Math.max(1, page - 1))}
                  type="button"
                >
                  Anterior
                </button>
                <span>Pagina {previewPage} de {previewTotalPages}</span>
                <button
                  className="secondary-button small-button"
                  disabled={previewPage === previewTotalPages}
                  onClick={() => setPreviewPage((page) => Math.min(previewTotalPages, page + 1))}
                  type="button"
                >
                  Siguiente
                </button>
              </div>
            ) : null}
          </>
        ) : null}
        <div className="form-grid">
          <Field label="Alumno para mover">
            <select className="group-select" value={moveStudentId} onChange={(event) => setMoveStudentId(event.target.value)}>
              <option value="">Selecciona alumno</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>{student.enrollmentNumber} - {student.fullName}</option>
              ))}
            </select>
          </Field>
          <Field label="Grupo destino">
            <select className="group-select" value={moveGroupId} onChange={(event) => setMoveGroupId(event.target.value)}>
              <option value="">Selecciona grupo</option>
              {groupStats.map((group) => (
                <option key={group.groupId} value={group.groupId}>{group.label} (cupo {group.assignedCount}/{group.capacity})</option>
              ))}
            </select>
          </Field>
          <Field className="span-2" label="Motivo"><input value={moveReason} onChange={(event) => setMoveReason(event.target.value)} placeholder="Motivo de reasignacion" /></Field>
          <button className="secondary-button small-button" onClick={() => void handleManualMove()} type="button">Reasignar manual</button>
        </div>
        <div className="form-grid">
          <Field label="Alumno no-show">
            <select className="group-select" value={noShowStudentId} onChange={(event) => setNoShowStudentId(event.target.value)}>
              <option value="">Selecciona alumno</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>{student.enrollmentNumber} - {student.fullName}</option>
              ))}
            </select>
          </Field>
          <Field className="span-2" label="Motivo no-show"><input value={noShowReason} onChange={(event) => setNoShowReason(event.target.value)} placeholder="No se presento" /></Field>
          <button className="secondary-button small-button" onClick={() => void handleNoShow()} type="button">Marcar no-show</button>
        </div>
      </section>
      ) : null}

      {operationsTab === 'inscripcion' ? (
      <section className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Control Escolar</p>
            <h2>Inscripcion documental</h2>
          </div>
          <span className="status-tag">Checklist y plazo de entrega</span>
        </div>
        {checklistFeedback ? <p className="feedback-banner">{checklistFeedback}</p> : null}
        <div className="student-search-row">
          <Field className="span-2" label="Buscar alumno">
            <input
              placeholder="Buscar por folio interno, CURP o nombre"
              value={inscriptionQuery}
              onChange={(event) => setInscriptionQuery(event.target.value)}
            />
          </Field>
        </div>
        <div className="student-table-wrap">
          <table className="student-table table-inscripcion-ce">
            <thead>
              <tr>
                <th>Folio interno</th>
                <th>Alumno</th>
                <th>Pago</th>
                <th>Documentacion</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paginatedInscriptionStudents.map((student) => (
                <tr key={`checklist-${student.id}`} className={selectedChecklistStudentId === student.id ? 'student-row active' : 'student-row'}>
                  <td><strong>{student.enrollmentNumber}</strong></td>
                  <td>{student.fullName}</td>
                  <td>{student.admissionPaid ? 'Pagado' : 'Pendiente'}</td>
                  <td>{student.documentationStatus}</td>
                  <td>
                    <button className="secondary-button small-button" onClick={() => void handleLoadRequirementChecklist(student.id)} type="button">
                      Revisar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredInscriptionStudents.length > CONTROL_STUDENTS_PER_PAGE ? (
          <div className="pagination-row">
            <button
              className="secondary-button small-button"
              disabled={inscriptionPage === 1}
              onClick={() => setInscriptionPage((page) => Math.max(1, page - 1))}
              type="button"
            >
              Anterior
            </button>
            <span>Pagina {inscriptionPage} de {totalInscriptionPages}</span>
            <button
              className="secondary-button small-button"
              disabled={inscriptionPage === totalInscriptionPages}
              onClick={() => setInscriptionPage((page) => Math.min(totalInscriptionPages, page + 1))}
              type="button"
            >
              Siguiente
            </button>
          </div>
        ) : null}
        {filteredInscriptionStudents.length === 0 ? (
          <p className="empty-state">No hay alumnos que coincidan con la busqueda.</p>
        ) : null}
      </section>
      ) : null}

      {operationsTab === 'alumnos' ? (
      <section className="panel" ref={studentsSectionRef}>
        <div className="section-header">
          <div>
            <p className="eyebrow">Control Escolar</p>
            <h2>Alumnos registrados</h2>
          </div>
          <span className="status-tag">{students.length} registrados</span>
        </div>

        {students.length === 0 ? <p className="empty-state">Todavia no hay alumnos registrados.</p> : null}

        {students.length > 0 ? (
          <div className="student-search-row">
            <Field className="span-2" label="Buscar alumno">
              <input
                placeholder="Buscar por folio interno, nombre o CURP"
                value={studentQuery}
                onChange={(event) => setStudentQuery(event.target.value)}
              />
            </Field>
            <Field label="Estatus">
              <select className="group-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">Todos</option>
                <option value="Ficha entregada">Ficha entregada</option>
                <option value="Inscrito">Inscrito</option>
                <option value="Baja temporal">Baja temporal</option>
                <option value="Baja definitiva">Baja definitiva</option>
                <option value="Portabilidad">Portabilidad</option>
                <option value="Recursador">Recursador</option>
              </select>
            </Field>
          </div>
        ) : null}

        {students.length > 0 ? (
          <p className="table-summary">
            {filteredStudents.length} alumnos encontrados. Mostrando hasta {CONTROL_STUDENTS_PER_PAGE} por pagina.
          </p>
        ) : null}

        {paginatedStudents.length > 0 ? (
          <div className="student-table-wrap">
            <table className="student-table">
              <thead>
                <tr>
                  <th>Folio interno</th>
                  <th>Alumno</th>
                  <th>CURP</th>
                  <th>Grado</th>
                  <th>Grupo</th>
                  <th>Estatus</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paginatedStudents.map((student) => {
                  const active = editingStudentId === student.id
                  const expanded = expandedStudentId === student.id
                  const guardianName = student.guardianFullName?.trim().length ? student.guardianFullName : 'Sin tutor capturado'
                  const guardianPhone = student.guardianPhone?.trim().length ? student.guardianPhone : 'Sin telefono de tutor'
                  const rfc = student.rfc?.trim().length ? student.rfc : 'Sin RFC'
                  void rfc

                  return (
                    <Fragment key={student.id}>
                      <tr
                        className={active ? 'student-row active' : 'student-row'}
                        onClick={() => setExpandedStudentId(expanded ? null : student.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setExpandedStudentId(expanded ? null : student.id)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <td>
                          <strong>{student.enrollmentNumber}</strong>
                        </td>
                        <td>{student.fullName}</td>
                        <td>{student.curp}</td>
                        <td>{deriveGradeFromGroup(student.groupLabel)}</td>
                        <td>{student.groupLabel ?? 'Sin asignar'}</td>
                        <td>{student.statusLabel}</td>
                        <td className="student-actions-cell">
                          <button
                            className="secondary-button small-button"
                            onClick={(event) => {
                              event.stopPropagation()
                              event.preventDefault()
                              setExpandedStudentId(null)
                              void handleStartEditStudent(student.id)
                            }}
                            type="button"
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="student-detail-row">
                          <td colSpan={7}>
                            <div className="student-detail-grid">
                              <div>
                                <span className="detail-label">Tutor</span>
                                <strong>{guardianName}</strong>
                              </div>
                              <div>
                                <span className="detail-label">Telefono tutor</span>
                                <strong>{guardianPhone}</strong>
                              </div>
                              <div>
                                <span className="detail-label">Pago inscripcion</span>
                                <strong>{student.admissionPaid ? 'Registrado' : 'Pendiente'}</strong>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {filteredStudents.length > CONTROL_STUDENTS_PER_PAGE ? (
          <div className="pagination-row">
            <button
              className="secondary-button small-button"
              disabled={studentPage === 1}
              onClick={() => setStudentPage((page) => Math.max(1, page - 1))}
              type="button"
            >
              Anterior
            </button>
            <span>
              Pagina {studentPage} de {totalStudentPages}
            </span>
            <button
              className="secondary-button small-button"
              disabled={studentPage === totalStudentPages}
              onClick={() => setStudentPage((page) => Math.min(totalStudentPages, page + 1))}
              type="button"
            >
              Siguiente
            </button>
          </div>
        ) : null}

        {students.length > 0 && filteredStudents.length === 0 ? (
          <p className="empty-state">No hay alumnos que coincidan con la busqueda actual.</p>
        ) : null}
      </section>
      ) : null}

      </>
      ) : null}

      {captureTab === 'formulario' ? (
      <StudentCaptureFormPanel
        FieldComponent={Field}
        activeAdmission={activeAdmission}
        captureSectionRef={captureSectionRef}
        editingStudentId={editingStudentId}
        feedback={feedback}
        form={form}
        onBackToFichas={() => setCaptureTab('fichas')}
        onCancelEdit={onCancelEdit}
        onSubmit={onSubmit}
        onUpdateField={onUpdateField}
        relationshipOptions={relationshipOptions}
        saving={saving}
      />
      ) : null}
      {isChecklistModalOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={handleCloseChecklistModal}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <div>
                <p className="eyebrow">Checklist</p>
                <h3>{requirementChecklist?.studentName ?? 'Selecciona un alumno'}</h3>
              </div>
              <span className="status-tag">{requirementChecklist?.documentationStatus ?? 'Sin selecci?nar'}</span>
            </div>
            {requirementChecklist ? (
              <div className="checklist-modal">
                <p className="table-summary">
                  Pendientes: {requirementChecklist.items.filter((item) => !item.isDelivered).length} | Entregados: {requirementChecklist.items.filter((item) => item.isDelivered).length}
                </p>
                <div className="checklist-list">
                  {requirementChecklist.items.map((item, index) => (
                      <article className="checklist-item" key={item.requirementId}>
                        <div className="checklist-item-header">
                          <div>
                            <strong>{item.label}</strong>
                            <span>Req. {item.requiredOriginals} orig / {item.requiredCopies} copias</span>
                          </div>
                          <div className="checklist-toggle">
                            <label>
                              <input
                                checked={item.isDelivered}
                                type="radio"
                                name={`delivered-${item.requirementId}`}
                                onChange={() => handleChecklistItemChange(index, { isDelivered: true, missingJustification: '', deadlineAt: '' })}
                              />
                              Entregado
                            </label>
                            <label>
                              <input
                                checked={!item.isDelivered}
                                type="radio"
                                name={`delivered-${item.requirementId}`}
                                onChange={() => handleChecklistItemChange(index, { isDelivered: false })}
                              />
                              No entrego
                            </label>
                          </div>
                        </div>
                        {!item.isDelivered ? (
                          <div className="checklist-item-details">
                            <label className="form-field">
                              <span>Motivo</span>
                              <input value={item.missingJustification} onChange={(event) => handleChecklistItemChange(index, { missingJustification: event.target.value })} />
                            </label>
                            <label className="form-field">
                              <span>Fecha compromiso</span>
                              <input type="date" value={item.deadlineAt} onChange={(event) => handleChecklistItemChange(index, { deadlineAt: event.target.value })} />
                            </label>
                            <label className="form-field">
                              <span>Nota</span>
                              <input value={item.notes} onChange={(event) => handleChecklistItemChange(index, { notes: event.target.value })} />
                            </label>
                          </div>
                        ) : null}
                      </article>
                  ))}
                </div>
                <div className="button-row">
                  <button className="secondary-button" onClick={handleCloseChecklistModal} type="button">Cerrar</button>
                  <button className="primary-button" disabled={savingChecklist} onClick={() => void handleSaveRequirementChecklist()} type="button">
                    {savingChecklist ? 'Guardando checklist...' : 'Guardar checklist'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="empty-state">Selecciona un alumno para revisar y marcar la documentacion.</p>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}

type IngresosProps = {
  students: StudentSummary[]
  cashPayments: CashPaymentSummary[]
  selectedStudent: StudentSummary | null
  concepts: ChargeConceptSummary[]
  selectedConcepts: ChargeConceptSummary[]
  receipts: RocReceiptSummary[]
  allReceipts: RocReceiptSummary[]
  suggestedRocNumber: string
  rocInitialNumber: string
  conceptQuery: string
  savingReceipt: boolean
  loading: boolean
  total: number
  includeLifeInsurance: boolean
  lifeInsuranceAmount: number
  showLifeInsuranceOption: boolean
  conceptAmounts: Record<string, number>
  feedback: string | null
  isOnline: boolean
  rocBatchMonth: number
  rocBatchYear: number
  onChangeConceptQuery: (value: string) => void
  onChangeRocBatchMonth: (value: number) => void
  onChangeRocBatchYear: (value: number) => void
  onCreateCashPayment: () => Promise<boolean>
  onGenerateBatchReceipts: (paymentIds: string[]) => Promise<CashPaymentBatchCreateResult | null>
  onPrintMonthlyReceipts: () => Promise<void>
  onReprintReceipt: (receiptId: string) => Promise<void>
  onCancelReceipt: (receiptId: string, reason: string) => Promise<void>
  onSelectStudent: (student: StudentSummary | null) => void
  onToggleLifeInsurance: (checked: boolean) => void
  onToggleConcept: (concept: ChargeConceptSummary) => void
  onUpdateConceptAmount: (code: string, amount: number) => void
}

function IngresosPropiosOverview({
  students,
  cashPayments,
  selectedStudent,
  concepts,
  selectedConcepts,
  receipts,
  allReceipts,
  suggestedRocNumber,
  rocInitialNumber,
  conceptQuery,
  savingReceipt,
  loading,
  total,
  includeLifeInsurance,
  lifeInsuranceAmount,
  showLifeInsuranceOption,
  conceptAmounts,
  feedback,
  isOnline,
  rocBatchMonth,
  rocBatchYear,
  onChangeConceptQuery,
  onChangeRocBatchMonth,
  onChangeRocBatchYear,
  onCreateCashPayment,
  onGenerateBatchReceipts,
  onPrintMonthlyReceipts,
  onReprintReceipt,
  onCancelReceipt,
  onSelectStudent,
  onToggleLifeInsurance,
  onToggleConcept,
  onUpdateConceptAmount,
}: IngresosProps) {
  const [operationsTab, setOperationsTab] = useState<'caja' | 'pendientes-roc' | 'historial'>('caja')
  const [studentQuery, setStudentQuery] = useState('')
  const [receiptPage, setReceiptPage] = useState(1)
  const [cancelReceiptId, setCancelReceiptId] = useState<string | null>(null)
  const [cancelReceiptReason, setCancelReceiptReason] = useState('')
  const [submittingCancelReceipt, setSubmittingCancelReceipt] = useState(false)
  const studentSearchRef = useRef<HTMLInputElement | null>(null)
  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_item, index) => ({
        value: index + 1,
        label: new Date(2026, index, 1).toLocaleDateString('es-MX', { month: 'long' }),
      })),
    [],
  )
  const yearOptions = useMemo(() => {
    const receiptYears = allReceipts.map((receipt) => new Date(receipt.issuedAt).getFullYear())
    const baseYears = [rocBatchYear, new Date().getFullYear(), ...receiptYears]
    return Array.from(new Set(baseYears)).sort((a, b) => b - a)
  }, [allReceipts, rocBatchYear])
  const normalizedStudentQuery = studentQuery.trim().toLowerCase()
  const normalizedConceptQuery = conceptQuery.trim().toLowerCase()
  const paymentConcepts = concepts.filter(isSelectableConcept)
  const filteredPaymentConcepts = normalizedConceptQuery
    ? paymentConcepts.filter((concept) => [concept.code, concept.name, concept.description ?? ''].join(' ').toLowerCase().includes(normalizedConceptQuery))
    : paymentConcepts
  const visibleStudents = normalizedStudentQuery.length >= 2
    ? students.filter((student) => `${student.enrollmentNumber} ${student.fullName} ${student.curp}`.toLowerCase().includes(normalizedStudentQuery)).slice(0, 10)
    : []
  const belongsToSelectedMonth = (isoDate: string) => {
    const value = new Date(isoDate)
    return value.getFullYear() === rocBatchYear && value.getMonth() + 1 === rocBatchMonth
  }
  const pendingPayments = cashPayments.filter((payment) => payment.status === 'PENDIENTE_ROC')
  const pendingPaymentsForSelectedMonth = pendingPayments.filter((payment) => belongsToSelectedMonth(payment.createdAt))
  const monthlyPayments = cashPayments.filter((payment) => belongsToSelectedMonth(payment.createdAt))
  const generatedPaymentsForSelectedMonth = monthlyPayments.filter((payment) => payment.status === 'ROC_GENERADO')
  const monthlyReceipts = allReceipts.filter((receipt) => belongsToSelectedMonth(receipt.issuedAt))
  const studentsWithoutPayments = students.filter((student) => !cashPayments.some((payment) => payment.studentId === student.id))
  const suggestedConcepts = paymentConcepts.filter((concept) => concept.isSuggested)
  const totalReceiptPages = Math.max(1, Math.ceil(receipts.length / RECEIPTS_PER_PAGE))
  const paginatedReceipts = receipts.slice((receiptPage - 1) * RECEIPTS_PER_PAGE, receiptPage * RECEIPTS_PER_PAGE)
  const latestReceiptId = receipts[0]?.id ?? null
  const recentAllReceipts = allReceipts.slice(0, 5)
  const receiptPendingCancellation = cancelReceiptId
    ? allReceipts.find((receipt) => receipt.id === cancelReceiptId) ?? receipts.find((receipt) => receipt.id === cancelReceiptId) ?? null
    : null
  useEffect(() => {
    if (receiptPage > totalReceiptPages) {
      setReceiptPage(totalReceiptPages)
    }
  }, [receiptPage, totalReceiptPages])

  useEffect(() => {
    setReceiptPage(1)
  }, [selectedStudent?.id, latestReceiptId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (operationsTab !== 'caja') return

      if (event.ctrlKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        studentSearchRef.current?.focus()
        return
      }

      if (event.key === 'F2') {
        event.preventDefault()
        if (!savingReceipt && selectedStudent && selectedConcepts.length > 0) {
          void handleCreatePaymentAndKeepCapturing()
        }
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleCreatePaymentAndKeepCapturing, operationsTab, savingReceipt, selectedConcepts.length, selectedStudent])

  function onStudentSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && visibleStudents.length > 0) {
      event.preventDefault()
      onSelectStudent(visibleStudents[0])
    }
  }

  function handleAddSuggestedConcepts() {
    for (const concept of suggestedConcepts) {
      if (!selectedConcepts.some((selected) => selected.code === concept.code)) {
        onToggleConcept(concept)
      }
    }
  }

  function handleClearConcepts() {
    for (const concept of selectedConcepts) {
      onToggleConcept(concept)
    }
  }

  const selectedConceptLabels = selectedConcepts.map((concept) => ({
    concept,
    amount: conceptAmounts[concept.code] ?? concept.amount,
  }))

  function handleResetCashDesk() {
    handleClearConcepts()
    onToggleLifeInsurance(false)
    onChangeConceptQuery('')
    setStudentQuery('')
    onSelectStudent(null)
    window.setTimeout(() => {
      studentSearchRef.current?.focus()
    }, 60)
  }

  async function handleCreatePaymentAndKeepCapturing() {
    const created = await onCreateCashPayment()
    if (created) {
      handleResetCashDesk()
    }
  }

  async function handleGenerateSelectedMonth() {
    if (pendingPaymentsForSelectedMonth.length === 0) {
      return
    }

    const result = await onGenerateBatchReceipts(pendingPaymentsForSelectedMonth.map((payment) => payment.id))
    if (result) {
      setOperationsTab('historial')
    }
  }

  async function handleConfirmCancelReceipt() {
    if (!cancelReceiptId) return
    if (cancelReceiptReason.trim().length < 3) return

    setSubmittingCancelReceipt(true)
    try {
      await onCancelReceipt(cancelReceiptId, cancelReceiptReason.trim())
      setCancelReceiptId(null)
      setCancelReceiptReason('')
    } finally {
      setSubmittingCancelReceipt(false)
    }
  }

  return (
    <section className="roc-layout">
      <article className="panel compact" style={{ gridColumn: '1 / -1' }}>
        <div className="button-row">
          <button className={operationsTab === 'caja' ? 'primary-button small-button' : 'secondary-button small-button'} onClick={() => setOperationsTab('caja')} type="button">
            Caja / Cobros
          </button>
          <button className={operationsTab === 'pendientes-roc' ? 'primary-button small-button' : 'secondary-button small-button'} onClick={() => setOperationsTab('pendientes-roc')} type="button">
            Pendientes de ROC
          </button>
          <button className={operationsTab === 'historial' ? 'primary-button small-button' : 'secondary-button small-button'} onClick={() => setOperationsTab('historial')} type="button">
            ROC mensual
          </button>
        </div>
        <p className="table-summary compact-operational-line">
          {cashPayments.length} cobros registrados | {pendingPayments.length} pendientes ROC | {cashPayments.filter((payment) => payment.status === 'ROC_GENERADO').length} ROC generados | {studentsWithoutPayments.length} alumnos sin cobro | {isOnline ? 'Online' : 'Offline'}
        </p>
      </article>

      {operationsTab === 'caja' ? (
        <article className="panel wide">
          <div className="section-header">
            <div>
              <p className="eyebrow">Caja</p>
              <h2 className="compact-header">Cobros por clave unificados</h2>
            </div>
            <span className="status-tag">Ctrl+K buscar alumno | F2 registrar cobro</span>
          </div>

          <div className="cash-workspace">
            <div className="cash-top-bar">
              <Field className="cash-search-field" label="Buscar alumno">
                <input
                  ref={studentSearchRef}
                  placeholder="Buscar por folio interno, nombre o CURP"
                  value={studentQuery}
                  onChange={(event) => setStudentQuery(event.target.value)}
                  onKeyDown={onStudentSearchKeyDown}
                />
              </Field>

              {selectedStudent ? (
                <div className="selected-student-summary compact-summary cash-student-summary">
                  <div>
                    <span className="detail-label">Alumno</span>
                    <strong>{selectedStudent.fullName}</strong>
                  </div>
                  <div>
                    <span className="detail-label">Folio</span>
                    <strong>{selectedStudent.enrollmentNumber}</strong>
                  </div>
                  <div>
                    <span className="detail-label">ROC historicos</span>
                    <strong>{receipts.length}</strong>
                  </div>
                </div>
              ) : (
                <div className="cash-inline-empty">
                  <p className="empty-state">Busca y selecciona un alumno validado para registrar el cobro.</p>
                </div>
              )}
            </div>

            {normalizedStudentQuery.length >= 2 ? (
              <div className="student-table-wrap compact-search-results">
                <table className="student-table">
                  <thead>
                    <tr>
                      <th>Folio</th>
                      <th>Alumno</th>
                      <th>Grupo</th>
                      <th>Estatus cobro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStudents.length === 0 ? (
                      <tr>
                        <td colSpan={4}>
                          <p className="empty-state compact-empty-state">No hay alumnos que coincidan con la busqueda.</p>
                        </td>
                      </tr>
                    ) : (
                      visibleStudents.map((student) => (
                        <tr className={selectedStudent?.id === student.id ? 'student-row active' : 'student-row'} key={student.id} onClick={() => onSelectStudent(student)} role="button" tabIndex={0}>
                          <td><strong>{highlightMatch(student.enrollmentNumber, studentQuery)}</strong></td>
                          <td>{highlightMatch(student.fullName, studentQuery)}</td>
                          <td>{student.groupLabel ?? 'Sin asignar'}</td>
                          <td>{cashPayments.some((payment) => payment.studentId === student.id) ? 'Con cobros' : 'Sin cobro'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="cash-toolbar">
              <div className="button-row">
                <button className="secondary-button small-button" disabled={suggestedConcepts.length === 0} onClick={handleAddSuggestedConcepts} type="button">
                  Agregar sugeridas
                </button>
                <button className="tertiary-button small-button" disabled={selectedConcepts.length === 0} onClick={handleClearConcepts} type="button">
                  Limpiar claves
                </button>
              </div>

              <Field className="cash-concept-search" label="Buscar clave o concepto">
                <input placeholder="Ej. B002, examenes, documentos..." value={conceptQuery} onChange={(event) => onChangeConceptQuery(event.target.value)} />
              </Field>
            </div>

            <p className="table-summary compact-operational-line">
              Elegis las claves manualmente y la seleccion se limpia al cambiar de alumno.
            </p>

            {showLifeInsuranceOption ? (
              <label className="checkbox-field compact-insurance-row">
                <input checked={includeLifeInsurance} onChange={(event) => onToggleLifeInsurance(event.target.checked)} type="checkbox" />
                <span>Cobrar seguro de vida ({formatCurrency(lifeInsuranceAmount)}). Este cargo se cobra junto con inscripcion, pero no se imprime en el ROC.</span>
              </label>
            ) : null}

            <div className="cash-operator-layout">
              <div className="cash-action-sidebar">
                <div className="cash-selection-panel compact-selection-panel">
                  <div className="cash-selection-header">
                    <div>
                      <span className="detail-label">Resumen del cobro</span>
                      <strong>{selectedStudent ? 'Operacion lista para registrar' : 'Selecciona un alumno para empezar'}</strong>
                    </div>
                    <span className="status-tag">{selectedConcepts.length} claves</span>
                  </div>
                  {selectedConceptLabels.length > 0 ? (
                    <div className="selected-concept-chips">
                      {selectedConceptLabels.map((concept) => (
                        <button className="selected-concept-chip" key={concept.concept.code} onClick={() => onToggleConcept(concept.concept)} type="button">
                          <span>{concept.concept.code}</span>
                          <strong>{formatCurrency(concept.amount)}</strong>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state compact-empty-state">Todavia no hay claves seleccionadas para este cobro.</p>
                  )}
                </div>

                <div className="cash-sidebar-actions">
                  <p className="total sticky-total">Total actual: {formatCurrency(total)}</p>
                  <button className="primary-button" disabled={savingReceipt || !selectedStudent || selectedConcepts.length === 0} onClick={() => void handleCreatePaymentAndKeepCapturing()} type="button">
                    Registrar cobro
                  </button>
                  <button className="secondary-button small-button" disabled={!selectedStudent && selectedConcepts.length === 0 && studentQuery.length === 0} onClick={handleResetCashDesk} type="button">
                    Capturar otro alumno
                  </button>
                </div>
              </div>

              <div className="student-table-wrap compact-keys-wrap">
                <table className="student-table compact-keys-table">
                  <thead>
                    <tr>
                      <th>Clave</th>
                      <th>Concepto</th>
                      <th>Cuota</th>
                      <th>Periodo</th>
                      <th>Accion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPaymentConcepts.map((concept) => {
                      const active = selectedConcepts.some((item) => item.code === concept.code)
                      return (
                        <tr className={active ? 'student-row active concept-added-row' : 'student-row'} key={concept.code}>
                          <td>
                            <strong>{concept.code}</strong>
                            {concept.isSuggested ? <div><small>Sugerida</small></div> : null}
                          </td>
                          <td>{concept.name}</td>
                          <td>
                            <input
                              className="table-input compact-amount-input"
                              min="0"
                              step="0.01"
                              type="number"
                              value={conceptAmounts[concept.code] ?? concept.amount}
                              onChange={(event) => onUpdateConceptAmount(concept.code, Number(event.target.value || 0))}
                            />
                          </td>
                          <td>{concept.periodLabel}</td>
                          <td>
                            <button className={active ? 'primary-button small-button' : 'secondary-button small-button'} onClick={() => onToggleConcept(concept)} type="button">
                              {active ? 'Quitar' : 'Agregar'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedStudent ? (
              <details className="receipt-history receipt-history-panel">
                <summary>Historial del alumno ({receipts.length})</summary>
                {receipts.length === 0 ? <p className="empty-state">Este alumno aun no tiene ROC registrados.</p> : null}
                {paginatedReceipts.map((receipt) => (
                  <article className="history-card compact" key={receipt.id}>
                    <strong>{receipt.rocNumber}</strong>
                    <span>{new Date(receipt.issuedAt).toLocaleString('es-MX')}</span>
                    <span>{receipt.conceptLabels.join(' | ')}</span>
                    <div className="history-card-footer">
                      <em>Total: {formatCurrency(receipt.totalAmount)} · {receipt.status}</em>
                      <div className="button-row">
                        {receipt.status !== 'ANULADO' ? (
                          <button className="secondary-button small-button" onClick={() => void onReprintReceipt(receipt.id)} type="button">
                            Reimprimir
                          </button>
                        ) : (
                          <span className="status-tag status-tag-muted">Anulado</span>
                        )}
                        {receipt.status !== 'ANULADO' ? (
                          <button className="tertiary-button small-button" onClick={() => {
                            setCancelReceiptId(receipt.id)
                            setCancelReceiptReason('')
                          }} type="button">
                            Anular
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </details>
            ) : null}
          </div>
        </article>
      ) : null}

      {operationsTab === 'pendientes-roc' ? (
        <article className="panel wide">
          <div className="section-header">
            <div>
              <p className="eyebrow">Cola operativa</p>
              <h2>Pendientes de ROC</h2>
            </div>
            <div className="button-row">
              <button className="secondary-button small-button" onClick={() => setOperationsTab('historial')} type="button">
                Ir a ROC mensual
              </button>
              <span className="status-tag">{pendingPayments.length} pendientes reales</span>
            </div>
          </div>

          <p className="table-summary compact-operational-line">
            Esta vista queda solo como cola operativa rapida, hermano. Lo mensual se consolida en ROC mensual.
          </p>

          <div className="student-table-wrap">
            <table className="student-table">
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Folio</th>
                  <th>Fecha</th>
                  <th>Claves</th>
                  <th>Total</th>
                  <th>Estatus</th>
                </tr>
              </thead>
              <tbody>
                {pendingPayments.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <p className="empty-state">No hay cobros pendientes para mandar al ROC mensual.</p>
                    </td>
                  </tr>
                ) : null}
                {pendingPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.studentName}</td>
                    <td>{payment.enrollmentNumber}</td>
                    <td>{new Date(payment.createdAt).toLocaleString('es-MX')}</td>
                    <td>
                      {payment.conceptLabels.join(' | ')}
                      {payment.externalConceptLabels.length > 0 ? <div><small>Externos al ROC: {payment.externalConceptLabels.join(' | ')}</small></div> : null}
                    </td>
                    <td>{formatCurrency(payment.totalAmount)}{payment.externalTotalAmount > 0 ? <div><small>ROC: {formatCurrency(payment.rocTotalAmount)}</small></div> : null}</td>
                    <td>{payment.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {operationsTab === 'historial' ? (
        <article className="panel wide">
          <div className="section-header">
            <div>
              <p className="eyebrow">Historial mensual</p>
              <h2>Cobros acumulados del mes</h2>
            </div>
            <span className="status-tag">{monthlyPayments.length} cobros del periodo</span>
          </div>

          <div className="button-row">
            <Field label="Mes">
              <select value={rocBatchMonth} onChange={(event) => onChangeRocBatchMonth(Number(event.target.value))}>
                {monthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Anio">
              <select value={rocBatchYear} onChange={(event) => onChangeRocBatchYear(Number(event.target.value))}>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </Field>
            <button className="primary-button small-button" disabled={savingReceipt || pendingPaymentsForSelectedMonth.length === 0} onClick={() => void handleGenerateSelectedMonth()} type="button">
              Generar / actualizar ROC mensual
            </button>
            <button className="secondary-button small-button" disabled={savingReceipt} onClick={() => void onPrintMonthlyReceipts()} type="button">
              Reimprimir mes completo
            </button>
          </div>

          <div className="roc-monthly-metrics">
            <article className="metric-card compact-metric">
              <span className="detail-label">Pendientes del mes</span>
              <strong>{pendingPaymentsForSelectedMonth.length}</strong>
              <p className="metric-label">Cobros ya registrados, pero aun no incluidos en el ROC mensual.</p>
            </article>
            <article className="metric-card compact-metric">
              <span className="detail-label">Ya incluidos</span>
              <strong>{generatedPaymentsForSelectedMonth.length}</strong>
              <p className="metric-label">Cobros que ya quedaron asentados dentro del acumulado oficial.</p>
            </article>
            <article className="metric-card compact-metric">
              <span className="detail-label">Siguiente ROC</span>
              <strong>{suggestedRocNumber}</strong>
              <p className="metric-label">Se toma del consecutivo configurado y avanza solo, sin tocarlo en caja.</p>
            </article>
          </div>

          <p className="table-summary compact-operational-line">
            {pendingPaymentsForSelectedMonth.length} pendientes del mes | {generatedPaymentsForSelectedMonth.length} ya incluidos en ROC | ROC configurado: {rocInitialNumber} | Siguiente: {suggestedRocNumber}
          </p>

          <p className="monthly-help-text">
            AcÃ¡ se trabaja el corte mensual, hermano. Caja solo cobra; desde esta vista se consolida el periodo y Excel se abre automaticamente al generar o reimprimir.
          </p>

          <div className="student-table-wrap">
            <table className="student-table">
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Folio</th>
                  <th>Fecha de cobro</th>
                  <th>Claves cobradas</th>
                  <th>Total caja</th>
                  <th>Total ROC</th>
                  <th>Estatus mensual</th>
                </tr>
              </thead>
              <tbody>
                {monthlyPayments.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <p className="empty-state">Todavia no hay cobros acumulados para este mes.</p>
                    </td>
                  </tr>
                ) : null}
                {monthlyPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.studentName}</td>
                    <td>{payment.enrollmentNumber}</td>
                    <td>{new Date(payment.createdAt).toLocaleString('es-MX')}</td>
                    <td>
                      {payment.conceptLabels.join(' | ')}
                      {payment.externalConceptLabels.length > 0 ? <div><small>Externos al ROC: {payment.externalConceptLabels.join(' | ')}</small></div> : null}
                    </td>
                    <td>{formatCurrency(payment.totalAmount)}</td>
                    <td>{formatCurrency(payment.rocTotalAmount)}</td>
                    <td>{payment.status === 'ROC_GENERADO' ? 'Incluido en ROC mensual' : 'Pendiente de incluir'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="student-table-wrap">
            <table className="student-table">
              <thead>
                <tr>
                  <th>ROC emitido</th>
                  <th>Alumno</th>
                  <th>Fecha</th>
                  <th>Total</th>
                  <th>Estatus</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {monthlyReceipts.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <p className="empty-state">Todavia no hay ROC emitidos para este mes.</p>
                    </td>
                  </tr>
                ) : null}
                {monthlyReceipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td><strong>{receipt.rocNumber}</strong></td>
                    <td>{receipt.studentName}</td>
                    <td>{new Date(receipt.issuedAt).toLocaleString('es-MX')}</td>
                    <td>{formatCurrency(receipt.totalAmount)}</td>
                    <td>{receipt.status}</td>
                    <td>
                      <div className="button-row">
                        {receipt.status !== 'ANULADO' ? (
                          <button className="secondary-button small-button" onClick={() => void onReprintReceipt(receipt.id)} type="button">
                            Reimprimir
                          </button>
                        ) : (
                          <span className="status-tag status-tag-muted">Anulado</span>
                        )}
                        {receipt.status !== 'ANULADO' ? (
                          <button className="tertiary-button small-button" onClick={() => {
                            setCancelReceiptId(receipt.id)
                            setCancelReceiptReason('')
                          }} type="button">
                            Anular
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {cancelReceiptId && receiptPendingCancellation ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card checklist-modal">
            <div className="section-header">
              <div>
                <p className="eyebrow">Anulacion de ROC</p>
                <h2 className="compact-header">{receiptPendingCancellation.rocNumber}</h2>
              </div>
              <button className="tertiary-button small-button" onClick={() => {
                setCancelReceiptId(null)
                setCancelReceiptReason('')
              }} type="button">
                Cerrar
              </button>
            </div>

            <p className="table-summary">
              Vas a anular el ROC de <strong>{receiptPendingCancellation.studentName}</strong>. Si el sistema encuentra el cobro asociado, lo va a devolver a pendientes de ROC.
            </p>

            <Field label="Motivo de anulacion" required>
              <textarea
                rows={4}
                value={cancelReceiptReason}
                onChange={(event) => setCancelReceiptReason(event.target.value)}
                placeholder="Explica por que se anula este ROC..."
              />
            </Field>

            <div className="button-row">
              <button className="tertiary-button" onClick={() => {
                setCancelReceiptId(null)
                setCancelReceiptReason('')
              }} type="button">
                Cancelar
              </button>
              <button className="primary-button" disabled={submittingCancelReceipt || cancelReceiptReason.trim().length < 3} onClick={() => void handleConfirmCancelReceipt()} type="button">
                {submittingCancelReceipt ? 'Anulando...' : 'Confirmar anulacion'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

type StepCardProps = {
  title: string
  text: string
}

function StepCard({ title, text }: StepCardProps) {
  return (
    <article className="step-card">
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  )
}

type FieldProps = {
  label: string
  required?: boolean
  className?: string
  children: ReactNode
}

function Field({ label, required, className, children }: FieldProps) {
  return (
    <label className={className ? `form-field ${className}` : 'form-field'}>
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      {children}
    </label>
  )
}

export default App

