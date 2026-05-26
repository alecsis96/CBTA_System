import { FormEvent, Fragment, MutableRefObject, ReactNode, useEffect, useRef, useState } from 'react'
import { browserFallbackApi } from '@/lib/browser-fallback'
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
  ChargeConceptSummary,
  PreRegistrationSummary,
  RocReceiptSummary,
  GroupStat,
  GroupPreviewRow,
  StudentFormInput,
  StudentSummary,
} from '@/types/domain'

type Screen = 'control-escolar' | 'ingresos-propios' | 'configuracion'
type FeedbackScope = 'control-escolar' | 'ingresos-propios' | 'configuracion' | 'sync'

const relationshipOptions = ['Padre', 'Madre', 'Tutor', 'Abuelo', 'Abuela', 'Otro']

const STUDENTS_PER_PAGE = 20
const CONTROL_STUDENTS_PER_PAGE = 20
const RECEIPTS_PER_PAGE = 5

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
  },
}

function isSelectableConcept(concept: ChargeConceptSummary) {
  return !concept.code.endsWith('000')
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
}

function App() {
  const desktopApi = typeof window !== 'undefined' && 'cbta' in window ? window.cbta : null
  const appApi = desktopApi ?? browserFallbackApi
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
  const [recentAuditLogs, setRecentAuditLogs] = useState<AuditLogSummary[]>([])
  const [rocNumber, setRocNumber] = useState('DGETAYCM-ROC-0001')
  const [conceptQuery, setConceptQuery] = useState('')
  const [form, setForm] = useState<StudentFormInput>(initialForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingReceipt, setSavingReceipt] = useState(false)
  const [savingTariffCode, setSavingTariffCode] = useState<string | null>(null)
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
  const studentsSectionRef = useRef<HTMLElement | null>(null)
  const captureSectionRef = useRef<HTMLElement | null>(null)

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
        await loadData()
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

  async function loadData() {
    setLoading(true)
    try {
      const receiptsAllPromise =
        typeof appApi.receipts.listAll === 'function' ? appApi.receipts.listAll() : Promise.resolve([])
      const admissionsPromise =
        typeof appApi.admissions?.list === 'function' ? appApi.admissions.list() : Promise.resolve([])

      const [allStudents, preRegistrations, validatedStudents, activeConcepts, auditLogs, receiptsAll, admissions] = await Promise.all([
        appApi.students.list(),
        appApi.preRegistrations.list(),
        appApi.students.listValidated(),
        appApi.concepts.listActive(),
        appApi.audit.listRecent(),
        receiptsAllPromise,
        admissionsPromise,
      ])

      setStudents(allStudents)
      setPreRegistrations(preRegistrations)
      setValidatedStudents(validatedStudents)
      setConcepts(activeConcepts)
      setRecentAuditLogs(auditLogs)
      setAllReceipts(receiptsAll)
      setAdmissions(admissions)
      setSelectedStudent((current) => {
        if (current) {
          return validatedStudents.find((student) => student.id === current.id) ?? validatedStudents[0] ?? null
        }

        return validatedStudents[0] ?? null
      })
      setSelectedConcepts((current) => {
        if (current.length > 0) {
          const refreshedSelection = current
            .map((selected) => activeConcepts.find((concept) => concept.code === selected.code))
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
      await loadData()
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setControlFeedback(null)

    try {
      if (editingStudentId) {
        const updated = await appApi.students.update(editingStudentId, form)
        addPendingSyncOp({
          type: 'STUDENT_UPDATE',
          entityId: updated.id,
          payload: { studentId: updated.id },
          deviceId: getDeviceId(),
        })
        if (activeAdmission && typeof appApi.admissions?.completeCapture === 'function') {
          await appApi.admissions.completeCapture(activeAdmission.id, updated.id)
        }
      } else {
        const created = await appApi.students.create(form)
        addPendingSyncOp({
          type: 'STUDENT_CREATE',
          entityId: created.id,
          payload: { studentId: created.id },
          deviceId: getDeviceId(),
        })
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

  async function handleCreatePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (typeof appApi.admissions?.createPayment !== 'function') {
      return
    }

    setIngresosFeedback(null)
    try {
      const createdPayment = await appApi.admissions.createPayment(paymentForm)
      await printPaymentReceipt(createdPayment)
      setPaymentForm(initialPaymentForm)
      await loadData()
      setIngresosFeedback('Pago de ficha registrado e impreso. Ya esta disponible para captura en Control Escolar.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar el pago de ficha.'
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
      setControlFeedback('Pago seleccionado. Completa la captura y guarda el alumno.')
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
  }

  function toggleConcept(concept: ChargeConceptSummary) {
    setSelectedConcepts((current) => {
      const exists = current.some((item) => item.code === concept.code)
      if (exists) {
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
      setIngresosFeedback('ROC guardado e impreso correctamente.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar e imprimir el ROC.'
      setIngresosFeedback(message)
    } finally {
      setSavingReceipt(false)
    }
  }

  async function handlePrintBatchReceipts() {
    if (typeof appApi.receipts.printBatch !== 'function') {
      setIngresosFeedback('La impresion por lote no esta disponible en este modo.')
      return
    }
    try {
      await appApi.receipts.printBatch()
      setIngresosFeedback('Se genero el lote final de ROC para impresion (2 por hoja).')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo imprimir el lote de ROC.'
      setIngresosFeedback(message)
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
      if (result.pulled > 0) {
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
        <form className="auth-card" onSubmit={handleLogin}>
          <p className="eyebrow">CBTA Financieros</p>
          <h1>Iniciar sesion</h1>
          <label className="form-field">
            <span>Usuario</span>
            <input
              value={authForm.username}
              onChange={(event) => setAuthForm((current) => ({ ...current, username: event.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Contrasena</span>
            <input
              type="password"
              value={authForm.password}
              onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
            />
          </label>
          {authError ? <p className="feedback-banner">{authError}</p> : null}
          <button className="primary-button" disabled={authSaving} type="submit">
            {authSaving ? 'Ingresando...' : 'Entrar'}
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
            <p className="eyebrow">CBTA Financieros</p>
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

        <section className="panel compact">
          <h2>Resumen rapido</h2>
          <p className="muted">Ficha entregada: {students.filter((item) => item.statusLabel === 'Ficha entregada').length}</p>
          <p className="muted">Sin grupo: {students.filter((item) => !item.groupLabel).length}</p>
          <p className="muted">No presentados: {students.filter((item) => item.statusLabel === 'No presentado').length}</p>
          <p className="muted">Pagos pendientes: {admissions.filter((item) => item.status === 'PAGADO_PENDIENTE_CAPTURA').length}</p>
        </section>

        <section className="panel compact">
          <h2>Sincronizacion</h2>
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
        </section>
      </aside>

      <main className="content">
        <section className="panel compact">
          <div className="section-header">
            <div>
              <p className="eyebrow">Panel operativo</p>
              <h2>{screen === 'control-escolar' ? 'Control Escolar' : screen === 'ingresos-propios' ? 'Ingresos Propios' : 'Configuracion'}</h2>
            </div>
            <span className="status-tag">{isOnline ? 'Online' : 'Offline'}</span>
          </div>
          <div className="button-row">
            <span className="chip">Alumnos validados: {validatedStudents.length}</span>
            <span className="chip">Claves activas: {concepts.length}</span>
            <span className="chip">Sync pendientes: {syncStatus.pendingTotal}</span>
          </div>
        </section>

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
          />
        ) : screen === 'ingresos-propios' ? (
          <IngresosPropiosOverview
            concepts={concepts}
            loading={loading}
            receipts={receipts}
            allReceipts={allReceipts}
            rocNumber={rocNumber}
            savingReceipt={savingReceipt}
            selectedConcepts={selectedConcepts}
            admissions={admissions}
            paymentForm={paymentForm}
            selectedStudent={selectedStudent}
            students={validatedStudents}
            total={total}
            conceptAmounts={conceptAmounts}
            conceptQuery={conceptQuery}
            onChangeRocNumber={setRocNumber}
            onCreateReceipt={handleCreateReceipt}
            onChangeConceptQuery={setConceptQuery}
            onPrintReceipt={handlePrintReceipt}
            onPrintBatchReceipts={handlePrintBatchReceipts}
            onReprintReceipt={handleReprintReceipt}
            onSelectStudent={setSelectedStudent}
            onToggleConcept={toggleConcept}
            onUpdateConceptAmount={updateConceptAmount}
            onPrintAdmission={handlePrintAdmission}
            onPrintPaymentReceipt={printPaymentReceipt}
            onCreatePayment={handleCreatePayment}
            onUpdatePaymentField={(field, value) => setPaymentForm((current) => ({ ...current, [field]: value }))}
          />
        ) : (
          <ConfiguracionTarifasOverview
            concepts={concepts}
            savingTariffCode={savingTariffCode}
            onUpdateTariff={handleUpdateTariff}
          />
        )}

        <section className="panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Bitacora</p>
              <h2>Actividad reciente</h2>
            </div>
            <span className="status-tag">12 eventos recientes</span>
          </div>

          <div className="receipt-history">
            {recentAuditLogs.length === 0 ? <p className="empty-state">Todavia no hay actividad registrada.</p> : null}
            {recentAuditLogs.map((log) => (
              <article className="history-card" key={log.id}>
                <strong>{log.action}</strong>
                <span>{log.actorName}</span>
                <span>{new Date(log.createdAt).toLocaleString('es-MX')}</span>
                <em>{log.detail || `${log.entityType} ${log.entityId}`}</em>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

type ConfiguracionTarifasProps = {
  concepts: ChargeConceptSummary[]
  savingTariffCode: string | null
  onUpdateTariff: (code: string, amount: number, periodLabel: string) => Promise<void>
}

function ConfiguracionTarifasOverview({ concepts, savingTariffCode, onUpdateTariff }: ConfiguracionTarifasProps) {
  const groupedConcepts = groupedSelectableConcepts(concepts)
  const [selectedGroupKey, setSelectedGroupKey] = useState(groupedConcepts[0]?.key ?? 'A000')

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
          <h2>Tarifas por clave</h2>
        </div>
        <span className="status-tag">Edicion por Ingresos Propios</span>
      </div>

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
          <p className="tariff-help-text">{concepts.filter(isSelectableConcept).length} claves configurables cargadas</p>
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
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  )
}

type TariffEditorRowProps = {
  concept: ChargeConceptSummary
  isSaving: boolean
  onSave: (code: string, amount: number, periodLabel: string) => Promise<void>
}

function TariffEditorRow({ concept, isSaving, onSave }: TariffEditorRowProps) {
  const [amount, setAmount] = useState(String(concept.amount))
  const [periodLabel, setPeriodLabel] = useState(concept.periodLabel)

  useEffect(() => {
    setAmount(String(concept.amount))
    setPeriodLabel(concept.periodLabel)
  }, [concept.amount, concept.periodLabel])

  return (
    <tr>
      <td>{concept.code}</td>
      <td>{concept.name}</td>
      <td>
        <input className="table-input" type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </td>
      <td>
        <input className="table-input" value={periodLabel} onChange={(event) => setPeriodLabel(event.target.value)} />
      </td>
      <td>
        <button
          className="primary-button small-button"
          disabled={isSaving}
          onClick={() => void onSave(concept.code, Number(amount || 0), periodLabel)}
          type="button"
        >
          {isSaving ? '...' : 'Guardar'}
        </button>
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
}: ControlEscolarProps) {
  const [captureTab, setCaptureTab] = useState<'fichas' | 'formulario'>('fichas')
  const [operationsTab, setOperationsTab] = useState<'captura' | 'bandeja' | 'grupos' | 'alumnos'>('alumnos')
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

  useEffect(() => {
    if (previewPage > previewTotalPages) {
      setPreviewPage(previewTotalPages)
    }
  }, [previewPage, previewTotalPages])

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
    if (!window.cbta?.groups?.stats) return
    const stats = await window.cbta.groups.stats({ schoolCycle: form.schoolCycle })
    setGroupStats(stats)
  }

  async function handleAutoAssign() {
    if (!window.cbta?.groups?.autoAssign) return
    await window.cbta.groups.autoAssign({ schoolCycle: form.schoolCycle })
    setIsPreviewStats(false)
    setGroupPreviewRows([])
    setPreviewGroupFilter('all')
    setPreviewSexFilter('all')
    await refreshGroupStats()
  }

  async function handlePreviewAssign() {
    if (!window.cbta?.groups?.preview) return
    const stats = await window.cbta.groups.preview({ schoolCycle: form.schoolCycle })
    setGroupStats(stats)
    if (window.cbta?.groups?.previewRoster) {
      const rows = await window.cbta.groups.previewRoster({ schoolCycle: form.schoolCycle })
      setGroupPreviewRows(rows)
    }
    setIsPreviewStats(true)
  }

  async function handleConfirmGroups() {
    if (!window.cbta?.groups?.confirmAssignment) return
    await window.cbta.groups.confirmAssignment({ schoolCycle: form.schoolCycle })
    await refreshGroupStats()
  }

  async function handleManualMove() {
    if (!window.cbta?.groups?.manualReassign || !moveStudentId || !moveGroupId) return
    await window.cbta.groups.manualReassign({ studentId: moveStudentId, toGroupId: moveGroupId, reason: moveReason || 'Ajuste operativo' })
    await refreshGroupStats()
  }

  async function handleNoShow() {
    if (!window.cbta?.groups?.markNoShow || !noShowStudentId) return
    await window.cbta.groups.markNoShow({ studentId: noShowStudentId, reason: noShowReason || 'No se presento a inscripcion' })
    await refreshGroupStats()
  }

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
        </div>
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
                    <th>Matricula</th>
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
                placeholder="Buscar por matricula, nombre o CURP"
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
                  <th>Matricula</th>
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
                  const address = student.address?.trim().length ? student.address : 'Sin domicilio capturado'
                  const rfc = student.rfc?.trim().length ? student.rfc : 'Sin RFC'
                  const phone = student.phone?.trim().length ? student.phone : 'Sin telefono'
                  const email = student.email?.trim().length ? student.email : 'Sin correo'

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
                                <span className="detail-label">Telefono</span>
                                <strong>{phone}</strong>
                              </div>
                              <div>
                                <span className="detail-label">Correo</span>
                                <strong>{email}</strong>
                              </div>
                              <div>
                                <span className="detail-label">Domicilio</span>
                                <strong>{address}</strong>
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
    </>
  )
}

type IngresosProps = {
  students: StudentSummary[]
  admissions: AdmissionSummary[]
  paymentForm: AdmissionCreatePaymentInput
  selectedStudent: StudentSummary | null
  concepts: ChargeConceptSummary[]
  selectedConcepts: ChargeConceptSummary[]
  receipts: RocReceiptSummary[]
  allReceipts: RocReceiptSummary[]
  rocNumber: string
  conceptQuery: string
  savingReceipt: boolean
  loading: boolean
  total: number
  conceptAmounts: Record<string, number>
  onChangeConceptQuery: (value: string) => void
  onChangeRocNumber: (value: string) => void
  onCreateReceipt: () => Promise<void>
  onPrintReceipt: () => Promise<void>
  onPrintBatchReceipts: () => Promise<void>
  onReprintReceipt: (receiptId: string) => Promise<void>
  onSelectStudent: (student: StudentSummary) => void
  onToggleConcept: (concept: ChargeConceptSummary) => void
  onUpdateConceptAmount: (code: string, amount: number) => void
  onPrintAdmission: (admission: AdmissionSummary) => Promise<void>
  onPrintPaymentReceipt: (admission: AdmissionSummary) => Promise<void>
  onCreatePayment: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onUpdatePaymentField: <K extends keyof AdmissionCreatePaymentInput>(field: K, value: AdmissionCreatePaymentInput[K]) => void
}

function IngresosPropiosOverview({
  students,
  admissions,
  paymentForm,
  selectedStudent,
  concepts,
  selectedConcepts,
  receipts,
  allReceipts,
  rocNumber,
  conceptQuery,
  savingReceipt,
  loading,
  total,
  conceptAmounts,
  onChangeConceptQuery,
  onChangeRocNumber,
  onCreateReceipt,
  onPrintReceipt,
  onPrintBatchReceipts,
  onReprintReceipt,
  onSelectStudent,
  onToggleConcept,
  onUpdateConceptAmount,
  onPrintAdmission,
  onPrintPaymentReceipt,
  onCreatePayment,
  onUpdatePaymentField,
}: IngresosProps) {
  const [operationsTab, setOperationsTab] = useState<'pagos' | 'inscripcion-roc' | 'fichas' | 'historial'>('inscripcion-roc')
  const printedAt = new Date()
  const amountInWords = amountToWords(total)
  const normalizedQuery = conceptQuery.trim().toLowerCase()
  const paymentConcepts = concepts.filter(isSelectableConcept)
  const filteredPaymentConcepts = normalizedQuery
    ? paymentConcepts.filter((concept) => {
        const haystack = [concept.code, concept.name, concept.description ?? ''].join(' ').toLowerCase()
        return haystack.includes(normalizedQuery)
      })
    : paymentConcepts
  const [studentQuery, setStudentQuery] = useState('')
  const [studentPage, setStudentPage] = useState(1)
  const [receiptPage, setReceiptPage] = useState(1)
  const normalizedStudentQuery = studentQuery.trim().toLowerCase()
  const filteredStudents = normalizedStudentQuery
    ? students.filter((student) => {
        const haystack = `${student.enrollmentNumber} ${student.fullName}`.toLowerCase()
        return haystack.includes(normalizedStudentQuery)
      })
    : students

  const totalStudentPages = Math.max(1, Math.ceil(filteredStudents.length / STUDENTS_PER_PAGE))
  const paginatedStudents = filteredStudents.slice((studentPage - 1) * STUDENTS_PER_PAGE, studentPage * STUDENTS_PER_PAGE)
  const totalReceiptPages = Math.max(1, Math.ceil(receipts.length / RECEIPTS_PER_PAGE))
  const paginatedReceipts = receipts.slice((receiptPage - 1) * RECEIPTS_PER_PAGE, receiptPage * RECEIPTS_PER_PAGE)
  const latestReceiptId = receipts[0]?.id ?? null
  const recentReceipts = receipts.slice(0, 3)
  const recentAllReceipts = allReceipts.slice(0, 5)


  useEffect(() => {
    if (studentPage > totalStudentPages) {
      setStudentPage(totalStudentPages)
    }
  }, [studentPage, totalStudentPages])

  useEffect(() => {
    setStudentPage(1)
  }, [normalizedStudentQuery])

  useEffect(() => {
    if (receiptPage > totalReceiptPages) {
      setReceiptPage(totalReceiptPages)
    }
  }, [receiptPage, totalReceiptPages])

  useEffect(() => {
    setReceiptPage(1)
  }, [selectedStudent?.id, latestReceiptId])

  const rocSheet = (className: string) => (
    <div className={className}>
      <div className="roc-print-header">
        <div>
          <p className="roc-print-title">RECIBO OFICIAL DE COBRO</p>
          <span>Subsecretaria de Educacion Media Superior</span>
          <span>Direccion General de Educacion Tecnologica Agropecuaria y Ciencias del Mar</span>
        </div>
        <div className="roc-print-meta">
          <div>
            <label>RECIBO No.</label>
            <strong>{rocNumber || 'PENDIENTE'}</strong>
          </div>
          <div>
            <label>FECHA</label>
            <strong>{formatPrintDate(printedAt)}</strong>
          </div>
        </div>
      </div>

      <div className="roc-print-grid three">
        <div>
          <label>APELLIDO PATERNO</label>
          <p>{selectedStudent?.paternalLastName ?? ''}</p>
        </div>
        <div>
          <label>APELLIDO MATERNO</label>
          <p>{selectedStudent?.maternalLastName ?? ''}</p>
        </div>
        <div>
          <label>NOMBRE(S)</label>
          <p>{selectedStudent?.firstName ?? ''}</p>
        </div>
      </div>

      <div className="roc-print-grid two">
        <div>
          <label>DOMICILIO</label>
          <p>{selectedStudent?.address ?? ''}</p>
        </div>
        <div>
          <label>R.F.C. y/o MATRICULA</label>
          <p>{selectedStudent?.rfc || selectedStudent?.enrollmentNumber || ''}</p>
        </div>
      </div>

      <div className="roc-amount-row">
        <div>
          <label>LA CANTIDAD DE $</label>
          <strong>{formatCurrency(total)}</strong>
        </div>
        <p>({amountInWords})</p>
      </div>

      <table className="roc-table">
        <thead>
          <tr>
            <th>CANTIDAD</th>
            <th>CLAVE</th>
            <th>CONCEPTO</th>
            <th>CUOTA</th>
            <th>IMPORTE</th>
          </tr>
        </thead>
        <tbody>
          {selectedConcepts.map((concept) => (
            <tr key={concept.code}>
              <td>1</td>
              <td>{concept.code}</td>
              <td>{concept.name}</td>
              <td>{formatCurrency(concept.amount)}</td>
              <td>{formatCurrency(concept.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>TOTAL</td>
            <td>{formatCurrency(total)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="roc-print-footer">
        <div>
          <label>NOMBRE Y FIRMA DEL CAJERO</label>
          <p>ENCARGADO DE INGRESOS PROPIOS</p>
        </div>
        <div>
          <label>OBSERVACION</label>
          <p>Plantilla oficial aproximada para pruebas del MVP.</p>
        </div>
      </div>
    </div>
  )

  return (
    <section className="roc-layout">
      <article className="panel compact" style={{ gridColumn: '1 / -1' }}>
        <div className="button-row">
          <button
            className={operationsTab === 'pagos' ? 'primary-button small-button' : 'secondary-button small-button'}
            onClick={() => setOperationsTab('pagos')}
            type="button"
          >
            Pago ficha
          </button>
          <button
            className={operationsTab === 'inscripcion-roc' ? 'primary-button small-button' : 'secondary-button small-button'}
            onClick={() => setOperationsTab('inscripcion-roc')}
            type="button"
          >
            Pagos
          </button>
          <button
            className={operationsTab === 'fichas' ? 'primary-button small-button' : 'secondary-button small-button'}
            onClick={() => setOperationsTab('fichas')}
            type="button"
          >
            Fichas
          </button>
          <button
            className={operationsTab === 'historial' ? 'primary-button small-button' : 'secondary-button small-button'}
            onClick={() => setOperationsTab('historial')}
            type="button"
          >
            Historial
          </button>
        </div>
      </article>

      {operationsTab === 'pagos' ? (
      <article className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Financieros</p>
            <h2>Pago de ficha e impresion de recibo</h2>
          </div>
          <span className="status-tag">Paso 1 obligatorio</span>
        </div>
        <form className="student-form" onSubmit={(event) => void onCreatePayment(event)}>
          <div className="form-grid">
            <Field label="CURP" required>
              <input maxLength={18} value={paymentForm.curp} onChange={(event) => onUpdatePaymentField('curp', event.target.value.toUpperCase())} />
            </Field>
            <Field className="span-2" label="Nombre completo" required>
              <input value={paymentForm.fullName} onChange={(event) => onUpdatePaymentField('fullName', event.target.value)} />
            </Field>
            <Field className="span-2" label="Folio">
              <input disabled value="Se genera automatico (FIC-AAAA-00001)" />
            </Field>
          </div>
          <div className="form-actions control-actions">
            <button className="primary-button" type="submit">Guardar pago e imprimir recibo</button>
          </div>
        </form>
      </article>
      ) : null}

      {operationsTab === 'inscripcion-roc' ? (
      <article className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Ingresos Propios</p>
            <h2>Paso 1: seleccionar alumno</h2>
          </div>
          <span className="status-tag">Wizard de inscripcion</span>
        </div>

        {loading ? <p>Cargando alumnos validados...</p> : null}

        <div className="student-search-row">
          <Field className="span-2" label="Buscar alumno">
            <input
              placeholder="Buscar por matricula o nombre"
              value={studentQuery}
              onChange={(event) => setStudentQuery(event.target.value)}
            />
          </Field>
        </div>

        <p className="table-summary">
          {filteredStudents.length} alumnos encontrados. Mostrando hasta {STUDENTS_PER_PAGE} por pagina.
        </p>

        {paginatedStudents.length > 0 ? (
          <div className="student-table-wrap">
            <table className="student-table">
              <thead>
                <tr>
                  <th>Matricula</th>
                  <th>Alumno</th>
                  <th>CURP</th>
                  <th>Grupo</th>
                  </tr>
                </thead>
              <tbody>
                {paginatedStudents.map((student) => {
                  const active = selectedStudent?.id === student.id

                  return (
                    <tr
                      className={active ? 'student-row active' : 'student-row'}
                      key={student.id}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onSelectStudent(student)
                        }
                      }}
                      onClick={() => onSelectStudent(student)}
                      role="button"
                      tabIndex={0}
                    >
                      <td>
                        <strong>{student.enrollmentNumber}</strong>
                      </td>
                      <td>{student.fullName}</td>
                      <td>{student.curp}</td>
                      <td>{student.groupLabel ?? 'Sin asignar'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {filteredStudents.length > STUDENTS_PER_PAGE ? (
          <div className="pagination-row">
            <button className="secondary-button small-button" disabled={studentPage === 1} onClick={() => setStudentPage((page) => Math.max(1, page - 1))} type="button">
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

        {!loading && students.length === 0 ? (
          <p className="empty-state">Todavia no hay alumnos validados. Capturalos primero en Control Escolar.</p>
        ) : null}

        {!loading && students.length > 0 && filteredStudents.length === 0 ? (
          <p className="empty-state">No hay alumnos que coincidan con la busqueda actual.</p>
        ) : null}

      </article>
      ) : null}

      {operationsTab === 'inscripcion-roc' ? (
      <article className="panel print-host">
        <div className="section-header">
          <div>
            <p className="eyebrow">ROC</p>
            <h2>Paso 2: claves, guardar e imprimir ROC</h2>
          </div>
          <span className="status-tag">{paymentConcepts.length} claves activas</span>
        </div>

        {selectedStudent ? (
          <div className="roc-panel-split">
            <div className="roc-panel-main">
              <div className="roc-preview">
                <div>
                  <label>Alumno</label>
                  <p>{selectedStudent.fullName}</p>
                </div>
                <div>
                  <label>Matricula</label>
                  <p>{selectedStudent.enrollmentNumber}</p>
                </div>
                <div>
                  <label>Grupo</label>
                  <p>{selectedStudent.groupLabel ?? 'Sin asignar'}</p>
                </div>
              </div>

              <div className="concept-groups">
                <div className="concept-search-row">
                  <Field className="span-2" label="Buscar clave o concepto">
                    <input
                      placeholder="Ej. B002, examenes, documentos..."
                      value={conceptQuery}
                      onChange={(event) => onChangeConceptQuery(event.target.value)}
                    />
                  </Field>
                </div>

                {filteredPaymentConcepts.length === 0 ? (
                  <p className="empty-state">No hay claves que coincidan con la busqueda.</p>
                ) : null}

                <p className="table-summary">Selecciona las claves a cobrar. Vista compacta para operar rapido en ventanilla.</p>

                <div className="student-table-wrap">
                  <table className="student-table">
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
                          <tr className={active ? 'student-row active' : 'student-row'} key={concept.code}>
                            <td><strong>{concept.code}</strong></td>
                            <td>{concept.name}</td>
                            <td>
                              <input
                                className="table-input"
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

              <div className="roc-actions">
                <Field label="Numero de ROC" required>
                  <input value={rocNumber} onChange={(event) => onChangeRocNumber(event.target.value)} />
                </Field>
                <div className="button-row">
                  <button className="secondary-button" disabled={savingReceipt} onClick={() => void onPrintReceipt()} type="button">
                    Guardar e imprimir ROC
                  </button>
                  <button className="secondary-button" onClick={() => void onPrintBatchReceipts()} type="button">
                    Generar lote final 2 por hoja
                  </button>
                  <button className="primary-button" disabled={savingReceipt} onClick={() => void onCreateReceipt()} type="button">
                    {savingReceipt ? 'Guardando ROC...' : 'Guardar ROC'}
                  </button>
                </div>
              </div>

              <div className="receipt-summary">
                <h3>Resumen del ROC</h3>
                <ul className="plain-list">
                  {selectedConcepts.map((concept) => (
                    <li key={concept.code}>
                      {concept.code} - {concept.name} - ${(conceptAmounts[concept.code] ?? concept.amount).toFixed(2)}
                    </li>
                  ))}
                </ul>
                <p className="total">Total: ${total.toFixed(2)}</p>
              </div>

              <div className="receipt-history">
                <h3>Historial del alumno</h3>
                {receipts.length === 0 ? <p className="empty-state">Este alumno aun no tiene ROC registrados.</p> : null}
                {paginatedReceipts.map((receipt) => (
                  <article className="history-card" key={receipt.id}>
                    <strong>{receipt.rocNumber}</strong>
                    <span>{new Date(receipt.issuedAt).toLocaleString('es-MX')}</span>
                    <span>Estatus: {receipt.status}</span>
                    <span>{receipt.conceptLabels.join(' | ')}</span>
                    <div className="history-card-footer">
                      <em>Total: ${receipt.totalAmount.toFixed(2)}</em>
                      <button className="secondary-button small-button" onClick={() => void onReprintReceipt(receipt.id)} type="button">
                        Reimprimir
                      </button>
                    </div>
                  </article>
                ))}

                {receipts.length > RECEIPTS_PER_PAGE ? (
                  <div className="pagination-row">
                    <button className="secondary-button small-button" disabled={receiptPage === 1} onClick={() => setReceiptPage((page) => Math.max(1, page - 1))} type="button">
                      Anterior
                    </button>
                    <span>
                      Pagina {receiptPage} de {totalReceiptPages}
                    </span>
                    <button
                      className="secondary-button small-button"
                      disabled={receiptPage === totalReceiptPages}
                      onClick={() => setReceiptPage((page) => Math.min(totalReceiptPages, page + 1))}
                      type="button"
                    >
                      Siguiente
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="roc-print-sheet print-only">{rocSheet('')}</div>
          </div>
        ) : null}

        {!selectedStudent ? <p className="empty-state">Primero selecciona un alumno en el Paso 1 para continuar con ROC.</p> : null}
      </article>
      ) : null}

      {operationsTab === 'fichas' ? (
      <article className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Etapa 1</p>
            <h2>Impresion ficha</h2>
          </div>
        </div>
        <div className="student-table-wrap">
          <table className="student-table">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Alumno</th>
                <th>Estatus</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {admissions.slice(0, 12).map((admission) => {
                const canPrint = admission.status === 'CAPTURADO_CONTROL_ESCOLAR' || admission.status === 'FICHA_IMPRESA'
                return (
                  <tr key={admission.id}>
                    <td>{admission.folio}</td>
                    <td>{admission.fullName}</td>
                    <td>{admission.status}</td>
                    <td>
                      <button className="secondary-button small-button" onClick={() => void onPrintPaymentReceipt(admission)} type="button">
                        Reimprimir recibo
                      </button>{' '}
                      <button className="secondary-button small-button" disabled={!canPrint} onClick={() => void onPrintAdmission(admission)} type="button">
                        Imprimir ficha
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </article>
      ) : null}

      {operationsTab === 'historial' ? (
      <article className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">ROC</p>
            <h2>ROC generados (todos)</h2>
          </div>
          <span className="status-tag">{allReceipts.length} registros</span>
        </div>

        <div className="roc-history-cards">
          {recentAllReceipts.length === 0 ? <p className="empty-state">Todavia no hay ROC generados.</p> : null}
          {recentAllReceipts.map((receipt) => (
            <article className="history-card compact" key={receipt.id}>
              <strong>{receipt.rocNumber}</strong>
              <span>{new Date(receipt.issuedAt).toLocaleString('es-MX')}</span>
              <span>{receipt.studentName}</span>
              <em>Total: ${receipt.totalAmount.toFixed(2)}</em>
            </article>
          ))}
        </div>
      </article>
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
