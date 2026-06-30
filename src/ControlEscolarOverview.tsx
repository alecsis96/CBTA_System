import { useState, useMemo, useEffect } from 'react';
import { ControlEscolarProps } from './App';
import { CONTROL_STUDENTS_PER_PAGE, getOutputFileName, formatPreferredEnrollment, dailyStatusClassName, formatVisibleGroupLabel, relationshipOptions } from '@/lib/utils';
import { pickRosterWorkbookFile, parseRosterWorkbook } from '@/lib/roster-import';
import { groupSexBalanceLabel, groupBandBalanceLabel } from '@/lib/group-stats';
import { Field } from './components/ui/Field';
import { ControlEscolarToolbar } from './components/control-escolar/control-escolar-toolbar';
import { AdmissionCaptureTable, PreRegistrationInboxPanel } from './components/control-escolar/panels';
import { StudentCaptureFormPanel } from './components/control-escolar/student-capture-form-panel';
import { type DashboardMetric, ModuleHero, ModuleBarCompact, DashboardEmptyState } from './components/dashboard-kit';
import { StudentTable } from './components/StudentTable';
import type { GroupStat, GroupPreviewRow, StudentRequirementChecklist, StudentSummary, AdmissionSummary, SaveStudentRequirementChecklistInput } from './types/domain';

