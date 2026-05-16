import { FormEvent, Fragment, MutableRefObject, ReactNode, RefObject, useEffect, useRef, useState } from 'react'
import { browserFallbackApi } from '@/lib/browser-fallback'
import { amountToWords, formatCurrency, formatPrintDate } from '@/lib/formatters'
import { addPendingSyncOp, clearPendingSyncOps, getDeviceId, listPendingSyncOps } from '@/lib/sync-queue'
import { syncNow } from '@/lib/sync-service'
import type { AuditLogSummary, ChargeConceptSummary, RocReceiptSummary, StudentFormInput, StudentSummary } from '@/types/domain'

type Screen = 'control-escolar' | 'ingresos-propios' | 'configuracion'

const controlEscolarFields = [
  'Nombre completo',
  'CURP obligatoria',
  'RFC opcional',
  'Fecha de nacimiento',
  'Domicilio',
  'Telefono del alumno',
  'Tutor y telefono',
  'Promedio de secundaria',
  'Ciclo escolar',
]

const sexOptions = ['Masculino', 'Femenino', 'Otro']
const relationshipOptions = ['Padre', 'Madre', 'Tutor', 'Abuelo', 'Abuela', 'Otro']

const STUDENTS_PER_PAGE = 10
const CONTROL_STUDENTS_PER_PAGE = 20
const RECEIPTS_PER_PAGE = 5

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
  email: '',
  addressLine: '',
  neighborhood: '',
  locality: '',
  municipality: 'Yajalon',
  state: 'Chiapas',
  postalCode: '29930',
  previousSchool: '',
  secondaryAverage: null,
  schoolCycle: '2026-2027',
  academicStatus: 'Regular',
  guardianFullName: '',
  guardianRelationship: '',
  guardianPhone: '',
  guardianEmail: '',
  validateNow: true,
}

