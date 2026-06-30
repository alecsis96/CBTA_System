import { FormEvent, Fragment, MutableRefObject, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { browserFallbackApi } from '@/lib/browser-fallback'
import { createHybridApi } from '@/lib/hybrid-api'
import {
  type PreRegistrationStatusUpdate,
} from '@/components/control-escolar/panels'
import { AppHeader } from '@/components/app-header'
import { amountToWords } from '@/lib/formatters'
import { addPendingSyncOp, getDeviceId } from '@/lib/sync-queue'
import { getSyncStatusSnapshot, syncAll, type SyncStatusSnapshot } from '@/lib/sync-service'
import { useAuth, useSync, useFeedback, useRocNumber } from '@/lib/hooks'
import {
  relationshipOptions,
  CONTROL_STUDENTS_PER_PAGE,
  RECEIPTS_PER_PAGE,
  INSCRIPTION_CONCEPT_CODE,
  isSelectableConcept,
  resolveGroupKey,
  conceptGroupHeaders,
  groupConcepts,
  groupedSelectableConcepts,
  deriveGradeFromGroup,
  formatVisibleGroupLabel,
  formatPreferredEnrollment,
  dailyStatusClassName,
  splitFullName,
  getOutputFileName,
  extractOutputFileNameFromFeedback,
  normalizeFeedbackMessage,
  toLocalDateInputValue,
  toLocalDateTimeInputValue,
} from '@/lib/utils'
import { highlightMatch, escapeRegex } from '@/lib/text-utils'
import { groupSexBalanceLabel, groupBandBalanceLabel } from '@/lib/group-stats'
import { pickRosterWorkbookFile, parseRosterWorkbook } from '@/lib/roster-import'
import { Field } from '@/components/ui/Field'
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
  GroupStat,
  StudentDailyStatusSetInput,
  StudentFormInput,
  StudentPermissionCancelInput,
  StudentPermissionCreateInput,
  StudentPermissionSummary,
  StudentSummary,
} from '@/types/domain'
import type { DepartmentSummary, UserCreateInput, UserSummary, UserUpdateInput } from '@/types/admin'
import { ControlEscolarOverview } from './ControlEscolarOverview'
import { SecretariaOverview } from './SecretariaOverview'
import { IngresosPropiosOverview } from './IngresosPropiosOverview'
import { ConfiguracionTarifasOverview } from './ConfiguracionTarifasOverview'
import { FloatingFeedbackToast } from './FloatingFeedbackToast'

type Screen = 'control-escolar' | 'ingresos-propios' | 'secretaria' | 'configuracion'
type FeedbackScope = 'control-escolar' | 'ingresos-propios' | 'secretaria' | 'configuracion' | 'sync'

