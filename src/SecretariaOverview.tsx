import { useState, FormEvent } from 'react';
import { SecretariaOverviewProps } from './App';
import { toLocalDateTimeInputValue, toLocalDateInputValue, formatPreferredEnrollment, formatVisibleGroupLabel, dailyStatusClassName } from '@/lib/utils';
import { Field } from './components/ui/Field';
import { SearchInput } from './components/ui/SearchInput';
import { type DashboardMetric, ModuleHero, ModuleBarCompact, StatusBadge, SurfaceCard, PanelSectionTitle, DashboardEmptyState } from './components/dashboard-kit';
import { formatPrintDate } from './lib/formatters';
import type { StudentPermissionCreateInput } from './types/domain';

export function SecretariaOverview({
  students, permissions, feedback, onCreatePermission, onCancelPermission, onSetDailyStatus, onClearDailyStatus,
}: SecretariaOverviewProps) {
  const [query, setQuery] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [kind, setKind] = useState<StudentPermissionCreateInput['kind']>('PERMISO_GENERAL');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [savingPermission, setSavingPermission] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState(() => {
    const base = new Date();
    base.setHours(7, 0, 0, 0);
    return toLocalDateTimeInputValue(base);
  });
  const [endsAt, setEndsAt] = useState(() => {
    const base = new Date();
    base.setHours(14, 0, 0, 0);
    return toLocalDateTimeInputValue(base);
  });

  const today = toLocalDateInputValue();
  const normalizedQuery = query.trim().toLowerCase();
  const filteredStudents = normalizedQuery.length === 0
    ? students
    : students.filter((student) => [
      formatPreferredEnrollment(student),
      student.fullName,
      student.curp,
      student.guardianFullName ?? '',
      student.guardianPhone ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery)
    );
  const selectedStudent = filteredStudents.find((student) => student.id === selectedStudentId)
    ?? students.find((student) => student.id === selectedStudentId)
    ?? null;
  const visiblePermissions = permissions
    .filter((permission) => permission.status !== 'CERRADO')
    .slice(0, 12);
  const secretariaMetrics: DashboardMetric[] = [
    { label: 'Alumnos', value: students.length, helper: 'En padrón' },
    { label: 'Presentes', value: students.filter((student) => student.dailyStatus === 'PRESENTE').length, helper: 'Sin novedad' },
    { label: 'Ausentes', value: students.filter((student) => student.dailyStatus === 'AUSENTE').length, helper: 'Marcados hoy', tone: students.some((student) => student.dailyStatus === 'AUSENTE') ? 'warning' : 'default' },
    { label: 'Permisos activos', value: permissions.filter((permission) => permission.activeToday).length, helper: 'Vigentes hoy' },
  ];

  async function handleSubmitPermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStudent) return;
    setSavingPermission(true);
    try {
      await onCreatePermission({
        studentId: selectedStudent.id,
        kind,
        reason,
        notes,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });
      setReason('');
      setNotes('');
    } finally {
      setSavingPermission(false);
    }
  }

  async function handleMarkAbsent(studentId: string) {
    setUpdatingStatusId(studentId);
    try {
      await onSetDailyStatus({
        studentId,
        date: today,
        status: 'AUSENTE',
      });
    } finally {
      setUpdatingStatusId(null);
    }
  }

  async function handleResetStatus(studentId: string) {
    setUpdatingStatusId(studentId);
    try {
      await onClearDailyStatus(studentId, today);
    } finally {
      setUpdatingStatusId(null);
    }
  }

  return (
    <section className="module-dashboard secretaria-layout">
      <ModuleBarCompact
        eyebrow="Secretaría"
        title="Permisos y estatus diario"
        metrics={secretariaMetrics}
        actions={<StatusBadge>{visiblePermissions.filter((item) => item.activeToday).length} permisos hoy</StatusBadge>} />

      <div className="dashboard-module-grid secretaria-module-grid">
        <div className="dashboard-module-main">
          <SurfaceCard className="dashboard-search-panel">
            <PanelSectionTitle
              eyebrow="Consulta"
              title="Buscar alumno"
              subtitle="Localiza al alumno por matrícula, nombre, CURP, tutor o teléfono y marca su estatus del día." />
            <SearchInput
              placeholder="Matrícula, nombre, CURP, tutor o teléfono"
              value={query}
              onChange={setQuery}
            />
          </SurfaceCard>

          {feedback ? <p className="feedback-banner">{feedback}</p> : null}

          <SurfaceCard>
            <PanelSectionTitle eyebrow="Padrón" title="Alumnos del día" action={<StatusBadge>{filteredStudents.length}</StatusBadge>} />
            <div className="student-table-wrap">
              <table className="student-table">
                <thead>
                  <tr>
                    <th>Matrícula</th>
                    <th>Alumno</th>
                    <th>Grupo</th>
                    <th>Estatus hoy</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <p className="empty-state compact-empty-state">No hay alumnos que coincidan con la búsqueda del día.</p>
                      </td>
                    </tr>
                  ) : null}
                  {filteredStudents.slice(0, 14).map((student) => (
                    <tr key={student.id} className={selectedStudentId === student.id ? 'student-row active' : 'student-row'}>
                      <td><strong>{formatPreferredEnrollment(student)}</strong></td>
                      <td>
                        <div className="table-primary-cell">
                          <strong>{student.fullName}</strong>
                          <span>{student.guardianFullName ?? 'Sin tutor capturado'}</span>
                        </div>
                      </td>
                      <td>{formatVisibleGroupLabel(student.groupLabel)}</td>
                      <td>
                        <div className="table-primary-cell">
                          <span className={dailyStatusClassName(student.dailyStatus)}>{student.dailyStatusLabel}</span>
                          <span>{student.activePermissionSummary ?? 'Sin novedad'}</span>
                        </div>
                      </td>
                      <td className="student-actions-cell">
                        <button className="secondary-button small-button" onClick={() => setSelectedStudentId(student.id)} type="button">
                          Seleccionar
                        </button>
                        <button className="tertiary-button small-button" disabled={updatingStatusId === student.id} onClick={() => void handleMarkAbsent(student.id)} type="button">
                          Ausente
                        </button>
                        <button className="tertiary-button small-button" disabled={updatingStatusId === student.id} onClick={() => void handleResetStatus(student.id)} type="button">
                          Presente
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SurfaceCard>
        </div>

        <div className="dashboard-module-side secretaria-side">
          <SurfaceCard className="dashboard-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Alumno</p>
                <h3>Resumen seleccionado</h3>
              </div>
              <span className={selectedStudent ? dailyStatusClassName(selectedStudent.dailyStatus) : 'status-tag'}>{selectedStudent?.dailyStatusLabel ?? 'Sin selección'}</span>
            </div>
            {selectedStudent ? (
              <div className="student-detail-grid">
                <div>
                  <span className="detail-label">Alumno</span>
                  <strong>{selectedStudent.fullName}</strong>
                </div>
                <div>
                  <span className="detail-label">Matrícula</span>
                  <strong>{formatPreferredEnrollment(selectedStudent)}</strong>
                </div>
                <div>
                  <span className="detail-label">Tutor</span>
                  <strong>{selectedStudent.guardianFullName ?? 'Sin tutor capturado'}</strong>
                </div>
                <div>
                  <span className="detail-label">Grupo</span>
                  <strong>{formatVisibleGroupLabel(selectedStudent.groupLabel)}</strong>
                </div>
                <div>
                  <span className="detail-label">Permiso activo</span>
                  <strong>{selectedStudent.activePermissionSummary ?? 'Sin permiso activo'}</strong>
                </div>
              </div>
            ) : (
              <p className="empty-state">Selecciona un alumno para registrar un permiso o ajustar su estatus del día.</p>
            )}
          </SurfaceCard>

          <SurfaceCard className="dashboard-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Estado del día</p>
                <h3>Acciones rápidas</h3>
              </div>
              <span className={selectedStudent ? dailyStatusClassName(selectedStudent.dailyStatus) : 'status-tag'}>{selectedStudent?.dailyStatusLabel ?? 'Sin selección'}</span>
            </div>
            {selectedStudent ? (
              <div className="secretaria-status-actions">
                <button className="secondary-button" onClick={() => setSelectedStudentId(selectedStudent.id)} type="button">
                  Mantener seleccionado
                </button>
                <button className="tertiary-button" disabled={updatingStatusId === selectedStudent.id} onClick={() => void handleMarkAbsent(selectedStudent.id)} type="button">
                  Marcar ausente
                </button>
                <button className="primary-button" disabled={updatingStatusId === selectedStudent.id} onClick={() => void handleResetStatus(selectedStudent.id)} type="button">
                  Marcar presente
                </button>
              </div>
            ) : (
              <DashboardEmptyState
                title="Selecciona un alumno"
                description="El panel de estado permite marcar presente o ausente sin bajar a la tabla." />
            )}
          </SurfaceCard>

          <form className="panel sub-panel dashboard-side-card" onSubmit={handleSubmitPermission}>
            <div className="section-header">
              <div>
                <p className="eyebrow">Permiso</p>
                <h3>Registrar permiso</h3>
              </div>
              <span className="status-tag">Secretaría</span>
            </div>
            <div className="form-grid compact-form-grid">
              <Field label="Tipo">
                <select value={kind} onChange={(event) => setKind(event.target.value as StudentPermissionCreateInput['kind'])}>
                  <option value="PERMISO_GENERAL">Permiso general</option>
                  <option value="SALIDA_ANTICIPADA">Salida anticipada</option>
                  <option value="DIA_COMPLETO">Día completo</option>
                  <option value="JUSTIFICANTE_MEDICO">Justificante médico</option>
                </select>
              </Field>
              <Field label="Inicio">
                <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
              </Field>
              <Field label="Fin">
                <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
              </Field>
              <Field className="full-width" label="Motivo">
                <input required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} />
              </Field>
              <Field className="full-width" label="Notas">
                <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
            </div>
            <div className="form-actions">
              <button className="primary-button" disabled={!selectedStudent || savingPermission} type="submit">
                {savingPermission ? 'Guardando permiso...' : 'Registrar permiso'}
              </button>
            </div>
          </form>

          <SurfaceCard className="dashboard-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Seguimiento</p>
                <h3>Permisos recientes</h3>
              </div>
              <span className="status-tag">{permissions.length} registros</span>
            </div>
            {visiblePermissions.length === 0 ? (
              <p className="empty-state">Todavía no hay permisos registrados.</p>
            ) : (
              <div className="secretaria-permission-list">
                {visiblePermissions.map((permission) => (
                  <article className="secretaria-permission-item" key={permission.id}>
                    <div>
                      <strong>{permission.studentName}</strong>
                      <p>{permission.reason}</p>
                      <span>{formatPrintDate(new Date(permission.startsAt))} a {formatPrintDate(new Date(permission.endsAt))}</span>
                    </div>
                    <div className="secretaria-permission-actions">
                      <span className={permission.activeToday ? 'status-tag warning' : 'status-tag'}>{permission.status}</span>
                      {permission.status !== 'CANCELADO' ? (
                        <button className="tertiary-button small-button" onClick={() => void onCancelPermission({ permissionId: permission.id })} type="button">
                          Cancelar
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </SurfaceCard>
        </div>
      </div>
    </section>
  );
}