function App() {
  const desktopApi = typeof window !== 'undefined' && 'cbta' in window ? window.cbta : null
  const appApi = desktopApi ?? browserFallbackApi
  const isBrowserMode = !desktopApi
  const [screen, setScreen] = useState<Screen>('control-escolar')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [students, setStudents] = useState<StudentSummary[]>([])
  const [validatedStudents, setValidatedStudents] = useState<StudentSummary[]>([])
  const [selectedStudent, setSelectedStudent] = useState<StudentSummary | null>(null)
  const [concepts, setConcepts] = useState<ChargeConceptSummary[]>([])
  const [selectedConcepts, setSelectedConcepts] = useState<ChargeConceptSummary[]>([])
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
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [pendingSyncCount, setPendingSyncCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const studentsSectionRef = useRef<HTMLElement | null>(null)
  const captureSectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    setPendingSyncCount(listPendingSyncOps().length)

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

      const [allStudents, validatedStudents, activeConcepts, auditLogs, receiptsAll] = await Promise.all([
        appApi.students.list(),
        appApi.students.listValidated(),
        appApi.concepts.listActive(),
        appApi.audit.listRecent(),
        receiptsAllPromise,
      ])

      setStudents(allStudents)
      setValidatedStudents(validatedStudents)
      setConcepts(activeConcepts)
      setRecentAuditLogs(auditLogs)
      setAllReceipts(receiptsAll)
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
      setFeedback(message)
    } finally {
      setLoading(false)
    }
  }

  async function loadReceipts(studentId: string) {
    const studentReceipts = await appApi.receipts.listByStudent(studentId)
    setReceipts(studentReceipts)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setFeedback(null)

    try {
      if (editingStudentId) {
        const updated = await appApi.students.update(editingStudentId, form)
        addPendingSyncOp({
          type: 'STUDENT_UPDATE',
          entityId: updated.id,
          payload: { studentId: updated.id },
          deviceId: getDeviceId(),
        })
      } else {
        const created = await appApi.students.create(form)
        addPendingSyncOp({
          type: 'STUDENT_CREATE',
          entityId: created.id,
          payload: { studentId: created.id },
          deviceId: getDeviceId(),
        })
      }
      setPendingSyncCount(listPendingSyncOps().length)

      const wasEditing = editingStudentId !== null
      setEditingStudentId(null)
      setForm(initialForm)
      setFeedback(
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
      setFeedback(message)
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

  async function handleEditStudent(studentId: string) {
    setFeedback(null)

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
      setFeedback(message)
    }
  }

  function handleCancelEdit() {
    setEditingStudentId(null)
    setForm(initialForm)
    setFeedback(null)
  }

  function toggleConcept(concept: ChargeConceptSummary) {
    setSelectedConcepts((current) => {
      const exists = current.some((item) => item.code === concept.code)
      if (exists) {
        return current.filter((item) => item.code !== concept.code)
      }

      return [...current, concept]
    })
  }

  async function handleCreateReceipt() {
    if (!selectedStudent) {
      setFeedback('Selecciona primero un alumno validado.')
      return
    }

    if (!rocNumber.trim()) {
      setFeedback('Captura el numero de ROC antes de emitir.')
      return
    }

    if (selectedConcepts.length === 0) {
      setFeedback('Selecciona al menos un concepto para emitir el ROC.')
      return
    }

    setSavingReceipt(true)
    setFeedback(null)

    try {
      const createdReceipt = await appApi.receipts.create({
        rocNumber,
        studentId: selectedStudent.id,
        conceptCodes: selectedConcepts.map((concept) => concept.code),
      })
      addPendingSyncOp({
        type: 'RECEIPT_CREATE',
        entityId: createdReceipt.id,
        payload: { receiptId: createdReceipt.id, studentId: selectedStudent.id },
        deviceId: getDeviceId(),
      })
      setPendingSyncCount(listPendingSyncOps().length)
      setAllReceipts((current) => [createdReceipt, ...current])
      await loadReceipts(selectedStudent.id)
      await loadData()
      setFeedback('ROC guardado correctamente en el historial del alumno.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar el ROC.'
      setFeedback(message)
    } finally {
      setSavingReceipt(false)
    }
  }

  async function handleReprintReceipt(receiptId: string) {
    setFeedback(null)

    try {
      await appApi.receipts.reprint(receiptId)
      addPendingSyncOp({
        type: 'RECEIPT_REPRINT',
        entityId: receiptId,
        payload: { receiptId },
        deviceId: getDeviceId(),
      })
      setPendingSyncCount(listPendingSyncOps().length)

      setAllReceipts((current) =>
        current.map((receipt) =>
          receipt.id === receiptId ? { ...receipt, status: 'REIMPRESO' } : receipt,
        ),
      )

      if (selectedStudent) {
        await loadReceipts(selectedStudent.id)
      }

      await loadData()
      setFeedback(
        isBrowserMode
          ? 'Reimpresion lanzada en modo navegador.'
          : 'Se genero una nueva copia del ROC oficial desde el historial.',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo reimprimir el ROC.'
      setFeedback(message)
    }
  }

  async function handleUpdateTariff(code: string, amount: number, periodLabel: string) {
    setSavingTariffCode(code)
    setFeedback(null)

    try {
      await appApi.concepts.updateTariff({ code, amount, periodLabel })
      await loadData()
      setFeedback(`Tarifa actualizada para ${code}: $${amount.toFixed(2)} en ${periodLabel}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar la tarifa.'
      setFeedback(message)
    } finally {
      setSavingTariffCode(null)
    }
  }

  function handlePrintReceipt() {
    if (!selectedStudent || selectedConcepts.length === 0) {
      setFeedback('Selecciona un alumno y al menos un concepto antes de imprimir.')
      return
    }

    if (desktopApi) {
      void desktopApi.receipts
        .openOfficialTemplate({
          rocNumber,
          studentId: selectedStudent.id,
          conceptCodes: selectedConcepts.map((concept) => concept.code),
        })
        .then(() => {
          setFeedback('Se genero un archivo nuevo desde la plantilla oficial de Excel y se abrio en Excel.')
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'No se pudo abrir la plantilla oficial de Excel.'
          setFeedback(message)
        })
      return
    }

    void appApi.receipts.openOfficialTemplate({
      rocNumber,
      studentId: selectedStudent.id,
      conceptCodes: selectedConcepts.map((concept) => concept.code),
    })
  }

  const total = selectedConcepts.reduce((sum, concept) => sum + concept.amount, 0)

  function handleSimulateSync() {
    clearPendingSyncOps()
    setPendingSyncCount(0)
    setFeedback('Cola local de sincronizacion marcada como enviada.')
  }

  async function handleSyncNow() {
    setSyncing(true)
    try {
      const result = await syncNow()
      setPendingSyncCount(listPendingSyncOps().length)
      setFeedback(result.message)
    } finally {
      setSyncing(false)
    }
  }

  function handleQuickScroll(target: RefObject<HTMLElement | null>) {
    setScreen('control-escolar')
    setTimeout(() => {
      target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  return (
    <div className={isSidebarCollapsed ? 'shell collapsed' : 'shell'}>
      <aside className={isSidebarCollapsed ? 'sidebar collapsed' : 'sidebar'}>
        <div className="sidebar-brand">
          <div>
            <p className="eyebrow">CBTA Financieros</p>
            <h1>Base inicial del MVP</h1>
            <p className="muted">
              Flujo compartido entre Control Escolar e Ingresos Propios para alumnos validados y
              emision del ROC.
            </p>
          </div>
          <button className="sidebar-toggle" onClick={() => setIsSidebarCollapsed((current) => !current)} type="button">
            {isSidebarCollapsed ? 'Expandir' : 'Colapsar'}
          </button>
        </div>

        <nav className="nav">
          <button
            className={screen === 'control-escolar' ? 'nav-item active' : 'nav-item'}
            data-short="CE"
            onClick={() => setScreen('control-escolar')}
          >
            <span>Control Escolar</span>
          </button>
          <button
            className={screen === 'ingresos-propios' ? 'nav-item active' : 'nav-item'}
            data-short="IP"
            onClick={() => setScreen('ingresos-propios')}
          >
            <span>Ingresos Propios</span>
          </button>
          <button
            className={screen === 'configuracion' ? 'nav-item active' : 'nav-item'}
            data-short="CF"
            onClick={() => setScreen('configuracion')}
          >
            <span>Configuracion</span>
          </button>
        </nav>

        <section className="panel compact">
          <h2>Recordatorios del proyecto</h2>
          <ul className="plain-list">
            <li>Operacion offline</li>
            <li>ROC con plantilla oficial</li>
            <li>Alumno validado antes del cobro</li>
            <li>Conceptos por clave y tarifa vigente</li>
          </ul>
        </section>

        <section className="panel compact">
          <h2>Sincronizacion</h2>
          <p className="muted">Estado: {isOnline ? 'Online' : 'Offline'}</p>
          <p className="muted">Pendientes locales: {pendingSyncCount}</p>
          <button className="primary-button small-button" disabled={syncing} onClick={() => void handleSyncNow()} type="button">
            {syncing ? 'Sincronizando...' : 'Sincronizar ahora'}
          </button>
          <button className="secondary-button small-button" onClick={handleSimulateSync} type="button">
            Marcar pendientes como enviados
          </button>
        </section>
      </aside>

      <main className="content">
        <section className="metrics-grid">
        {[
          { label: 'Alumnos validados', value: String(students.length), note: 'Disponibles para cobro en este ciclo.' },
          { label: 'Claves activas', value: String(concepts.length), note: 'Catalogo listo para ROC.' },
          { label: 'Modo operativo', value: 'Offline', note: 'SQLite local con Prisma y Electron.' },
        ].map((metric) => (
            <article className="metric-card" key={metric.label}>
              <p className="metric-label">{metric.label}</p>
              <strong>{metric.value}</strong>
              <span>{metric.note}</span>
            </article>
          ))}
        </section>

        {screen === 'control-escolar' ? (
          <section className="quick-actions">
            <button className="quick-action" onClick={() => handleQuickScroll(studentsSectionRef)} type="button">
              Alumnos registrados
            </button>
            <button className="quick-action" onClick={() => handleQuickScroll(captureSectionRef)} type="button">
              Captura de alumno
            </button>
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
            editingStudentId={editingStudentId}
            saving={saving}
            studentsSectionRef={studentsSectionRef}
            captureSectionRef={captureSectionRef}
            onCancelEdit={handleCancelEdit}
            onEditStudent={handleEditStudent}
            onSubmit={handleSubmit}
            onUpdateField={updateField}
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
            selectedStudent={selectedStudent}
            students={validatedStudents}
            total={total}
            conceptQuery={conceptQuery}
            onChangeRocNumber={setRocNumber}
            onCreateReceipt={handleCreateReceipt}
            onChangeConceptQuery={setConceptQuery}
            onPrintReceipt={handlePrintReceipt}
            onReprintReceipt={handleReprintReceipt}
            onSelectStudent={setSelectedStudent}
            onToggleConcept={toggleConcept}
          />
        ) : (
          <ConfiguracionTarifasOverview
            concepts={concepts}
            savingTariffCode={savingTariffCode}
            onUpdateTariff={handleUpdateTariff}
          />
        )}

        <section className="panel two-columns">
          <div>
            <h2>Campos principales de Control Escolar</h2>
            <div className="chips">
              {controlEscolarFields.map((field) => (
                <span className="chip" key={field}>
                  {field}
                </span>
              ))}
            </div>
          </div>

          <div>
            <h2>Decisiones tecnicas aplicadas</h2>
            <ul className="plain-list">
              <li>Electron + React + TypeScript para escritorio offline.</li>
              <li>Prisma + SQLite para persistencia local inicial.</li>
              <li>Modelo preparado para ROC, tarifas, plantillas y bitacora.</li>
            </ul>
          </div>
        </section>

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
  editingStudentId: string | null
  saving: boolean
  feedback: string | null
  studentsSectionRef: MutableRefObject<HTMLElement | null>
  captureSectionRef: MutableRefObject<HTMLElement | null>
  onCancelEdit: () => void
  onEditStudent: (studentId: string) => Promise<void>
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onUpdateField: <K extends keyof StudentFormInput>(field: K, value: StudentFormInput[K]) => void
}

function ControlEscolarOverview({
  form,
  students,
  editingStudentId,
  saving,
  feedback,
  studentsSectionRef,
  captureSectionRef,
  onCancelEdit,
  onEditStudent,
  onSubmit,
  onUpdateField,
}: ControlEscolarProps) {
  const [studentQuery, setStudentQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [studentPage, setStudentPage] = useState(1)
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null)
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

  return (
    <>
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
                <option value="CAPTURADO">Capturado</option>
                <option value="VALIDADO">Validado</option>
                <option value="LISTO_PARA_COBRO">Listo para cobro</option>
                <option value="COBRADO">Cobrado</option>
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
                        <td className="student-actions-cell">
                          <button
                            className="secondary-button small-button"
                            onClick={(event) => {
                              event.stopPropagation()
                              event.preventDefault()
                              setExpandedStudentId(null)
                              void onEditStudent(student.id)
                            }}
                            type="button"
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="student-detail-row">
                          <td colSpan={4}>
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

      <section className="panel" ref={captureSectionRef}>
        <div className="section-header">
          <div>
            <p className="eyebrow">Modulo 1</p>
            <h2>Captura y validacion del alumno</h2>
          </div>
          <span className="status-tag">{editingStudentId ? 'Edicion activa' : 'Captura real activa'}</span>
        </div>

        <form className="student-form" onSubmit={(event) => void onSubmit(event)}>
          <div className="form-grid">
            <Field label="Matricula" required>
              <input value={form.enrollmentNumber} onChange={(event) => onUpdateField('enrollmentNumber', event.target.value)} />
            </Field>
            <Field label="CURP" required>
              <input maxLength={18} value={form.curp} onChange={(event) => onUpdateField('curp', event.target.value.toUpperCase())} />
            </Field>
            <Field label="RFC opcional">
              <input value={form.rfc} onChange={(event) => onUpdateField('rfc', event.target.value.toUpperCase())} />
            </Field>
            <Field label="Ciclo escolar" required>
              <input value={form.schoolCycle} onChange={(event) => onUpdateField('schoolCycle', event.target.value)} />
            </Field>
          <Field label="Nombre(s)" required>
            <input value={form.firstName} onChange={(event) => onUpdateField('firstName', event.target.value)} />
          </Field>
          <Field label="Apellido paterno" required>
            <input value={form.paternalLastName} onChange={(event) => onUpdateField('paternalLastName', event.target.value)} />
          </Field>
          <Field label="Apellido materno" required>
            <input value={form.maternalLastName} onChange={(event) => onUpdateField('maternalLastName', event.target.value)} />
          </Field>
          <Field label="Fecha de nacimiento">
            <input type="date" value={form.birthDate} onChange={(event) => onUpdateField('birthDate', event.target.value)} />
          </Field>
          <Field label="Edad">
            <input
              type="number"
              min="0"
              max="120"
              inputMode="numeric"
              value={form.age ?? ''}
              onChange={(event) => onUpdateField('age', event.target.value ? Number(event.target.value) : null)}
            />
          </Field>
          <Field label="Sexo">
            <select value={form.sex} onChange={(event) => onUpdateField('sex', event.target.value)}>
              <option value="">Selecciona</option>
              {sexOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Telefono alumno">
            <input inputMode="numeric" type="tel" value={form.phone} onChange={(event) => onUpdateField('phone', event.target.value)} />
          </Field>
          <Field label="Correo alumno">
            <input type="email" value={form.email} onChange={(event) => onUpdateField('email', event.target.value)} />
          </Field>
          <Field className="span-2" label="Domicilio" required>
            <input value={form.addressLine} onChange={(event) => onUpdateField('addressLine', event.target.value)} />
          </Field>
          <Field label="Colonia">
            <select value={form.neighborhood} onChange={(event) => onUpdateField('neighborhood', event.target.value)}>
              <option value="">Selecciona</option>
              <option value="12 de Diciembre">12 de Diciembre</option>
              <option value="Agua Fria">Agua Fria</option>
              <option value="Amado Nervo">Amado Nervo</option>
              <option value="Belen Ajkabalna">Belen Ajkabalna</option>
              <option value="Belisario Dominguez">Belisario Dominguez</option>
              <option value="Chitaltic">Chitaltic</option>
              <option value="Chul-Ha">Chul-Ha</option>
              <option value="Efigenia Chapoy">Efigenia Chapoy</option>
              <option value="El Azufre">El Azufre</option>
              <option value="El Bosque">El Bosque</option>
              <option value="El Campo">El Campo</option>
              <option value="Flamboyan">Flamboyan</option>
              <option value="Flores">Flores</option>
              <option value="Jardines">Jardines</option>
              <option value="Jonuta">Jonuta</option>
              <option value="La Belleza">La Belleza</option>
              <option value="La Cadelaria">La Cadelaria</option>
              <option value="Lazaro Cardenas">Lazaro Cardenas</option>
              <option value="Linda Vista 1a. Seccion">Linda Vista 1a. Seccion</option>
              <option value="Loma Bonita">Loma Bonita</option>
              <option value="Los Tulipanes">Los Tulipanes</option>
              <option value="Saclumil Rosario II">Saclumil Rosario II</option>
              <option value="San Antonio">San Antonio</option>
              <option value="San Jose Bunslac">San Jose Bunslac</option>
              <option value="San Jose el Mirador">San Jose el Mirador</option>
              <option value="San Luis">San Luis</option>
              <option value="San Martin">San Martin</option>
              <option value="San Miguel">San Miguel</option>
              <option value="Santa Elena">Santa Elena</option>
              <option value="Santa Teresita">Santa Teresita</option>
              <option value="San Vicente">San Vicente</option>
              <option value="Vista Alegre">Vista Alegre</option>
              <option value="Yajalon Centro">Yajalon Centro</option>
            </select>
          </Field>
          <Field label="Localidad">
            <input value={form.locality} onChange={(event) => onUpdateField('locality', event.target.value)} />
          </Field>
          <Field label="Municipio">
            <input value={form.municipality} onChange={(event) => onUpdateField('municipality', event.target.value)} readOnly />
          </Field>
          <Field label="Estado">
            <input value={form.state} onChange={(event) => onUpdateField('state', event.target.value)} readOnly />
          </Field>
          <Field label="Codigo postal">
            <input
              inputMode="numeric"
              maxLength={5}
              value={form.postalCode}
              onChange={(event) => onUpdateField('postalCode', event.target.value)}
              readOnly
            />
          </Field>
          <Field label="Escuela de procedencia">
            <input value={form.previousSchool} onChange={(event) => onUpdateField('previousSchool', event.target.value)} />
          </Field>
          <Field label="Promedio secundaria">
            <input
              type="number"
              min="0"
              max="10"
              step="0.1"
              inputMode="decimal"
              value={form.secondaryAverage ?? ''}
              onChange={(event) => onUpdateField('secondaryAverage', event.target.value ? Number(event.target.value) : null)}
            />
          </Field>
          <Field label="Estatus academico">
            <input value={form.academicStatus} onChange={(event) => onUpdateField('academicStatus', event.target.value)} />
          </Field>
          <Field className="span-2" label="Tutor" required>
            <input value={form.guardianFullName} onChange={(event) => onUpdateField('guardianFullName', event.target.value)} />
          </Field>
          <Field label="Parentesco">
            <select value={form.guardianRelationship} onChange={(event) => onUpdateField('guardianRelationship', event.target.value)}>
              <option value="">Selecciona</option>
              {relationshipOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Telefono tutor" required>
            <input
              inputMode="numeric"
              type="tel"
              value={form.guardianPhone}
              onChange={(event) => onUpdateField('guardianPhone', event.target.value)}
            />
          </Field>
          <Field label="Correo tutor">
            <input type="email" value={form.guardianEmail} onChange={(event) => onUpdateField('guardianEmail', event.target.value)} />
          </Field>
        </div>

        <label className="checkbox-row">
          <input checked={form.validateNow} type="checkbox" onChange={(event) => onUpdateField('validateNow', event.target.checked)} />
          Guardar alumno ya validado y listo para cobro
        </label>

        {feedback ? <p className="feedback-banner">{feedback}</p> : null}

        <div className="form-actions control-actions">
          {editingStudentId ? (
            <button className="secondary-button" onClick={onCancelEdit} type="button">
              Cancelar edicion
            </button>
          ) : null}
          <button className="primary-button" disabled={saving} type="submit">
            {saving ? 'Guardando...' : editingStudentId ? 'Actualizar alumno' : 'Guardar alumno'}
          </button>
          </div>
        </form>
      </section>
    </>
  )
}

type IngresosProps = {
  students: StudentSummary[]
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
  onChangeConceptQuery: (value: string) => void
  onChangeRocNumber: (value: string) => void
  onCreateReceipt: () => Promise<void>
  onPrintReceipt: () => void
  onReprintReceipt: (receiptId: string) => Promise<void>
  onSelectStudent: (student: StudentSummary) => void
  onToggleConcept: (concept: ChargeConceptSummary) => void
}

function IngresosPropiosOverview({
  students,
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
  onChangeConceptQuery,
  onChangeRocNumber,
  onCreateReceipt,
  onPrintReceipt,
  onReprintReceipt,
  onSelectStudent,
  onToggleConcept,
}: IngresosProps) {
  const printedAt = new Date()
  const amountInWords = amountToWords(total)
  const normalizedQuery = conceptQuery.trim().toLowerCase()
  const groupedConcepts = groupConcepts(concepts, '')
  const searchResults = normalizedQuery
    ? concepts.filter(isSelectableConcept).filter((concept) => {
        const haystack = [concept.code, concept.name, concept.description ?? ''].join(' ').toLowerCase()
        return haystack.includes(normalizedQuery)
      })
    : []
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
      <article className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Modulo 2</p>
            <h2>Seleccion de alumno validado</h2>
          </div>
          <span className="status-tag">Prerelleno de ROC</span>
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

      <article className="panel print-host">
        <div className="section-header">
          <div>
            <p className="eyebrow">ROC</p>
            <h2>Datos prerellenados y conceptos</h2>
          </div>
          <span className="status-tag">Plantilla oficial</span>
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

                {groupedConcepts.length === 0 ? (
                  <p className="empty-state">No hay claves que coincidan con la busqueda.</p>
                ) : null}

              {normalizedQuery.length > 0 ? (
                <section className="concept-group-panel">
                  <div className="concept-group-header static">
                    <strong>RESULTADOS</strong>
                    <span>{searchResults.length} claves</span>
                  </div>

                  <div className="concept-grid compact-concept-grid">
                    {searchResults.map((concept) => {
                      const active = selectedConcepts.some((item) => item.code === concept.code)
                      return (
                        <button
                          className={active ? 'concept-card active' : 'concept-card'}
                          key={concept.code}
                          onClick={() => onToggleConcept(concept)}
                        >
                          <strong>{concept.code}</strong>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ) : (
                groupedConcepts.map((group) => (
                  <section className="concept-group-panel" key={group.key}>
                    <div className="concept-group-header static">
                      <div>
                        <strong>{group.header?.code ?? group.key}</strong>
                      </div>
                      <span>{group.items.length} claves</span>
                    </div>

                    <div className="concept-grid compact-concept-grid">
                      {group.items.map((concept) => {
                        const active = selectedConcepts.some((item) => item.code === concept.code)
                        return (
                          <button
                            className={active ? 'concept-card active' : 'concept-card'}
                            key={concept.code}
                            onClick={() => onToggleConcept(concept)}
                          >
                            <strong>{concept.code}</strong>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))
              )}
            </div>

              <div className="roc-actions">
                <Field label="Numero de ROC" required>
                  <input value={rocNumber} onChange={(event) => onChangeRocNumber(event.target.value)} />
                </Field>
                <div className="button-row">
                  <button className="secondary-button" onClick={onPrintReceipt} type="button">
                    Imprimir ROC
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
                      {concept.code} - {concept.name} - ${concept.amount.toFixed(2)}
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
      </article>

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