const CURRENT_DATE = new Date()

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
  semesterLevel: 1,
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
  const [activeModule, setActiveModule] = useState<'menu' | 'control' | 'ingresos'>('menu')
  const desktopApi = typeof window !== 'undefined' && 'cbta' in window ? window.cbta : null
  const localApi = (desktopApi ?? browserFallbackApi) as Window['cbta']
  const isBrowserMode = !desktopApi
  
  // Estados básicos
  const [screen, setScreen] = useState<Screen>('control-escolar')
  const [students, setStudents] = useState<StudentSummary[]>([])
  const [preRegistrations, setPreRegistrations] = useState<PreRegistrationSummary[]>([])
  const [admissions, setAdmissions] = useState<AdmissionSummary[]>([])
  const [paymentForm, setPaymentForm] = useState<AdmissionCreatePaymentInput>(initialPaymentForm)
  const [captureQuery, setCaptureQuery] = useState('')
  const [activeAdmission, setActiveAdmission] = useState<AdmissionSummary | null>(null)
  const [validatedStudents, setValidatedStudents] = useState<StudentSummary[]>([])
  const [selectedStudent, setSelectedStudent] = useState<StudentSummary | null>(null)
  const [studentPermissions, setStudentPermissions] = useState<StudentPermissionSummary[]>([])
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
  const [newlyCreatedStudentId, setNewlyCreatedStudentId] = useState<string | null>(null)
  const [isRecentActivityCollapsed, setIsRecentActivityCollapsed] = useState(false)
  const studentsSectionRef = useRef<HTMLElement | null>(null)
  const captureSectionRef = useRef<HTMLElement | null>(null)
  const ingresosFeedbackTimerRef = useRef<number | null>(null)

  // Hooks personalizados
  const { 
    authSession, 
    authForm, 
    setAuthForm,
    rememberCredentials, 
    setRememberCredentials,
    authLoading, 
    authSaving,
    authError,
    setAuthError,
    handleLogin: performLogin,
    handleLogout: performLogout,
  } = useAuth({
    api: localApi,
  })

  const { feedbackByScope, setFeedback: setFeedbackScoped, clearAllFeedback } = useFeedback()

  const { 
    isOnline, 
    syncStatus, 
    syncing,
    handleSyncNow: performSyncNow,
    refreshSyncStatus,
  } = useSync({})

  const {
    rocNumber,
    handleChangeRocNumber,
    suggestedRocNumber,
    rocInitialNumber,
    setRocInitialNumber,
    applySuggestedRocNumber,
    resetEditedFlag: resetRocEditedFlag,
  } = useRocNumber()

  const appApi = useMemo(() => createHybridApi(localApi, () => authSession), [localApi, authSession])
  const insuranceConcept = useMemo(() => concepts.find((concept) => concept.isLifeInsurance) ?? null, [concepts])
  const inscriptionSelected = selectedConcepts.some((concept) => concept.code === INSCRIPTION_CONCEPT_CODE)

  function setFeedback(message: string | null, scope: FeedbackScope = screen) {
    setFeedbackScoped(scope, message)
  }

  function setControlFeedback(message: string | null) {
    setFeedback(message, 'control-escolar')
  }

  function setIngresosFeedback(message: string | null) {
    setFeedback(message, 'ingresos-propios')
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

  const feedback = feedbackByScope[screen]

  // Cargar datos cuando la sesión esté disponible
  useEffect(() => {
    if (authSession && !authLoading) {
      void loadData(authSession)
    }
  }, [authSession, authLoading])

  useEffect(() => {
    if (!authSession) {
      return
    }

    if (!canAccessScreen(authSession.role, screen)) {
      setScreen(defaultScreenByRole(authSession.role))
    }
  }, [authSession, screen])

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
      const role = sessionForAdmin?.role ?? null
      const canManageControl = role === 'ADMIN' || role === 'CONTROL_ESCOLAR'
      const canManageIngresos = role === 'ADMIN' || role === 'INGRESOS_PROPIOS'
      const canManageSecretaria = role === 'ADMIN' || role === 'SECRETARIA'
      const receiptsAllPromise =
        canManageIngresos && typeof appApi.receipts.listAll === 'function' ? appApi.receipts.listAll() : Promise.resolve([])
      const cashPaymentsPromise =
        canManageIngresos && typeof appApi.payments?.list === 'function' ? appApi.payments.list() : Promise.resolve([])
      const admissionsPromise =
        canManageControl && typeof appApi.admissions?.list === 'function' ? appApi.admissions.list() : Promise.resolve([])
      const rocConfigPromise =
        canManageIngresos && typeof appApi.receipts.getConfig === 'function'
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
      const permissionsPromise =
        canManageSecretaria && typeof appApi.permissions?.list === 'function'
          ? appApi.permissions.list()
          : Promise.resolve([])

      const [allStudents, preRegistrations, validatedStudents, activeConcepts, auditLogs, receiptsAll, cashPayments, admissions, rocConfig, adminUsers, departments, permissions] = await Promise.all([
        appApi.students.list(),
        canManageControl && typeof appApi.preRegistrations?.list === 'function' ? appApi.preRegistrations.list() : Promise.resolve([]),
        typeof appApi.students.listValidated === 'function' ? appApi.students.listValidated() : Promise.resolve([]),
        canManageIngresos && typeof appApi.concepts?.listActive === 'function' ? appApi.concepts.listActive() : Promise.resolve([]),
        appApi.audit.listRecent(),
        receiptsAllPromise,
        cashPaymentsPromise,
        admissionsPromise,
        rocConfigPromise,
        adminUsersPromise,
        departmentsPromise,
        permissionsPromise,
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
      setStudentPermissions(permissions)
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
    if (role === 'SECRETARIA') return 'secretaria'
    return 'configuracion'
  }

  function canAccessScreen(role: AppRole, target: Screen) {
    if (role === 'ADMIN') return true
    if (role === 'CONTROL_ESCOLAR') return target === 'control-escolar'
    if (role === 'INGRESOS_PROPIOS') return target === 'ingresos-propios' || target === 'configuracion'
    if (role === 'SECRETARIA') return target === 'secretaria'
    return false
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const session = await performLogin()
      setScreen(defaultScreenByRole(session.role))
    } catch (error) {
      // Error already handled by the hook
    }
  }

  async function handleLogout() {
    await performLogout()
    clearAllFeedback()
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
        // Guardar ID para abrir checklist automáticamente
        setNewlyCreatedStudentId(created.id)
      }
      refreshSyncStatus()

      const wasEditing = editingStudentId !== null
      setEditingStudentId(null)
      setActiveAdmission(null)
      setForm(initialForm)
      setControlFeedback(
        wasEditing
          ? 'Alumno actualizado correctamente desde Control Escolar.'
          : 'Alumno guardado correctamente. Ahora marca los documentos entregados en el checklist.',
      )
      await loadData()
      if (!wasEditing) {
        await prepareNextInternalFolio()
      }
      // Ya NO cambiamos automáticamente a ingresos-propios para poder mostrar el checklist
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
      setIngresosFeedback('Pago de inscripción registrado. Control Escolar ya puede identificar este CURP como pagado.')
      scheduleIngresosFeedbackClear()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar el pago de inscripción.'
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
      resetRocEditedFlag()
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
      resetRocEditedFlag()
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
      setConfigFeedback('Contraseña restablecida correctamente.')
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
      resetRocEditedFlag()
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
      resetRocEditedFlag()
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

  async function handleCreateStudentPermission(input: StudentPermissionCreateInput) {
    if (typeof appApi.permissions?.create !== 'function') {
      throw new Error('La captura de permisos no esta disponible en esta version.')
    }

    const permission = await appApi.permissions.create(input)
    await loadData()
    setControlFeedback(null)
    setConfigFeedback(null)
    setSyncFeedback(null)
    setFeedback(`Permiso registrado para ${permission.studentName}.`, 'secretaria')
    return permission
  }

  async function handleCancelStudentPermission(input: StudentPermissionCancelInput) {
    if (typeof appApi.permissions?.cancel !== 'function') {
      throw new Error('La cancelacion de permisos no esta disponible en esta version.')
    }

    const permission = await appApi.permissions.cancel(input)
    await loadData()
    setFeedback(`Permiso cancelado para ${permission.studentName}.`, 'secretaria')
    return permission
  }

  async function handleSetStudentDailyStatus(input: StudentDailyStatusSetInput) {
    if (typeof appApi.permissions?.setDailyStatus !== 'function') {
      throw new Error('El estatus diario no esta disponible en esta version.')
    }

    const student = await appApi.permissions.setDailyStatus(input)
    await loadData()
    setFeedback(`Estatus del dia actualizado para ${student.fullName}.`, 'secretaria')
    return student
  }

  async function handleClearStudentDailyStatus(studentId: string, date: string) {
    if (typeof appApi.permissions?.clearDailyStatus !== 'function') {
      throw new Error('La limpieza de estatus diario no esta disponible en esta version.')
    }

    const student = await appApi.permissions.clearDailyStatus({ studentId, date })
    await loadData()
    setFeedback(`Estatus del dia restablecido para ${student.fullName}.`, 'secretaria')
    return student
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

  const activePermissionsCount = studentPermissions.filter((permission) => permission.status === 'ACTIVO').length
  const headerMetaItems =
    screen === 'control-escolar'
      ? [`Alumnos ${students.length}`, `Validados ${validatedStudents.length}`]
      : screen === 'ingresos-propios'
        ? [`Cobros ${cashPayments.length}`, `ROC ${allReceipts.length}`]
        : screen === 'secretaria'
          ? [`Permisos activos ${activePermissionsCount}`, `Alumnos ${students.length}`]
          : authSession?.role === 'INGRESOS_PROPIOS'
            ? [`Tarifas ${concepts.filter(isSelectableConcept).length}`, `ROC ${suggestedRocNumber}`]
            : [`Usuarios ${adminUsers.length}`, `Departamentos ${departments.length}`]
  const roleNavigationItems = [
    { screen: 'control-escolar' as const, label: 'Control Escolar' },
    { screen: 'ingresos-propios' as const, label: 'Ingresos Propios' },
    { screen: 'secretaria' as const, label: 'Secretaría' },
    { screen: 'configuracion' as const, label: 'Configuración' },
  ].filter((item) => canAccessScreen(authSession?.role ?? 'ADMIN', item.screen))

  if (authLoading) {
    return <div className="auth-shell"><p>Cargando sesión...</p></div>
  }

  if (!authSession) {
    return (
      <div className="auth-shell">
        <section className="auth-hero">
          <div className="auth-hero-copy">
            <p className="auth-kicker">CBTA 44 Sistema</p>
            <h1>Operación escolar y financiera en una sola ventanilla</h1>
            <p>
              Control Escolar e Ingresos Propios comparten el mismo seguimiento para inscripción,
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
              <span>Pagos de inscripción, historial y ROC por lote</span>
            </article>
          </div>
        </section>

        <form className="auth-card" onSubmit={handleLogin}>
          <div className="auth-card-header">
            <p className="eyebrow">Acceso institucional</p>
            <h2>Iniciar sesión</h2>
            <p>Ingresa con tu usuario asignado para continuar con la operación del plantel.</p>
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
            <span>Contraseña</span>
            <input
              type="password"
              placeholder="Tu contraseña"
              value={authForm.password}
              onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
            />
          </label>
          <label className="remember-auth-row">
            <input
              checked={rememberCredentials}
              onChange={(event) => setRememberCredentials(event.target.checked)}
              type="checkbox"
            />
            <span>Recordar mis datos</span>
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
    <div className="app-shell">
      <main className="app-content">
        {feedback ? <FloatingFeedbackToast message={feedback} onClose={() => setFeedback(null)} /> : null}

        <AppHeader
          authSession={authSession}
          screen={screen}
          roleNavigationItems={roleNavigationItems}
          setScreen={setScreen}
          isOnline={isOnline}
          syncStatus={syncStatus}
          syncing={syncing}
          onSyncNow={() => void performSyncNow()}
          onLogout={() => void handleLogout()}
        />

        {isBrowserMode ? (
          <p className="feedback-banner">
            Estás en modo navegador. La captura y consulta funcionan con almacenamiento local de prueba.
            Para usar SQLite real y Prisma, abre la app desde Electron.
          </p>
        ) : null}

        {screen === 'control-escolar' ? (
          <ControlEscolarOverview
            feedback={feedback}
            form={form}
            students={students}
            preRegistrations={preRegistrations}
            admissions={admissions}
            recentAuditLogs={recentAuditLogs}
            captureQuery={captureQuery}
            activeAdmission={activeAdmission}
            editingStudentId={editingStudentId}
            newlyCreatedStudentId={newlyCreatedStudentId}
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
            onClearNewlyCreatedStudent={() => setNewlyCreatedStudentId(null)}
            groupsApi={appApi.groups}
          />
        ) : screen === 'secretaria' ? (
          <SecretariaOverview
            feedback={feedback}
            students={students}
            permissions={studentPermissions}
            onCreatePermission={handleCreateStudentPermission}
            onCancelPermission={handleCancelStudentPermission}
            onSetDailyStatus={handleSetStudentDailyStatus}
            onClearDailyStatus={handleClearStudentDailyStatus}
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
            currentRole={authSession.role}
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

export type ConfiguracionTarifasProps = {
  currentRole: AppRole
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

export type FloatingFeedbackToastProps = {
  message: string
  onClose: () => void
}

export type AdminUsersOverviewProps = {
  users: UserSummary[]
  departments: DepartmentSummary[]
  currentUserId: string
  savingUserId: string | null
  onCreateUser: (input: UserCreateInput) => Promise<void>
  onUpdateUser: (userId: string, input: UserUpdateInput) => Promise<void>
  onResetUserPassword: (userId: string, password: string) => Promise<void>
}

export const roleOptions: Array<{ value: AppRole; label: string }> = [
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'CONTROL_ESCOLAR', label: 'Control Escolar' },
  { value: 'INGRESOS_PROPIOS', label: 'Ingresos Propios' },
  { value: 'SECRETARIA', label: 'Secretaría' },
]

export type EditUserModalProps = {
  user: UserSummary
  departments: DepartmentSummary[]
  currentUserId: string
  isSaving: boolean
  onClose: () => void
  onSubmit: (userId: string, input: UserUpdateInput) => Promise<void>
}

export type TariffEditorRowProps = {
  concept: ChargeConceptSummary
  isSaving: boolean
  canToggleSuggested?: boolean
  onSave: (code: string, amount: number, periodLabel: string) => Promise<void>
  onToggleSuggested: (code: string, isSuggested: boolean) => Promise<void>
}

export type ControlEscolarProps = {
  form: StudentFormInput
  students: StudentSummary[]
  preRegistrations: PreRegistrationSummary[]
  admissions: AdmissionSummary[]
  recentAuditLogs: AuditLogSummary[]
  captureQuery: string
  activeAdmission: AdmissionSummary | null
  editingStudentId: string | null
  newlyCreatedStudentId: string | null
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
  onClearNewlyCreatedStudent: () => void
  groupsApi: Window['cbta']['groups']
}

export type IngresosProps = {
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

export type SecretariaOverviewProps = {
  students: StudentSummary[]
  permissions: StudentPermissionSummary[]
  feedback: string | null
  onCreatePermission: (input: StudentPermissionCreateInput) => Promise<StudentPermissionSummary>
  onCancelPermission: (input: StudentPermissionCancelInput) => Promise<StudentPermissionSummary>
  onSetDailyStatus: (input: StudentDailyStatusSetInput) => Promise<StudentSummary>
  onClearDailyStatus: (studentId: string, date: string) => Promise<StudentSummary>
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

export default App


