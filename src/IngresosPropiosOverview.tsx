import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { type IngresosProps } from './App'
import { Field } from './components/ui/Field'
import { SearchInput } from './components/ui/SearchInput'
import {
  DashboardEmptyState,
  ModuleBarCompact,
  PanelSectionTitle,
  StatusBadge,
  SurfaceCard,
  type DashboardMetric,
} from './components/dashboard-kit'
import { formatCurrency } from './lib/formatters'
import { highlightMatch } from './lib/text-utils'
import { RECEIPTS_PER_PAGE, formatVisibleGroupLabel, isSelectableConcept } from '@/lib/utils'

export function IngresosPropiosOverview({
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
  const [openMonthlyActionMenu, setOpenMonthlyActionMenu] = useState<{ rowId: string; receiptId: string; top: number; left: number } | null>(null)
  const studentSearchRef = useRef<HTMLInputElement | null>(null)
  const monthlyActionMenuRef = useRef<HTMLDivElement | null>(null)

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
    ? paymentConcepts.filter((concept) =>
        [concept.code, concept.name, concept.description ?? ''].join(' ').toLowerCase().includes(normalizedConceptQuery),
      )
    : paymentConcepts

  const visibleStudents =
    normalizedStudentQuery.length >= 2
      ? students
          .filter((student) =>
            `${student.enrollmentNumber} ${student.fullName} ${student.curp}`.toLowerCase().includes(normalizedStudentQuery),
          )
          .slice(0, 10)
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
  const receiptPendingCancellation = cancelReceiptId
    ? allReceipts.find((receipt) => receipt.id === cancelReceiptId) ?? receipts.find((receipt) => receipt.id === cancelReceiptId) ?? null
    : null
  const monthlyUnifiedRows = useMemo(() => {
    const paymentsByStudent = new Map<string, typeof monthlyPayments>()
    const receiptsByStudent = new Map<string, typeof monthlyReceipts>()

    for (const payment of [...monthlyPayments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())) {
      const current = paymentsByStudent.get(payment.studentId) ?? []
      current.push(payment)
      paymentsByStudent.set(payment.studentId, current)
    }

    for (const receipt of [...monthlyReceipts].sort((a, b) => new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime())) {
      const current = receiptsByStudent.get(receipt.studentId) ?? []
      current.push(receipt)
      receiptsByStudent.set(receipt.studentId, current)
    }

    return monthlyPayments
      .map((payment) => {
        const studentReceipts = receiptsByStudent.get(payment.studentId) ?? []
        const studentPayments = paymentsByStudent.get(payment.studentId) ?? []
        const generatedIndex = studentPayments.filter((item) => item.status === 'ROC_GENERADO').findIndex((item) => item.id === payment.id)
        const receipt = payment.status === 'ROC_GENERADO' && generatedIndex >= 0 ? studentReceipts[generatedIndex] ?? null : null

        return {
          id: payment.id,
          rocNumber: receipt?.rocNumber ?? 'Pendiente',
          enrollmentNumber: payment.enrollmentNumber,
          studentName: payment.studentName,
          date: receipt?.issuedAt ?? payment.createdAt,
          total: receipt ? receipt.totalAmount : payment.rocTotalAmount > 0 ? payment.rocTotalAmount : payment.totalAmount,
          monthlyStatus: payment.status === 'ROC_GENERADO' ? 'Incluido en ROC mensual' : 'Pendiente de incluir',
          receipt,
        }
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [monthlyPayments, monthlyReceipts])

  const ingresosMetrics: DashboardMetric[] = [
    { label: 'Cobros registrados', value: cashPayments.length, helper: 'En caja' },
    { label: 'ROC generados', value: cashPayments.filter((payment) => payment.status === 'ROC_GENERADO').length, helper: 'Mensuales' },
    { label: 'Pendientes ROC', value: pendingPayments.length, helper: 'Por consolidar', tone: pendingPayments.length > 0 ? 'warning' : 'default' },
    { label: 'Alumnos sin cobro', value: studentsWithoutPayments.length, helper: 'En padrón' },
  ]

  useEffect(() => {
    if (receiptPage > totalReceiptPages) {
      setReceiptPage(totalReceiptPages)
    }
  }, [receiptPage, totalReceiptPages])

  useEffect(() => {
    setReceiptPage(1)
  }, [selectedStudent?.id, latestReceiptId])

  useEffect(() => {
    if (!openMonthlyActionMenu) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (monthlyActionMenuRef.current?.contains(target)) {
        return
      }

      setOpenMonthlyActionMenu(null)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMonthlyActionMenu(null)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [openMonthlyActionMenu])

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
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [operationsTab, savingReceipt, selectedConcepts.length, selectedStudent])

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
    <section className="module-dashboard ingresos-layout">
      <ModuleBarCompact
        eyebrow="Ingresos Propios"
        title="Caja y ROC oficial"
        metrics={ingresosMetrics}
        actions={<StatusBadge tone={isOnline ? 'success' : 'warning'}>{isOnline ? 'Online' : 'Offline'}</StatusBadge>}
      />

      <SurfaceCard className="dashboard-search-panel">
        <div className="operations-toolbar">
          <div className="segmented-tabs">
            <button className={operationsTab === 'caja' ? 'segmented-tab active' : 'segmented-tab'} onClick={() => setOperationsTab('caja')} type="button">
              Caja
            </button>
            <button
              className={operationsTab === 'pendientes-roc' ? 'segmented-tab active' : 'segmented-tab'}
              onClick={() => setOperationsTab('pendientes-roc')}
              type="button"
            >
              Pendientes ROC
            </button>
            <button className={operationsTab === 'historial' ? 'segmented-tab active' : 'segmented-tab'} onClick={() => setOperationsTab('historial')} type="button">
              ROC mensual
            </button>
          </div>
          <div className="operations-shortcuts">
            <span>Ctrl + K buscar alumno</span>
            <span>F2 registrar cobro</span>
          </div>
        </div>
      </SurfaceCard>

      {feedback ? <p className="feedback-banner">{feedback}</p> : null}

      {operationsTab === 'caja' ? (
        <article className="cash-dashboard-grid">
          <div className="cash-column-search">
            <SurfaceCard className="dashboard-search-panel">
              <PanelSectionTitle
                eyebrow="Caja"
                title="Buscar alumno"
                subtitle="Localiza al alumno por folio, nombre o CURP para iniciar el cobro."
              />
              <SearchInput
                ref={studentSearchRef}
                className="search-shell cash-student-search"
                placeholder="Buscar por folio interno, nombre o CURP"
                value={studentQuery}
                onChange={setStudentQuery}
                onKeyDown={onStudentSearchKeyDown}
                showShortcut
              />
            </SurfaceCard>

            <SurfaceCard className="cash-results-card">
              <PanelSectionTitle eyebrow="Coincidencias" title="Resultados del buscador" action={<StatusBadge>{visibleStudents.length}</StatusBadge>} />
              {normalizedStudentQuery.length < 2 ? (
                <DashboardEmptyState
                  title="Empieza a escribir para buscar"
                  description="Con dos caracteres o más verás coincidencias de alumnos validados."
                />
              ) : (
                <div className="student-table-wrap compact-search-results">
                  <table className="student-table">
                    <thead>
                      <tr>
                        <th>Alumno</th>
                        <th>Grado</th>
                        <th>Grupo</th>
                        <th>Estatus cobro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleStudents.length === 0 ? (
                        <tr>
                          <td colSpan={4}>
                            <p className="empty-state compact-empty-state">No hay alumnos que coincidan con la búsqueda.</p>
                          </td>
                        </tr>
                      ) : (
                        visibleStudents.map((student) => (
                          <tr
                            className={selectedStudent?.id === student.id ? 'student-row active' : 'student-row'}
                            key={student.id}
                            onClick={() => onSelectStudent(student)}
                            role="button"
                            tabIndex={0}
                          >
                            <td>{highlightMatch(student.fullName, studentQuery)}</td>
                            <td>{student.semesterLevel}°</td>
                            <td>{formatVisibleGroupLabel(student.groupLabel)}</td>
                            <td>{cashPayments.some((payment) => payment.studentId === student.id) ? 'Con cobros' : 'Sin cobro'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </SurfaceCard>
          </div>

          <div className="cash-column-concepts">
            <SurfaceCard className="cash-student-card">
              <div className="cash-card-header">
                <div>
                  <span className="detail-label">Alumno seleccionado</span>
                  <h3 className="cash-student-name">{selectedStudent ? selectedStudent.fullName : 'Sin selección'}</h3>
                </div>
                <StatusBadge>{selectedStudent ? 'Validado' : 'Pendiente'}</StatusBadge>
              </div>
              {selectedStudent ? (
                <div className="cash-student-meta-grid">
                  <div className="cash-student-meta-item cash-student-meta-primary">
                    <span className="detail-label">Folio</span>
                    <strong>{selectedStudent.enrollmentNumber}</strong>
                  </div>
                  <div className="cash-student-meta-item">
                    <span className="detail-label">Grado</span>
                    <strong>{selectedStudent.semesterLevel}°</strong>
                  </div>
                  <div className="cash-student-meta-item">
                    <span className="detail-label">Grupo</span>
                    <strong>{formatVisibleGroupLabel(selectedStudent.groupLabel)}</strong>
                  </div>
                  <div className="cash-student-meta-item">
                    <span className="detail-label">ROC históricos</span>
                    <strong>{receipts.length}</strong>
                  </div>
                </div>
              ) : (
                <DashboardEmptyState
                  title="Sin alumno seleccionado"
                  description="Elige una coincidencia para cargar sus datos antes de seleccionar claves."
                />
              )}
            </SurfaceCard>

            <SurfaceCard className="cash-concepts-card">
              <PanelSectionTitle
                eyebrow="Conceptos"
                title="Claves y conceptos de cobro"
                subtitle="Edita la cuota si hace falta y agrega las claves al resumen."
                action={<StatusBadge>{filteredPaymentConcepts.length} claves</StatusBadge>}
              />
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
                  <input placeholder="Ej. B002, exámenes, documentos..." value={conceptQuery} onChange={(event) => onChangeConceptQuery(event.target.value)} />
                </Field>
              </div>

              <p className="table-summary compact-operational-line">
                Selecciona las claves manualmente. La selección se limpia al cambiar de alumno.
              </p>

              {showLifeInsuranceOption ? (
                <label className="checkbox-field compact-insurance-row">
                  <input checked={includeLifeInsurance} onChange={(event) => onToggleLifeInsurance(event.target.checked)} type="checkbox" />
                  <span>
                    Cobrar seguro de vida ({formatCurrency(lifeInsuranceAmount)}). Este cargo se cobra junto con inscripción, pero no se imprime en el ROC.
                  </span>
                </label>
              ) : null}

              <div className="student-table-wrap compact-keys-wrap">
                <table className="student-table compact-keys-table">
                  <thead>
                    <tr>
                      <th>Clave</th>
                      <th>Concepto</th>
                      <th>Cuota</th>
                     
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPaymentConcepts.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <p className="empty-state compact-empty-state">No hay claves que coincidan con la búsqueda actual.</p>
                        </td>
                      </tr>
                    ) : null}
                    {filteredPaymentConcepts.map((concept) => {
                      const active = selectedConcepts.some((item) => item.code === concept.code)
                      return (
                        <tr className={active ? 'student-row active concept-added-row' : 'student-row'} key={concept.code}>
                          <td>
                            <strong>{concept.code}</strong>
                            {concept.isSuggested ? (
                              <div>
                                <small>Sugerida</small>
                              </div>
                            ) : null}
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
            </SurfaceCard>
          </div>

          <aside className="cash-column-summary">
            <div className="cash-summary-column">
              <SurfaceCard className="cash-summary-card">
                <div className="cash-card-header">
                  <div>
                    <span className="detail-label">Resumen del cobro</span>
                    <h3 className="cash-summary-title">Operación lista para registrar</h3>
                  </div>
                  <StatusBadge>{selectedConcepts.length} claves</StatusBadge>
                </div>

                {!selectedStudent ? (
                  <DashboardEmptyState
                    title="Selecciona un alumno"
                    description="Primero elige un alumno del listado y después agrega las claves de cobro."
                  />
                ) : selectedConceptLabels.length > 0 ? (
                  <>
                    <span className="detail-label">{selectedStudent.fullName}</span>
                    <div className="cash-summary-list">
                      {selectedConceptLabels.map((concept) => (
                        <div className="cash-summary-item" key={concept.concept.code}>
                          <div>
                            <strong>{concept.concept.code}</strong>
                            <span>{concept.concept.name}</span>
                          </div>
                          <strong>{formatCurrency(concept.amount)}</strong>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <DashboardEmptyState
                    title="Agrega una clave para preparar el cobro"
                    description="El resumen se va llenando conforme eliges conceptos de la tabla."
                  />
                )}

                <div className="cash-summary-total">
                  <span>Total a cobrar</span>
                  <strong>{formatCurrency(total)}</strong>
                </div>

                <div className="cash-summary-actions">
                  <button
                    className="primary-button cash-submit-button"
                    disabled={savingReceipt || !selectedStudent || selectedConcepts.length === 0}
                    onClick={() => void handleCreatePaymentAndKeepCapturing()}
                    type="button"
                  >
                    Registrar cobro
                  </button>
                  <button className="secondary-button" onClick={() => setOperationsTab('historial')} type="button">
                    Generar ROC
                  </button>
                  <button
                    className="tertiary-button"
                    disabled={!selectedStudent && selectedConcepts.length === 0 && studentQuery.length === 0}
                    onClick={handleResetCashDesk}
                    type="button"
                  >
                    Limpiar
                  </button>
                </div>
              </SurfaceCard>

              <details className="receipt-history receipt-history-panel">
                <summary>Historial del alumno ({selectedStudent ? receipts.length : 0})</summary>
                {!selectedStudent ? (
                  <p className="empty-state">Selecciona un alumno para consultar su historial.</p>
                ) : receipts.length === 0 ? (
                  <p className="empty-state">Este alumno aún no tiene ROC registrados.</p>
                ) : (
                  paginatedReceipts.map((receipt) => (
                    <article className="history-card compact" key={receipt.id}>
                      <strong>{receipt.rocNumber}</strong>
                      <span>{new Date(receipt.issuedAt).toLocaleString('es-MX')}</span>
                      <span>{receipt.conceptLabels.join(' | ')}</span>
                      <div className="history-card-footer">
                        <em>
                          Total: {formatCurrency(receipt.totalAmount)} · {receipt.status}
                        </em>
                        <div className="button-row">
                          {receipt.status !== 'ANULADO' ? (
                            <button className="secondary-button small-button" onClick={() => void onReprintReceipt(receipt.id)} type="button">
                              Reimprimir
                            </button>
                          ) : (
                            <span className="status-tag status-tag-muted">Anulado</span>
                          )}
                          {receipt.status !== 'ANULADO' ? (
                            <button
                              className="tertiary-button small-button"
                              onClick={() => {
                                setCancelReceiptId(receipt.id)
                                setCancelReceiptReason('')
                              }}
                              type="button"
                            >
                              Anular
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </details>
            </div>
          </aside>
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
            Esta vista queda solo como cola operativa rápida. Lo mensual se consolida en ROC mensual.
          </p>

          <div className="student-table-wrap monthly-roc-table-wrap">
            <table className="student-table monthly-roc-table">
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
                    <td>
                      {formatCurrency(payment.totalAmount)}
                      {payment.externalTotalAmount > 0 ? <div><small>ROC: {formatCurrency(payment.rocTotalAmount)}</small></div> : null}
                    </td>
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
              <p className="metric-label">Cobros ya registrados, pero aún no incluidos en el ROC mensual.</p>
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
            Aquí se trabaja el corte mensual. Caja solo cobra; desde esta vista se consolida el periodo y Excel se abre automáticamente al generar o reimprimir.
          </p>

          <div className="student-table-wrap monthly-roc-history-table-wrap">
            <table className="student-table monthly-roc-history-table">
              <thead>
                <tr>
                  <th>ROC emitido</th>
                  <th>Folio</th>
                  <th>Alumno</th>
                  <th>Fecha</th>
                  <th>Total</th>
                  <th>Estatus mensual</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {monthlyUnifiedRows.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <p className="empty-state">Todavía no hay cobros acumulados para este mes.</p>
                    </td>
                  </tr>
                ) : null}
                {monthlyUnifiedRows.map((row) => {
                  const activeReceipt = row.receipt && row.receipt.status !== 'ANULADO' ? row.receipt : null
                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.rocNumber}</strong>
                      </td>
                      <td>{row.enrollmentNumber}</td>
                      <td>{row.studentName}</td>
                      <td>{new Date(row.date).toLocaleString('es-MX')}</td>
                      <td>{formatCurrency(row.total)}</td>
                      <td>
                        <span className={row.receipt?.status === 'ANULADO' ? 'status-tag status-tag-muted' : row.receipt ? 'status-tag success' : 'status-tag warning'}>
                          {row.monthlyStatus}
                        </span>
                      </td>
                      <td>
                        <div className="monthly-roc-actions">
                          {activeReceipt ? (
                            <button className="secondary-button small-button" onClick={() => void onReprintReceipt(activeReceipt.id)} type="button">
                              Reimprimir
                            </button>
                          ) : row.receipt?.status === 'ANULADO' ? (
                            <span className="status-tag status-tag-muted">Anulado</span>
                          ) : (
                            <span className="status-tag">Pendiente</span>
                          )}
                          {activeReceipt ? (
                            <div className="monthly-roc-actions-menu">
                              <button
                                aria-expanded={openMonthlyActionMenu?.rowId === row.id}
                                aria-haspopup="menu"
                                className="tertiary-button small-button monthly-roc-actions-trigger"
                                onClick={(event) => {
                                  const rect = event.currentTarget.getBoundingClientRect()
                                  setOpenMonthlyActionMenu((current) =>
                                    current?.rowId === row.id
                                      ? null
                                      : {
                                          rowId: row.id,
                                          receiptId: activeReceipt.id,
                                          top: rect.bottom + 6,
                                          left: Math.max(rect.right - 140, 16),
                                        },
                                  )
                                }}
                                type="button"
                              >
                                <span className="sr-only">Más acciones</span>
                                <span aria-hidden="true" className="monthly-roc-actions-dots">
                                  <span />
                                  <span />
                                  <span />
                                </span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
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
                <p className="eyebrow">Anulación de ROC</p>
                <h2 className="compact-header">{receiptPendingCancellation.rocNumber}</h2>
              </div>
              <button
                className="tertiary-button small-button"
                onClick={() => {
                  setCancelReceiptId(null)
                  setCancelReceiptReason('')
                }}
                type="button"
              >
                Cerrar
              </button>
            </div>

            <p className="table-summary">
              Vas a anular el ROC de <strong>{receiptPendingCancellation.studentName}</strong>. Si el sistema encuentra el cobro asociado, lo va a devolver a pendientes de ROC.
            </p>

            <Field label="Motivo de anulación" required>
              <textarea
                rows={4}
                value={cancelReceiptReason}
                onChange={(event) => setCancelReceiptReason(event.target.value)}
                placeholder="Explica por qué se anula este ROC..."
              />
            </Field>

            <div className="button-row">
              <button
                className="tertiary-button"
                onClick={() => {
                  setCancelReceiptId(null)
                  setCancelReceiptReason('')
                }}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="primary-button"
                disabled={submittingCancelReceipt || cancelReceiptReason.trim().length < 3}
                onClick={() => void handleConfirmCancelReceipt()}
                type="button"
              >
                {submittingCancelReceipt ? 'Anulando...' : 'Confirmar anulación'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {openMonthlyActionMenu
        ? createPortal(
            <div
              ref={monthlyActionMenuRef}
              className="monthly-roc-actions-popover"
              role="menu"
              style={{
                position: 'fixed',
                top: `${openMonthlyActionMenu.top}px`,
                left: `${openMonthlyActionMenu.left}px`,
              }}
            >
              <button
                className="monthly-roc-actions-item danger"
                onClick={() => {
                  setOpenMonthlyActionMenu(null)
                  setCancelReceiptId(openMonthlyActionMenu.receiptId)
                  setCancelReceiptReason('')
                }}
                type="button"
              >
                Anular
              </button>
            </div>,
            document.body,
          )
        : null}
    </section>
  )
}
