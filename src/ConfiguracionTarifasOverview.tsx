import { useEffect, useState } from 'react'
import { AdminUsersOverview } from './AdminUsersOverview'
import { ConfiguracionTarifasProps } from './App'
import { groupedSelectableConcepts, isSelectableConcept } from '@/lib/utils'
import { Field } from './components/ui/Field'
import { TariffEditorRow } from './TariffEditorRow'

export function ConfiguracionTarifasOverview({
  currentRole,
  concepts,
  rocInitialNumber,
  suggestedRocNumber,
  savingTariffCode,
  savingRocConfig,
  savingUserId,
  savingAdminTestAction,
  users,
  departments,
  students,
  currentUserId,
  onUpdateTariff,
  onUpdateRocConfig,
  onUpdateSuggested,
  onCreateUser,
  onUpdateUser,
  onResetUserPassword,
  onRunAdminTestReset,
}: ConfiguracionTarifasProps) {
  const groupedConcepts = groupedSelectableConcepts(concepts)
  const [selectedGroupKey, setSelectedGroupKey] = useState(groupedConcepts[0]?.key ?? 'A000')
  const [rocInitialDraft, setRocInitialDraft] = useState(rocInitialNumber)
  const [configTab, setConfigTab] = useState<'tarifas' | 'usuarios' | 'pruebas'>('tarifas')
  const [testResetConfirmation, setTestResetConfirmation] = useState('')
  const [testResetStudentId, setTestResetStudentId] = useState('')
  const canManageUsers = currentRole === 'ADMIN'
  const canManageRocSequence = currentRole === 'ADMIN'
  const canRunTestTools = currentRole === 'ADMIN'
  const canRunGlobalReset = testResetConfirmation.trim().toUpperCase() === 'RESET'

  useEffect(() => {
    setRocInitialDraft(rocInitialNumber)
  }, [rocInitialNumber])

  useEffect(() => {
    if (groupedConcepts.length === 0) return
    const exists = groupedConcepts.some((group) => group.key === selectedGroupKey)
    if (!exists) {
      setSelectedGroupKey(groupedConcepts[0].key)
    }
  }, [groupedConcepts, selectedGroupKey])

  useEffect(() => {
    if (!canManageUsers && configTab !== 'tarifas') {
      setConfigTab('tarifas')
    }
  }, [canManageUsers, configTab])

  useEffect(() => {
    if (!testResetStudentId && students.length > 0) {
      setTestResetStudentId(students[0].id)
    }
  }, [students, testResetStudentId])

  const activeGroup = groupedConcepts.find((group) => group.key === selectedGroupKey) ?? groupedConcepts[0] ?? null

  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Configuración</p>
          <h2>{configTab === 'tarifas' ? 'Tarifas y ROC' : 'Usuarios y departamentos'}</h2>
        </div>
        <span className="status-tag">{canManageUsers ? 'Panel administrativo' : 'Ingresos Propios'}</span>
      </div>

      <div className="config-tabs" role="tablist" aria-label="Configuración">
        <button className={configTab === 'tarifas' ? 'config-tab active' : 'config-tab'} onClick={() => setConfigTab('tarifas')} type="button">
          Tarifas y ROC
        </button>
        {canManageUsers ? (
          <button className={configTab === 'usuarios' ? 'config-tab active' : 'config-tab'} onClick={() => setConfigTab('usuarios')} type="button">
            Usuarios y departamentos
          </button>
        ) : null}
        {canRunTestTools ? (
          <button className={configTab === 'pruebas' ? 'config-tab active' : 'config-tab'} onClick={() => setConfigTab('pruebas')} type="button">
            Pruebas temporales
          </button>
        ) : null}
      </div>

      {canManageUsers && configTab === 'usuarios' ? (
        <AdminUsersOverview
          currentUserId={currentUserId}
          departments={departments}
          savingUserId={savingUserId}
          users={users}
          onCreateUser={onCreateUser}
          onResetUserPassword={onResetUserPassword}
          onUpdateUser={onUpdateUser}
        />
      ) : canRunTestTools && configTab === 'pruebas' ? (
        <article className="panel sub-panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Herramientas temporales de prueba</p>
              <h3>Reset de Control Escolar</h3>
              <p className="compact-operational-line">Usa estos botones solo mientras validas inscripcion, reinscripcion, egreso y movimientos academicos.</p>
            </div>
            <span className="status-tag warning">Temporal</span>
          </div>

          <div className="temporary-tools-grid">
            <Field label="Alumno para reset individual">
              <select value={testResetStudentId} onChange={(event) => setTestResetStudentId(event.target.value)}>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {(student.officialEnrollmentNumber || student.enrollmentNumber) + ' - ' + student.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <button
              className="secondary-button"
              disabled={!testResetStudentId || savingAdminTestAction !== null}
              onClick={() => void onRunAdminTestReset('student', { studentId: testResetStudentId })}
              type="button"
            >
              {savingAdminTestAction === 'student' ? 'Revirtiendo...' : 'Reset alumno actual'}
            </button>
          </div>

          <div className="temporary-tools-warning">
            <strong>Confirmacion para resets globales</strong>
            <p>Estas acciones eliminan movimientos y auditoria relacionados con pruebas. Escribe RESET para habilitarlas.</p>
            <input value={testResetConfirmation} onChange={(event) => setTestResetConfirmation(event.target.value)} placeholder="RESET" />
          </div>

          <div className="temporary-tools-actions">
            <button className="secondary-button" disabled={!canRunGlobalReset || savingAdminTestAction !== null} onClick={() => void onRunAdminTestReset('enrollment')} type="button">
              {savingAdminTestAction === 'enrollment' ? 'Revirtiendo...' : 'Reset inscripciones 2026-2027/1'}
            </button>
            <button className="secondary-button" disabled={!canRunGlobalReset || savingAdminTestAction !== null} onClick={() => void onRunAdminTestReset('reinscription')} type="button">
              {savingAdminTestAction === 'reinscription' ? 'Revirtiendo...' : 'Reset reinscripciones 2026-2027/1'}
            </button>
            <button className="secondary-button" disabled={!canRunGlobalReset || savingAdminTestAction !== null} onClick={() => void onRunAdminTestReset('graduation')} type="button">
              {savingAdminTestAction === 'graduation' ? 'Revirtiendo...' : 'Reset egresos'}
            </button>
            <button className="secondary-button danger-button" disabled={!canRunGlobalReset || savingAdminTestAction !== null} onClick={() => void onRunAdminTestReset('history')} type="button">
              {savingAdminTestAction === 'history' ? 'Limpiando...' : 'Limpiar movimientos y auditoria'}
            </button>
          </div>
        </article>
      ) : (
        <>
          {canManageRocSequence ? (
            <article className="panel sub-panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">ROC</p>
                  <h3>Configuración de consecutivo</h3>
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
          ) : null}

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
                {concepts.filter(isSelectableConcept).length} claves configurables cargadas. Aquí también puedes ajustar la tarifa del seguro de vida, marcada como
                {' '}
                "Seguro de vida / No se imprime en ROC".
              </p>
            </div>

            {!activeGroup ? <p className="empty-state">No hay claves configurables para este catálogo.</p> : null}

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
                          canToggleSuggested={canManageUsers}
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