export function ControlEscolarOverview({
  form, students, preRegistrations, admissions, recentAuditLogs, captureQuery, activeAdmission, editingStudentId, newlyCreatedStudentId, saving, feedback, studentsSectionRef, captureSectionRef, onCancelEdit, onEditStudent, onUpdatePreRegistrationStatus, onSubmit, onUpdateField, onSelectAdmissionForCapture, onUpdateCaptureQuery, onExportSep, onReloadData, onClearNewlyCreatedStudent, groupsApi,
}: ControlEscolarProps) {
  const [captureTab, setCaptureTab] = useState<'fichas' | 'formulario'>('fichas');
  const [operationsTab, setOperationsTab] = useState<'captura' | 'bandeja' | 'grupos' | 'inscripcion' | 'alumnos'>('alumnos');
  const [studentQuery, setStudentQuery] = useState('');
  const [semesterFilter, setSemesterFilter] = useState<'all' | '1' | '3' | '5'>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [documentationFilter, setDocumentationFilter] = useState('all');
  const [studentPage, setStudentPage] = useState(1);
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedPreRegistrationId, setSelectedPreRegistrationId] = useState<string | null>(null);
  const [groupStats, setGroupStats] = useState<GroupStat[]>([]);
  const [groupPreviewRows, setGroupPreviewRows] = useState<GroupPreviewRow[]>([]);
  const [isPreviewStats, setIsPreviewStats] = useState(false);
  const [previewGroupFilter, setPreviewGroupFilter] = useState('all');
  const [previewSexFilter, setPreviewSexFilter] = useState('all');
  const [previewPage, setPreviewPage] = useState(1);
  const [moveStudentId, setMoveStudentId] = useState('');
  const [moveGroupId, setMoveGroupId] = useState('');
  const [moveReason, setMoveReason] = useState('');
  const [noShowStudentId, setNoShowStudentId] = useState('');
  const [noShowReason, setNoShowReason] = useState('');
  const [selectedChecklistStudentId, setSelectedChecklistStudentId] = useState('');
  const [requirementChecklist, setRequirementChecklist] = useState<StudentRequirementChecklist | null>(null);
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [checklistFeedback, setChecklistFeedback] = useState<string | null>(null);
  const [isChecklistModalOpen, setIsChecklistModalOpen] = useState(false);
  const [inscriptionQuery, setInscriptionQuery] = useState('');
  const [inscriptionPage, setInscriptionPage] = useState(1);
  const uniqueDocumentationStatuses = useMemo(
    () => Array.from(new Set(students.map((student) => student.documentationStatus).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [students]
  );
  const normalizedStudentQuery = studentQuery.trim().toLowerCase();
  const matchesDirectoryFilters = (student: StudentSummary, query: string) => {
    const haystack = [
      student.enrollmentNumber,
      student.officialEnrollmentNumber ?? '',
      student.fullName,
      student.curp,
      student.guardianFullName ?? '',
      student.guardianPhone ?? '',
    ]
      .join(' ')
      .toLowerCase();

    const matchesQuery = query.length === 0 || haystack.includes(query);
    const matchesSemester = semesterFilter === 'all' || String(student.semesterLevel) === semesterFilter;
    const matchesStatus = statusFilter === 'all' || student.statusLabel === statusFilter;
    const matchesDocumentation = documentationFilter === 'all' || student.documentationStatus === documentationFilter;

    return matchesQuery && matchesSemester && matchesStatus && matchesDocumentation;
  };

  const filteredStudents = students.filter((student) => matchesDirectoryFilters(student, normalizedStudentQuery));
  const totalStudentPages = Math.max(1, Math.ceil(filteredStudents.length / CONTROL_STUDENTS_PER_PAGE));
  const paginatedStudents = filteredStudents.slice(
    (studentPage - 1) * CONTROL_STUDENTS_PER_PAGE,
    studentPage * CONTROL_STUDENTS_PER_PAGE
  );

  useEffect(() => {
    setStudentPage(1);
  }, [normalizedStudentQuery, semesterFilter, statusFilter, documentationFilter]);

  useEffect(() => {
    if (studentPage > totalStudentPages) {
      setStudentPage(totalStudentPages);
    }
  }, [studentPage, totalStudentPages]);

  useEffect(() => {
    setPreviewPage(1);
  }, [previewGroupFilter, previewSexFilter, groupPreviewRows.length]);

  useEffect(() => {
    if (preRegistrations.length > 0 && !selectedPreRegistrationId) {
      setSelectedPreRegistrationId(preRegistrations[0].id);
    }
  }, [preRegistrations, selectedPreRegistrationId]);

  useEffect(() => {
    if (newlyCreatedStudentId) {
      void handleLoadRequirementChecklist(newlyCreatedStudentId);
      onClearNewlyCreatedStudent();
    }
  }, [newlyCreatedStudentId, onClearNewlyCreatedStudent]);

  const selectedPreRegistration = preRegistrations.find((item) => item.id === selectedPreRegistrationId) ?? preRegistrations[0] ?? null;

  const normalizedCaptureQuery = captureQuery.trim().toLowerCase();
  const filteredAdmissions = admissions.filter((item) => {
    if (!normalizedCaptureQuery) return true;
    const haystack = `${item.folio} ${item.curp} ${item.fullName}`.toLowerCase();
    return haystack.includes(normalizedCaptureQuery);
  });
  const previewGroups = Array.from(new Set(groupPreviewRows.map((row) => row.groupLabel))).sort((a, b) => a.localeCompare(b));
  const filteredPreviewRows = groupPreviewRows.filter((row) => {
    const matchesGroup = previewGroupFilter === 'all' || row.groupLabel === previewGroupFilter;
    const normalizedSex = row.sex.trim().toUpperCase();
    const matchesSex = previewSexFilter === 'all' ||
      (previewSexFilter === 'H' && normalizedSex.startsWith('H')) ||
      (previewSexFilter === 'M' && (normalizedSex.startsWith('M') || normalizedSex.startsWith('F')));
    return matchesGroup && matchesSex;
  });
  const previewTotalPages = Math.max(1, Math.ceil(filteredPreviewRows.length / 20));
  const paginatedPreviewRows = filteredPreviewRows.slice((previewPage - 1) * 20, previewPage * 20);
  const normalizedInscriptionQuery = inscriptionQuery.trim().toLowerCase();
  const filteredInscriptionStudents = students.filter((student) => matchesDirectoryFilters(student, normalizedInscriptionQuery));
  const totalInscriptionPages = Math.max(1, Math.ceil(filteredInscriptionStudents.length / CONTROL_STUDENTS_PER_PAGE));
  const paginatedInscriptionStudents = filteredInscriptionStudents.slice(
    (inscriptionPage - 1) * CONTROL_STUDENTS_PER_PAGE,
    inscriptionPage * CONTROL_STUDENTS_PER_PAGE
  );

  useEffect(() => {
    if (previewPage > previewTotalPages) {
      setPreviewPage(previewTotalPages);
    }
  }, [previewPage, previewTotalPages]);

  useEffect(() => {
    setInscriptionPage(1);
  }, [normalizedInscriptionQuery, semesterFilter, statusFilter, documentationFilter]);

  useEffect(() => {
    if (inscriptionPage > totalInscriptionPages) {
      setInscriptionPage(totalInscriptionPages);
    }
  }, [inscriptionPage, totalInscriptionPages]);

  async function handleSelectAdmissionRow(admission: AdmissionSummary) {
    await onSelectAdmissionForCapture(admission);
    setCaptureTab('formulario');
    setTimeout(() => {
      captureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  async function handleStartEditStudent(studentId: string) {
    await onEditStudent(studentId);
    setOperationsTab('captura');
    setCaptureTab('formulario');
    setTimeout(() => {
      captureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  async function refreshGroupStats() {
    if (!groupsApi?.stats) return;
    const stats = await groupsApi.stats({ schoolCycle: form.schoolCycle });
    setGroupStats(stats);
  }

  async function handleAutoAssign() {
    if (!groupsApi?.autoAssign) return;
    await groupsApi.autoAssign({ schoolCycle: form.schoolCycle });
    setIsPreviewStats(false);
    setGroupPreviewRows([]);
    setPreviewGroupFilter('all');
    setPreviewSexFilter('all');
    await refreshGroupStats();
    await onReloadData();
  }

  async function handlePreviewAssign() {
    if (!groupsApi?.preview) return;
    const stats = await groupsApi.preview({ schoolCycle: form.schoolCycle });
    setGroupStats(stats);
    if (groupsApi?.previewRoster) {
      const rows = await groupsApi.previewRoster({ schoolCycle: form.schoolCycle });
      setGroupPreviewRows(rows);
    }
    setIsPreviewStats(true);
  }

  async function handleConfirmGroups() {
    if (!groupsApi?.confirmAssignment) return;
    await groupsApi.confirmAssignment({ schoolCycle: form.schoolCycle });
    await refreshGroupStats();
    await onReloadData();
  }

  async function handleManualMove() {
    if (!groupsApi?.manualReassign || !moveStudentId || !moveGroupId) return;
    await groupsApi.manualReassign({ studentId: moveStudentId, toGroupId: moveGroupId, reason: moveReason || 'Ajuste operativo' });
    await refreshGroupStats();
    await onReloadData();
  }

  async function handleNoShow() {
    if (!groupsApi?.markNoShow || !noShowStudentId) return;
    await groupsApi.markNoShow({ studentId: noShowStudentId, reason: noShowReason || 'No se presento a inscripcion' });
    await refreshGroupStats();
    await onReloadData();
  }

  async function handleImportAssignedRoster() {
    if (!groupsApi?.importAssignedRoster) return;
    try {
      const file = await pickRosterWorkbookFile();
      if (!file) {
        setChecklistFeedback('Importacion cancelada.');
        return;
      }

      const parsed = await parseRosterWorkbook(file);
      if (parsed.rows.length === 0) {
        setChecklistFeedback('El archivo no contiene filas validas para importar grupos.');
        return;
      }

      const result = await groupsApi.importAssignedRoster({
        schoolCycle: form.schoolCycle,
        sourcePath: file.name,
        rows: parsed.rows,
      });
      const allIssues = [...parsed.issues, ...result.issues].slice(0, 12);
      const issuesSuffix = allIssues.length > 0 ? ` Avisos: ${allIssues.join(' | ')}` : '';
      const sourceFile = result.sourcePath ? getOutputFileName(result.sourcePath) : file.name;
      setChecklistFeedback(
        `Importacion completada desde ${sourceFile}: ${result.importedCount} asignaciones, ${result.createdGroupCount} grupos nuevos, ${result.unmatchedCount} sin match, ${result.skippedCount + parsed.skippedCount} filas omitidas.${issuesSuffix}`
      );
      await refreshGroupStats();
      await onReloadData();
    } catch (error) {
      setChecklistFeedback(error instanceof Error ? `No se pudo importar el Excel: ${error.message}` : 'No se pudo importar el Excel.');
    }
  }

  async function handleExportAssignedRoster() {
    if (!groupsApi?.exportAssignedRoster) return;
    const result = await groupsApi.exportAssignedRoster({ schoolCycle: form.schoolCycle });
    setChecklistFeedback(`Listado exportado (${result.exportedCount} alumnos): ${result.outputPath}`);
  }

  async function handlePrintAssignedRoster() {
    if (!groupsApi?.printAssignedRoster) return;
    await groupsApi.printAssignedRoster({ schoolCycle: form.schoolCycle });
    setChecklistFeedback('Listado de grupos enviado a impresion.');
  }

  async function handleLoadRequirementChecklist(studentId: string) {
    if (!window.cbta?.students?.getRequirementChecklist) return;
    const checklist = await window.cbta.students.getRequirementChecklist(studentId);
    setSelectedChecklistStudentId(studentId);
    setRequirementChecklist(checklist);
    setChecklistFeedback(null);
    setIsChecklistModalOpen(true);
  }

  function handleCloseChecklistModal() {
    setIsChecklistModalOpen(false);
  }

  function handleChecklistItemChange(index: number, patch: Partial<StudentRequirementChecklist['items'][number]>) {
    setRequirementChecklist((current) => {
      if (!current) return current;
      const items = current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        return { ...item, ...patch };
      });
      return { ...current, items };
    });
  }

  async function handleSaveRequirementChecklist() {
    if (!window.cbta?.students?.saveRequirementChecklist || !selectedChecklistStudentId || !requirementChecklist) return;
    setSavingChecklist(true);
    try {
      const payload: SaveStudentRequirementChecklistInput = {
        items: requirementChecklist.items.map((item) => ({
          requirementId: item.requirementId,
          isDelivered: item.isDelivered,
          missingJustification: item.missingJustification,
          deadlineAt: item.deadlineAt,
          notes: item.notes,
        })),
      };
      const saved = await window.cbta.students.saveRequirementChecklist(selectedChecklistStudentId, payload);
      setRequirementChecklist(saved);
      setChecklistFeedback('Checklist documental guardado correctamente.');
      await onReloadData();
      setIsChecklistModalOpen(false);
    } finally {
      setSavingChecklist(false);
    }
  }

  useEffect(() => {
    if (!isChecklistModalOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsChecklistModalOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isChecklistModalOpen]);

  useEffect(() => {
    void refreshGroupStats();
  }, [form.schoolCycle]);

  const toolbarSearchValue = operationsTab === 'captura' ? captureQuery : operationsTab === 'inscripcion' ? inscriptionQuery : studentQuery;
  const toolbarSearchPlaceholder = operationsTab === 'captura'
    ? 'Folio, CURP o nombre de ficha'
    : operationsTab === 'bandeja'
      ? 'La bandeja SEP usa su propio flujo'
      : operationsTab === 'inscripcion'
        ? 'Buscar por matrícula, nombre o CURP'
        : 'Buscar por matrícula, nombre o CURP';
  const activeFilterCount = Number(semesterFilter !== 'all') + Number(statusFilter !== 'all') + Number(documentationFilter !== 'all');

  function handleToolbarSearchChange(value: string) {
    if (operationsTab === 'captura') {
      onUpdateCaptureQuery(value);
      return;
    }
    if (operationsTab === 'inscripcion') {
      setInscriptionQuery(value);
      return;
    }
    setStudentQuery(value);
  }

  const docsPendingCount = students.filter((student) => student.documentationStatus !== 'COMPLETA').length;
  const withoutGroupCount = students.filter((student) => !student.groupLabel).length;
  const controlMetrics: DashboardMetric[] = [
    { label: 'Alumnos', value: students.length, helper: 'Registrados' },
    { label: 'Validados', value: students.filter((student) => student.statusLabel === 'Inscrito').length, helper: 'Listos para operar' },
    { label: 'Docs pendientes', value: docsPendingCount, helper: 'Requieren revisión' },
    { label: 'Sin grupo', value: withoutGroupCount, helper: 'Ajuste académico', tone: withoutGroupCount > 0 ? 'warning' : 'default' },
  ];

  return (
    <section className="module-dashboard">
      <ModuleBarCompact
        eyebrow="Control Escolar"
        title="Padrón y expedientes"
        metrics={controlMetrics} />

      <div className="dashboard-module-grid dashboard-grid-1col">
        <div className="dashboard-module-main">
          <ControlEscolarToolbar
            operationsTab={operationsTab}
            setOperationsTab={setOperationsTab}
            setCaptureTab={setCaptureTab}
            toolbarSearchPlaceholder={toolbarSearchPlaceholder}
            toolbarSearchValue={toolbarSearchValue}
            handleToolbarSearchChange={handleToolbarSearchChange}
            showFilters={showFilters}
            setShowFilters={setShowFilters}
            activeFilterCount={activeFilterCount}
            form={form}
            onUpdateField={onUpdateField}
            semesterFilter={semesterFilter}
            setSemesterFilter={setSemesterFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            documentationFilter={documentationFilter}
            setDocumentationFilter={setDocumentationFilter}
            uniqueDocumentationStatuses={uniqueDocumentationStatuses} />

          {operationsTab === 'captura' && captureTab === 'fichas' ? (
            <section className="panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Control Escolar</p>
                  <h2 className="compact-header">Fichas</h2>
                </div>
                <div className="button-row">
                  <span className="status-tag">Captura en tiempo real</span>
                  <button
                    className="secondary-button small-button"
                    onClick={() => setOperationsTab('bandeja')}
                    type="button"
                  >
                    Abrir bandeja SEP
                  </button>
                </div>
              </div>
              {activeAdmission ? (
                <p className="feedback-banner">
                  Captura activa para folio {activeAdmission.folio} ({activeAdmission.curp}) - estatus {activeAdmission.status}
                </p>
              ) : null}

              <AdmissionCaptureTable
                activeAdmissionId={activeAdmission?.id ?? null}
                admissions={filteredAdmissions}
                onSelect={handleSelectAdmissionRow} />
              {filteredAdmissions.length === 0 ? <p className="empty-state">No hay pagos que coincidan con la búsqueda.</p> : null}
            </section>
          ) : null}

          {operationsTab === 'bandeja' ? (
            <PreRegistrationInboxPanel
              onExportSep={onExportSep}
              onSelectPreRegistration={setSelectedPreRegistrationId}
              onUpdateStatus={onUpdatePreRegistrationStatus}
              preRegistrations={preRegistrations}
              selectedPreRegistration={selectedPreRegistration} />
          ) : null}

          {operationsTab === 'grupos' ? (
            <section className="panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Control Escolar</p>
                  <h2 className="compact-header">Movimientos académicos</h2>
                  <p className="compact-operational-line">Concentra reasignaciones, no-show y balance de grupos fuera del padrón principal.</p>
                </div>
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
              <p className="table-summary">La importación acepta el Excel exportado por este listado o cualquier archivo con columnas Grupo y CURP o folio interno.</p>
              {checklistFeedback ? <p className="feedback-banner">{checklistFeedback}</p> : null}
              {isPreviewStats ? <p className="table-summary">Previsualización calculada sin guardar cambios.</p> : null}
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
                <Field className="span-2" label="Motivo"><input value={moveReason} onChange={(event) => setMoveReason(event.target.value)} placeholder="Motivo de reasignación" /></Field>
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
                <Field className="span-2" label="Motivo no-show"><input value={noShowReason} onChange={(event) => setNoShowReason(event.target.value)} placeholder="No se presentó" /></Field>
                <button className="secondary-button small-button" onClick={() => void handleNoShow()} type="button">Marcar no-show</button>
              </div>
            </section>
          ) : null}

          {operationsTab === 'inscripcion' ? (
            <section className="panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Control Escolar</p>
                  <h2 className="compact-header">Inscripción</h2>
                  <p className="compact-operational-line">Revisa documentación y abre el checklist del alumno sin perder el padrón de vista.</p>
                </div>
                <span className="status-tag">Checklist y plazo de entrega</span>
              </div>
              {checklistFeedback ? <p className="feedback-banner">{checklistFeedback}</p> : null}
              <div className="student-table-wrap">
                <table className="student-table table-inscripcion-ce">
                  <thead>
                    <tr>
                      <th>Matrícula</th>
                      <th>Alumno</th>
                      <th>Tutor</th>
                      <th>Semestre</th>
                      <th>Estatus hoy</th>
                      <th>Documentación</th>
                      <th>Estatus</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedInscriptionStudents.map((student) => (
                      <tr key={`checklist-${student.id}`} className={selectedChecklistStudentId === student.id ? 'student-row active' : 'student-row'}>
                        <td><strong>{formatPreferredEnrollment(student)}</strong></td>
                        <td>{student.fullName}</td>
                        <td>{student.guardianFullName?.trim() || 'Sin tutor capturado'}</td>
                        <td>{student.semesterLevel}°</td>
                        <td><span className={dailyStatusClassName(student.dailyStatus)}>{student.dailyStatusLabel}</span></td>
                        <td>{student.documentationStatus}</td>
                        <td>{student.statusLabel}</td>
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
                <p className="empty-state">No hay alumnos que coincidan con la búsqueda.</p>
              ) : null}
            </section>
          ) : null}

          {operationsTab === 'alumnos' ? (
            <section className="panel" ref={studentsSectionRef}>
              <div className="section-header">
                <div>
                  <p className="eyebrow">Control Escolar</p>
                  <h2 className="compact-header">Alumnos filtrados</h2>
                  <p className="compact-operational-line">La lista queda al frente para buscar, validar y abrir la ficha del alumno con menos rodeos.</p>
                </div>
                <span className="status-tag">{filteredStudents.length} resultados</span>
              </div>

              {students.length === 0 ? (
                <DashboardEmptyState
                  title="Todavía no hay alumnos registrados"
                  description="Comienza agregando un nuevo alumno o abre Admisión para trabajar con la captura inicial."
                  actions={<>
                    <button
                      className="primary-button"
                      onClick={() => {
                        setOperationsTab('captura');
                        setCaptureTab('formulario');
                      }}
                      type="button"
                    >
                      Agregar alumno
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setOperationsTab('captura');
                        setCaptureTab('fichas');
                      }}
                      type="button"
                    >
                      Importar padrón
                    </button>
                  </>} />
              ) : null}

              {paginatedStudents.length > 0 ? (
                <StudentTable
                  paginatedStudents={paginatedStudents}
                  editingStudentId={editingStudentId}
                  expandedStudentId={expandedStudentId}
                  setExpandedStudentId={setExpandedStudentId}
                  handleStartEditStudent={handleStartEditStudent}
                  formatPreferredEnrollment={formatPreferredEnrollment}
                  formatVisibleGroupLabel={formatVisibleGroupLabel}
                  dailyStatusClassName={dailyStatusClassName} />
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
                <DashboardEmptyState
                  title="Sin resultados para la búsqueda actual"
                  description="Ajusta matrícula, nombre, tutor o filtros para volver a mostrar alumnos." />
              ) : null}
            </section>
          ) : null}

          {operationsTab === 'captura' && captureTab === 'formulario' ? (
            <StudentCaptureFormPanel
              FieldComponent={Field}
              activeAdmission={activeAdmission}
              captureSectionRef={captureSectionRef}
              editingStudentId={editingStudentId}
              feedback={feedback}
              form={form}
              onBackToFichas={() => {
                setOperationsTab('captura');
                setCaptureTab('fichas');
              }}
              onCancelEdit={onCancelEdit}
              onSubmit={onSubmit}
              onUpdateField={onUpdateField}
              relationshipOptions={relationshipOptions}
              saving={saving} />
          ) : null}
        </div>
      </div>


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
                              onChange={() => handleChecklistItemChange(index, { isDelivered: true, missingJustification: '', deadlineAt: '' })} />
                            Entregado
                          </label>
                          <label>
                            <input
                              checked={!item.isDelivered}
                              type="radio"
                              name={`delivered-${item.requirementId}`}
                              onChange={() => handleChecklistItemChange(index, { isDelivered: false })} />
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
    </section>
  );
}
