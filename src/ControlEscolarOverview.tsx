import { useState, useMemo, useEffect } from 'react';
import { ControlEscolarProps } from './App';
import { CONTROL_STUDENTS_PER_PAGE, getOutputFileName, formatPreferredEnrollment, formatVisibleGroupLabel, relationshipOptions, combinedStudentStatusClassName, combinedStudentStatusLabel, formatGroupLabelWithoutCareer, getCareerLabelFromGroupLabel } from '@/lib/utils';
import { pickRosterWorkbookFile, parseRosterWorkbook } from '@/lib/roster-import';
import { pickEnrollmentWorkbookFile, parseEnrollmentWorkbook } from '@/lib/enrollment-import';
import { groupSexBalanceLabel, groupBandBalanceLabel } from '@/lib/group-stats';
import { Field } from './components/ui/Field';
import { SearchInput } from './components/ui/SearchInput';
import { ControlEscolarToolbar } from './components/control-escolar/control-escolar-toolbar';
import { AdmissionCaptureTable, PreRegistrationInboxPanel } from './components/control-escolar/panels';
import { StudentCaptureFormPanel } from './components/control-escolar/student-capture-form-panel';
import { type DashboardMetric, ModuleHero, ModuleBarCompact, DashboardEmptyState } from './components/dashboard-kit';
import { StudentTable } from './components/StudentTable';
import type { GroupStat, GroupPreviewRow, StudentRequirementChecklist, StudentSummary, AdmissionSummary, SaveStudentRequirementChecklistInput } from './types/domain';

const TARGET_SCHOOL_CYCLE = '2026-2027';
const TARGET_SCHOOL_PERIOD = 1;

function isActiveForSemesterTransition(student: StudentSummary) {
  return ['INSCRITO', 'ASIGNADO', 'CONFIRMADO'].includes(student.enrollmentStatus);
}

function targetSemesterForReinscription(student: StudentSummary) {
  if (student.semesterLevel === 2) return 3;
  if (student.semesterLevel === 4) return 5;
  return null;
}

export function ControlEscolarOverview({
  form, students, preRegistrations, admissions, recentAuditLogs, captureQuery, activeAdmission, editingAcademicContext, editingStudentId, newlyCreatedStudentId, saving, feedback, studentsSectionRef, captureSectionRef, onCancelEdit, onEditStudent, onUpdatePreRegistrationStatus, onSubmit, onUpdateField, onSelectAdmissionForCapture, onUpdateCaptureQuery, onExportSep, onReloadData, onClearNewlyCreatedStudent, groupsApi, studentsApi,
}: ControlEscolarProps) {
  const [captureTab, setCaptureTab] = useState<'fichas' | 'formulario'>('fichas');
  const [operationsTab, setOperationsTab] = useState<'captura' | 'bandeja' | 'grupos' | 'estadisticas' | 'inscripcion' | 'alumnos'>('alumnos');
  const [studentFormMode, setStudentFormMode] = useState<'captura' | 'edicion' | 'inscripcion' | 'reinscripcion'>('captura');
  const [academicMovementTab, setAcademicMovementTab] = useState<'movimientos' | 'asignacion'>('movimientos');
  const [studentQuery, setStudentQuery] = useState('');
  const [semesterFilter, setSemesterFilter] = useState<'all' | '1' | '2' | '3' | '4' | '5' | '6'>('all');
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
  const [moveStudentQuery, setMoveStudentQuery] = useState('');
  const [moveGroupId, setMoveGroupId] = useState('');
  const [moveReason, setMoveReason] = useState('');
  const [noShowStudentId, setNoShowStudentId] = useState('');
  const [noShowStudentQuery, setNoShowStudentQuery] = useState('');
  const [noShowReason, setNoShowReason] = useState('');
  const [selectedChecklistStudentId, setSelectedChecklistStudentId] = useState('');
  const [requirementChecklist, setRequirementChecklist] = useState<StudentRequirementChecklist | null>(null);
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [finalizingEnrollment, setFinalizingEnrollment] = useState(false);
  const [checklistFeedback, setChecklistFeedback] = useState<string | null>(null);
  const [importIssues, setImportIssues] = useState<string[]>([]);
  const [isImportingEnrollmentRoster, setIsImportingEnrollmentRoster] = useState(false);
  const [preparingEnrollmentStudentId, setPreparingEnrollmentStudentId] = useState<string | null>(null);
  const [advisorDrafts, setAdvisorDrafts] = useState<Record<string, string>>({});
  const [savingAdvisorGroup, setSavingAdvisorGroup] = useState<string | null>(null);
  const [isChecklistModalOpen, setIsChecklistModalOpen] = useState(false);
  const [inscriptionQuery, setInscriptionQuery] = useState('');
  const [inscriptionPage, setInscriptionPage] = useState(1);
  const uniqueDocumentationStatuses = useMemo(
    () => Array.from(new Set(students.map((student) => student.documentationStatus).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [students]
  );
  const normalizedStudentQuery = studentQuery.trim().toLowerCase();
  const formalStudents = students.filter((student) => student.enrollmentStatus !== 'FICHA_ENTREGADA' && student.enrollmentStatus !== 'EGRESADO');
  const fichaStudents = students.filter((student) => student.enrollmentStatus === 'FICHA_ENTREGADA');
  const targetPeriodStudents = formalStudents.filter((student) => student.schoolCycle === TARGET_SCHOOL_CYCLE && student.schoolPeriod === TARGET_SCHOOL_PERIOD && [1, 3, 5].includes(student.semesterLevel));
  const pendingReinscriptionStudents = students.filter((student) => isActiveForSemesterTransition(student) && targetSemesterForReinscription(student) !== null);
  const pendingGraduationStudents = students.filter((student) => isActiveForSemesterTransition(student) && student.semesterLevel === 6);
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

  const filteredStudents = formalStudents.filter((student) => matchesDirectoryFilters(student, normalizedStudentQuery));
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
  const filterMovementStudents = (query: string, selectedStudentId: string) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return students;
    return students.filter((student) => {
      if (student.id === selectedStudentId) return true;
      const haystack = [
        student.enrollmentNumber,
        student.officialEnrollmentNumber ?? '',
        student.fullName,
        student.curp,
        student.groupLabel ?? '',
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  };
  const moveStudentOptions = filterMovementStudents(moveStudentQuery, moveStudentId);
  const noShowStudentOptions = filterMovementStudents(noShowStudentQuery, noShowStudentId);
  const previewTotalPages = Math.max(1, Math.ceil(filteredPreviewRows.length / 20));
  const paginatedPreviewRows = filteredPreviewRows.slice((previewPage - 1) * 20, previewPage * 20);
  const normalizedInscriptionQuery = inscriptionQuery.trim().toLowerCase();
  const filteredInscriptionStudents = [...fichaStudents, ...pendingReinscriptionStudents, ...pendingGraduationStudents].filter((student) => matchesDirectoryFilters(student, normalizedInscriptionQuery));
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
    setStudentFormMode('captura');
    setCaptureTab('formulario');
    setTimeout(() => {
      captureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  async function handleStartEditStudent(studentId: string) {
    await onEditStudent(studentId);
    setStudentFormMode('edicion');
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
      setImportIssues(allIssues);
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

  async function handleImportEnrollmentRoster() {
    if (!studentsApi?.importEnrollmentRoster || isImportingEnrollmentRoster) return;
    try {
      const file = await pickEnrollmentWorkbookFile();
      if (!file) {
        setChecklistFeedback('Importacion cancelada.');
        return;
      }

      setIsImportingEnrollmentRoster(true);
      setChecklistFeedback(`Leyendo ${file.name}...`);
      const parsed = await parseEnrollmentWorkbook(file);
      if (parsed.rows.length === 0) {
        setChecklistFeedback('El archivo no contiene alumnos validos para importar matricula.');
        return;
      }

      setChecklistFeedback(`Importando ${parsed.rows.length} alumnos desde ${file.name}...`);
      const result = await studentsApi.importEnrollmentRoster({
        schoolCycle: form.schoolCycle,
        sourcePath: file.name,
        rows: parsed.rows,
      });
      const allIssues = [...parsed.issues, ...result.issues].slice(0, 12);
      setImportIssues(allIssues);
      const issuesSuffix = allIssues.length > 0 ? ` Avisos: ${allIssues.join(' | ')}` : '';
      setChecklistFeedback(
        `Matricula importada desde ${file.name}: ${result.createdCount} alumnos nuevos, ${result.updatedCount} actualizados, ${result.assignedCount} asignados, ${result.createdGroupCount} grupos nuevos, ${result.skippedCount + parsed.skippedCount} filas omitidas.${issuesSuffix}`
      );
      await refreshGroupStats();
      await onReloadData();
    } catch (error) {
      setChecklistFeedback(error instanceof Error ? `No se pudo importar la matricula: ${error.message}` : 'No se pudo importar la matricula.');
    } finally {
      setIsImportingEnrollmentRoster(false);
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

  async function handlePrepareEnrollmentReview(student: StudentSummary) {
    if (preparingEnrollmentStudentId) return;
    setPreparingEnrollmentStudentId(student.id);
    try {
      await onEditStudent(student.id);
      const checklist = await window.cbta?.students?.getRequirementChecklist?.(student.id);
      if (checklist) {
        setSelectedChecklistStudentId(student.id);
        setRequirementChecklist(checklist);
      }
      setStudentFormMode('inscripcion');
      setOperationsTab('captura');
      setCaptureTab('formulario');
      setChecklistFeedback(`Revisa la documentacion y completa los datos faltantes de ${student.fullName}. Aun no se ha formalizado la inscripcion.`);
      setTimeout(() => {
        captureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (error) {
      setChecklistFeedback(error instanceof Error ? error.message : 'No se pudo abrir la revision de inscripcion.');
    } finally {
      setPreparingEnrollmentStudentId(null);
    }
  }

  async function handlePrepareReinscriptionReview(student: StudentSummary) {
    const targetSemester = targetSemesterForReinscription(student);
    if (!targetSemester || preparingEnrollmentStudentId) return;
    setPreparingEnrollmentStudentId(student.id);
    try {
      await onEditStudent(student.id);
      onUpdateField('schoolCycle', TARGET_SCHOOL_CYCLE);
      onUpdateField('schoolPeriod', TARGET_SCHOOL_PERIOD);
      onUpdateField('semesterLevel', targetSemester);
      const checklist = await window.cbta?.students?.getRequirementChecklist?.(student.id);
      if (checklist) {
        setSelectedChecklistStudentId(student.id);
        setRequirementChecklist(checklist);
      }
      setStudentFormMode('reinscripcion');
      setOperationsTab('captura');
      setCaptureTab('formulario');
      setChecklistFeedback(`Revisa documentacion y datos faltantes de ${student.fullName}. Pasara a ${targetSemester}o semestre en ${TARGET_SCHOOL_CYCLE}/${TARGET_SCHOOL_PERIOD}.`);
      setTimeout(() => {
        captureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (error) {
      setChecklistFeedback(error instanceof Error ? error.message : 'No se pudo abrir la reinscripcion.');
    } finally {
      setPreparingEnrollmentStudentId(null);
    }
  }

  async function handleGraduateStudent(student: StudentSummary) {
    if (!studentsApi?.graduatePeriod) return;
    try {
      const result = await studentsApi.graduatePeriod({
        studentId: student.id,
        fromSchoolCycle: student.schoolCycle,
        fromPeriod: student.schoolPeriod,
        notes: `Egreso hacia ${TARGET_SCHOOL_CYCLE}/${TARGET_SCHOOL_PERIOD}`,
      });
      setChecklistFeedback(`${student.fullName} marcado como egresado. Egresados procesados: ${result.graduatedCount}.`);
      await onReloadData();
    } catch (error) {
      setChecklistFeedback(error instanceof Error ? error.message : 'No se pudo marcar egreso.');
    }
  }

  async function handleSaveAdvisor(groupId: string) {
    if (!groupsApi?.updateAdvisor) return;
    setSavingAdvisorGroup(groupId);
    try {
      await groupsApi.updateAdvisor({ groupId, advisorName: advisorDrafts[groupId] ?? '' });
      setChecklistFeedback('Asesor de grupo actualizado.');
      await refreshGroupStats();
      await onReloadData();
    } catch (error) {
      setChecklistFeedback(error instanceof Error ? error.message : 'No se pudo guardar el asesor.');
    } finally {
      setSavingAdvisorGroup(null);
    }
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

  function handleCancelStudentForm() {
    const wasEnrollmentMode = studentFormMode === 'inscripcion' || studentFormMode === 'reinscripcion';
    setStudentFormMode('captura');
    setSelectedChecklistStudentId('');
    setRequirementChecklist(null);
    onCancelEdit();
    if (wasEnrollmentMode) {
      setOperationsTab('inscripcion');
    }
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

  async function handleFinalizeEnrollment() {
    if (!editingStudentId || !studentsApi?.update || !window.cbta?.students?.saveRequirementChecklist || !requirementChecklist) return;
    setFinalizingEnrollment(true);
    setChecklistFeedback(null);
    try {
      const formToSave = studentFormMode === 'reinscripcion' && editingAcademicContext
        ? {
          ...form,
          schoolCycle: editingAcademicContext.schoolCycle,
          schoolPeriod: editingAcademicContext.schoolPeriod,
          semesterLevel: editingAcademicContext.semesterLevel,
        }
        : form;
      await studentsApi.update(editingStudentId, formToSave);
      const payload: SaveStudentRequirementChecklistInput = {
        items: requirementChecklist.items.map((item) => ({
          requirementId: item.requirementId,
          isDelivered: item.isDelivered,
          missingJustification: item.missingJustification,
          deadlineAt: item.deadlineAt,
          notes: item.notes,
        })),
      };
      const savedChecklist = await window.cbta.students.saveRequirementChecklist(editingStudentId, payload);
      setRequirementChecklist(savedChecklist);
      const targetSemester = form.semesterLevel === 2 ? 3 : form.semesterLevel === 4 ? 5 : form.semesterLevel;
      const updated = studentFormMode === 'reinscripcion'
        ? await studentsApi.reinscribeForPeriod({
          studentId: editingStudentId,
          targetSchoolCycle: TARGET_SCHOOL_CYCLE,
          targetPeriod: TARGET_SCHOOL_PERIOD,
          targetSemesterLevel: targetSemester ?? form.semesterLevel,
          toGroupId: null,
          notes: `Reinscripcion ${TARGET_SCHOOL_CYCLE}/${TARGET_SCHOOL_PERIOD}`,
        })
        : await studentsApi.formalizeEnrollment({ studentId: editingStudentId });
      setChecklistFeedback(studentFormMode === 'reinscripcion'
        ? `${updated.fullName} reinscrito en ${TARGET_SCHOOL_CYCLE}/${TARGET_SCHOOL_PERIOD}.`
        : `${updated.fullName} inscrito formalmente con matricula ${formatPreferredEnrollment(updated)}.`);
      setStudentFormMode('captura');
      setSelectedChecklistStudentId('');
      setRequirementChecklist(null);
      onCancelEdit();
      setOperationsTab('inscripcion');
      await refreshGroupStats();
      await onReloadData();
    } catch (error) {
      setChecklistFeedback(error instanceof Error ? error.message : 'No se pudo completar la inscripcion formal.');
    } finally {
      setFinalizingEnrollment(false);
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

  const docsPendingCount = formalStudents.filter((student) => student.documentationStatus !== 'COMPLETA').length;
  const withoutGroupCount = formalStudents.filter((student) => !student.groupLabel).length;
  const inscriptionPendingCount = fichaStudents.length + pendingReinscriptionStudents.length;
  const inscriptionMetrics = [
    { label: `Inscritos ${TARGET_SCHOOL_CYCLE}/${TARGET_SCHOOL_PERIOD}`, value: targetPeriodStudents.length, helper: 'Alumnos activos' },
    { label: 'Faltantes', value: inscriptionPendingCount, helper: 'Por inscribir o reinscribir', tone: inscriptionPendingCount > 0 ? 'warning' : 'default' },
    { label: 'Nuevo ingreso', value: fichaStudents.length, helper: 'Fichas pendientes' },
    { label: 'Reinscripcion', value: pendingReinscriptionStudents.length, helper: '2o y 4o pendientes' },
    { label: 'Sextos por egresar', value: pendingGraduationStudents.length, helper: 'Cierre semestral', tone: pendingGraduationStudents.length > 0 ? 'warning' : 'default' },
  ] satisfies DashboardMetric[];
  const semesterStats = [1, 2, 3, 4, 5, 6].map((semester) => ({
    semester,
    count: formalStudents.filter((student) => student.semesterLevel === semester).length,
  }));
  const activeSemesterStats = semesterStats.filter((item) => item.count > 0);
  const fichaStatsByGroup = Array.from(
    fichaStudents.reduce((map, student) => {
      const key = student.groupLabel ?? 'Sin grupo';
      const current = map.get(key) ?? { groupLabel: key, total: 0, docsPending: 0 };
      current.total += 1;
      if (student.documentationStatus !== 'COMPLETA') current.docsPending += 1;
      map.set(key, current);
      return map;
    }, new Map<string, { groupLabel: string; total: number; docsPending: number }>()),
  ).map((entry) => entry[1]).sort((left, right) => left.groupLabel.localeCompare(right.groupLabel));
  const groupStatsSummary = Array.from(
    formalStudents.reduce((map, student) => {
      const key = `${student.semesterLevel}|${student.groupLabel ?? 'Sin grupo'}`;
      const current = map.get(key) ?? {
        groupId: student.groupId ?? '',
        semester: student.semesterLevel,
        groupLabel: student.groupLabel ?? 'Sin grupo',
        visibleGroup: formatGroupLabelWithoutCareer(student.groupLabel, student.semesterLevel),
        career: getCareerLabelFromGroupLabel(student.groupLabel),
        schoolCycle: student.schoolCycle,
        advisor: student.groupAdvisorName ?? 'Pendiente',
        total: 0,
        docsPending: 0,
      };
      current.total += 1;
      if (student.documentationStatus !== 'COMPLETA') current.docsPending += 1;
      map.set(key, current);
      return map;
    }, new Map<string, { groupId: string; semester: number; groupLabel: string; visibleGroup: string; career: string; schoolCycle: string; advisor: string; total: number; docsPending: number }>()),
  )
    .map((entry) => entry[1])
    .sort((left, right) => {
      if (left.semester !== right.semester) return left.semester - right.semester;
      return left.groupLabel.localeCompare(right.groupLabel);
    });
  const groupCount = groupStatsSummary.filter((group) => group.groupLabel !== 'Sin grupo').length;
  const assignedGroupTotal = groupStats.reduce((total, group) => total + group.assignedCount, 0);
  const fullGroupCount = groupStats.filter((group) => group.assignedCount >= group.capacity).length;
  const balanceAdjustmentCount = groupStats.filter((group) => groupBandBalanceLabel(group) === 'Ajustar').length;
  const movementSummaryMetrics = [
    { label: 'Sin grupo', value: withoutGroupCount, helper: withoutGroupCount > 0 ? 'Requieren seguimiento' : 'Sin pendientes' },
    { label: 'Grupos activos', value: groupStats.length || groupCount, helper: 'Disponibles para movimiento' },
    { label: 'Asignados', value: assignedGroupTotal || formalStudents.filter((student) => student.groupLabel).length, helper: 'Con grupo registrado' },
    { label: 'Alertas', value: fullGroupCount + balanceAdjustmentCount, helper: 'Cupo o balance' },
  ];
  const controlMetrics: DashboardMetric[] = [
    { label: 'Total plantel', value: formalStudents.length, helper: 'Alumnos inscritos' },
    { label: 'Grupos', value: groupCount, helper: 'Con alumnos' },
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
            setCaptureTab={(nextTab) => {
              if (nextTab === 'formulario') {
                setStudentFormMode('captura');
              }
              setCaptureTab(nextTab);
            }}
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
            uniqueDocumentationStatuses={uniqueDocumentationStatuses}
            isImportingEnrollmentRoster={isImportingEnrollmentRoster}
            onImportEnrollmentRoster={() => void handleImportEnrollmentRoster()} />

          {checklistFeedback ? <p className="feedback-banner">{checklistFeedback}</p> : null}
          {importIssues.length > 0 ? (
            <div className="feedback-banner">
              <strong>Avisos de importacion</strong>
              <ul>
                {importIssues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            </div>
          ) : null}

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
                <span className="status-tag">{academicMovementTab === 'asignacion' ? (isPreviewStats ? 'Vista previa' : 'Nuevo ingreso MATUTINO') : 'Operacion diaria'}</span>
              </div>
              <div className="academic-movement-tabs">
                <div className="segmented-tabs compact-segmented-tabs">
                  <button className={academicMovementTab === 'movimientos' ? 'segmented-tab active' : 'segmented-tab'} onClick={() => setAcademicMovementTab('movimientos')} type="button">Movimientos</button>
                  <button className={academicMovementTab === 'asignacion' ? 'segmented-tab active' : 'segmented-tab'} onClick={() => setAcademicMovementTab('asignacion')} type="button">Asignacion de nuevo ingreso</button>
                </div>
              </div>
              {academicMovementTab === 'movimientos' ? (
                <>
                  <div className="academic-summary-grid">
                    {movementSummaryMetrics.map((metric) => (
                      <article className={metric.label === 'Sin grupo' && withoutGroupCount > 0 ? 'academic-summary-card warning' : 'academic-summary-card'} key={metric.label}>
                        <span>{metric.label}</span>
                        <strong>{metric.value}</strong>
                        <small>{metric.helper}</small>
                      </article>
                    ))}
                  </div>
                  {withoutGroupCount > 0 ? (
                    <div className="feedback-banner academic-attention-banner">
                      <span>{withoutGroupCount} alumno{withoutGroupCount === 1 ? '' : 's'} sin grupo. Revisa si corresponde asignacion especial o importacion de listado.</span>
                      <button className="secondary-button small-button" onClick={() => setAcademicMovementTab('asignacion')} type="button">Abrir asignacion</button>
                    </div>
                  ) : null}
                </>
              ) : null}
              <div className="button-row">
                <button className="secondary-button small-button" hidden={academicMovementTab !== 'asignacion'} onClick={() => void handlePreviewAssign()} type="button">Ver vista previa</button>
                <button className="primary-button small-button" hidden={academicMovementTab !== 'asignacion'} onClick={() => void handleAutoAssign()} type="button">Generar asignacion</button>
                <button className="secondary-button small-button" hidden={academicMovementTab !== 'asignacion'} onClick={() => void handleConfirmGroups()} type="button">Confirmar asignacion</button>
                <button className="secondary-button small-button" hidden={academicMovementTab !== 'movimientos'} onClick={() => void handleImportAssignedRoster()} type="button">Importar Excel</button>
                <button className="secondary-button small-button" hidden={academicMovementTab !== 'movimientos'} onClick={() => void handleExportAssignedRoster()} type="button">Exportar Excel</button>
                <button className="secondary-button small-button" hidden={academicMovementTab !== 'movimientos'} onClick={() => void handlePrintAssignedRoster()} type="button">Imprimir listado</button>
              </div>
              <p className="table-summary" hidden={academicMovementTab !== 'movimientos'}>La importación acepta el Excel exportado por este listado o cualquier archivo con columnas Grupo y CURP o folio interno.</p>
              {checklistFeedback ? <p className="feedback-banner">{checklistFeedback}</p> : null}
              {isPreviewStats && academicMovementTab === 'asignacion' ? <p className="table-summary">Previsualización calculada sin guardar cambios.</p> : null}
              <div className="student-table-wrap" hidden={academicMovementTab !== 'asignacion'}>
                <table className="student-table"><thead><tr><th>Grupo</th><th>Asignados</th><th>Cupo</th><th>Alto</th><th>Medio</th><th>Bajo</th><th>H</th><th>M</th><th>Balance sexo</th><th>Balance promedio</th></tr></thead><tbody>
                  {groupStats.map((stat) => <tr key={stat.groupId}><td>{stat.label}</td><td>{stat.assignedCount}</td><td>{stat.capacity}</td><td>{stat.bands.alto}</td><td>{stat.bands.medio}</td><td>{stat.bands.bajo}</td><td>{stat.sex.hombre}</td><td>{stat.sex.mujer}</td><td>{groupSexBalanceLabel(stat)}</td><td>{groupBandBalanceLabel(stat)}</td></tr>)}
                </tbody></table>
              </div>
              {academicMovementTab === 'asignacion' && isPreviewStats && groupPreviewRows.length > 0 ? (
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
              <div className="form-grid" hidden={academicMovementTab !== 'movimientos'}>
                <Field label="Buscar alumno">
                  <SearchInput
                    aria-label="Buscar alumno para mover"
                    className="search-shell movement-search"
                    placeholder="Matricula, nombre, CURP o grupo"
                    value={moveStudentQuery}
                    onChange={setMoveStudentQuery}
                  />
                </Field>
                <Field label="Alumno para mover">
                  <select className="group-select" value={moveStudentId} onChange={(event) => setMoveStudentId(event.target.value)}>
                    <option value="">Selecciona alumno</option>
                    {moveStudentOptions.map((student) => (
                      <option key={student.id} value={student.id}>{student.enrollmentNumber} - {student.fullName}</option>
                    ))}
                  </select>
                  <span className="movement-search-count">{moveStudentOptions.length} coincidencia{moveStudentOptions.length === 1 ? '' : 's'}</span>
                  {moveStudentOptions.length === 0 ? <span className="movement-search-empty">Sin alumnos que coincidan.</span> : null}
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
              <div className="form-grid" hidden={academicMovementTab !== 'movimientos'}>
                <Field label="Buscar no-show">
                  <SearchInput
                    aria-label="Buscar alumno no-show"
                    className="search-shell movement-search"
                    placeholder="Matricula, nombre, CURP o grupo"
                    value={noShowStudentQuery}
                    onChange={setNoShowStudentQuery}
                  />
                </Field>
                <Field label="Alumno no-show">
                  <select className="group-select" value={noShowStudentId} onChange={(event) => setNoShowStudentId(event.target.value)}>
                    <option value="">Selecciona alumno</option>
                    {noShowStudentOptions.map((student) => (
                      <option key={student.id} value={student.id}>{student.enrollmentNumber} - {student.fullName}</option>
                    ))}
                  </select>
                  <span className="movement-search-count">{noShowStudentOptions.length} coincidencia{noShowStudentOptions.length === 1 ? '' : 's'}</span>
                  {noShowStudentOptions.length === 0 ? <span className="movement-search-empty">Sin alumnos que coincidan.</span> : null}
                </Field>
                <Field className="span-2" label="Motivo no-show"><input value={noShowReason} onChange={(event) => setNoShowReason(event.target.value)} placeholder="No se presentó" /></Field>
                <button className="secondary-button small-button" onClick={() => void handleNoShow()} type="button">Marcar no-show</button>
              </div>
            </section>
          ) : null}

          {operationsTab === 'estadisticas' ? (
            <section className="panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Control Escolar</p>
                  <h2 className="compact-header">Estadisticas de matricula</h2>
                  <p className="compact-operational-line">Resumen por carrera, grado, grupo, asesor y ciclo escolar.</p>
                </div>
                <span className="status-tag">{formalStudents.length} alumnos</span>
              </div>

              <div className="metric-strip">
                {activeSemesterStats.length === 0 ? (
                  <div className="metric-chip">
                    <span className="metric-chip-label">Sin datos</span>
                    <strong className="metric-chip-value">0</strong>
                    <span className="metric-chip-helper">Alumnos</span>
                  </div>
                ) : activeSemesterStats.map((item) => (
                  <div className="metric-chip" key={item.semester}>
                    <span className="metric-chip-label">{item.semester} semestre</span>
                    <strong className="metric-chip-value">{item.count}</strong>
                    <span className="metric-chip-helper">Alumnos</span>
                  </div>
                ))}
              </div>

              <div className="student-table-wrap">
                <table className="student-table">
                  <thead>
                    <tr>
                      <th>Carrera</th>
                      <th>Grado</th>
                      <th>Grupo</th>
                      <th>Alumnos</th>
                      <th>Asesor</th>
                      <th>Ciclo</th>
                      <th>Docs pendientes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupStatsSummary.map((group) => (
                      <tr key={`${group.semester}-${group.groupLabel}`}>
                        <td>{group.career}</td>
                        <td>{group.semester} semestre</td>
                        <td>{group.visibleGroup}</td>
                        <td>{group.total}</td>
                        <td>
                          {group.groupId ? (
                            <div className="button-row">
                              <input
                                value={advisorDrafts[group.groupId] ?? group.advisor}
                                onChange={(event) => setAdvisorDrafts((current) => ({ ...current, [group.groupId]: event.target.value }))}
                              />
                              <button
                                className="secondary-button small-button"
                                disabled={savingAdvisorGroup === group.groupId}
                                onClick={() => void handleSaveAdvisor(group.groupId)}
                                type="button"
                              >
                                {savingAdvisorGroup === group.groupId ? 'Guardando...' : 'Guardar'}
                              </button>
                            </div>
                          ) : group.advisor}
                        </td>
                        <td>{group.schoolCycle}</td>
                        <td>{group.docsPending}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="section-header">
                <div>
                  <p className="eyebrow">Nuevo ingreso</p>
                  <h2 className="compact-header">Fichas en proceso</h2>
                  <p className="compact-operational-line">Estos alumnos aun no cuentan como inscritos formales.</p>
                </div>
                <span className="status-tag">{fichaStudents.length} fichas</span>
              </div>
              <div className="student-table-wrap">
                <table className="student-table">
                  <thead>
                    <tr>
                      <th>Grupo</th>
                      <th>Fichas</th>
                      <th>Docs pendientes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fichaStatsByGroup.map((group) => (
                      <tr key={group.groupLabel}>
                        <td>{formatVisibleGroupLabel(group.groupLabel)}</td>
                        <td>{group.total}</td>
                        <td>{group.docsPending}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {operationsTab === 'inscripcion' ? (
            <section className="panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Control Escolar</p>
                  <h2 className="compact-header">Inscripción</h2>
                  <p className="compact-operational-line">Transicion semestral hacia {TARGET_SCHOOL_CYCLE}/{TARGET_SCHOOL_PERIOD}: nuevo ingreso, reinscripcion y egreso.</p>
                </div>
                <span className="status-tag">Checklist y plazo de entrega</span>
              </div>
              <div className="metric-strip">
                {inscriptionMetrics.map((metric) => (
                  <div className={`metric-chip ${metric.tone === 'warning' ? 'metric-chip-warning' : ''}`} key={metric.label}>
                    <span className="metric-chip-label">{metric.label}</span>
                    <strong className="metric-chip-value">{metric.value}</strong>
                    <span className="metric-chip-helper">{metric.helper}</span>
                  </div>
                ))}
              </div>
              {checklistFeedback ? <p className="feedback-banner">{checklistFeedback}</p> : null}
              <div className="student-table-wrap">
                <table className="student-table table-inscripcion-ce">
                  <thead>
                    <tr>
                      <th>Ficha / Matricula</th>
                      <th>Alumno</th>
                      <th>Tutor</th>
                      <th>Ciclo</th>
                      <th>Semestre</th>
                      <th>Estado actual</th>
                      <th>Documentación</th>
                      <th>Inscripción</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedInscriptionStudents.map((student) => (
                      <tr key={`checklist-${student.id}`} className={selectedChecklistStudentId === student.id ? 'student-row active' : 'student-row'}>
                        <td><strong>{formatPreferredEnrollment(student)}</strong></td>
                        <td>{student.fullName}</td>
                        <td>{student.guardianFullName?.trim() || 'Sin tutor capturado'}</td>
                        <td>{student.schoolCycle}/{student.schoolPeriod}</td>
                        <td>{student.semesterLevel}°</td>
                        <td><span className={combinedStudentStatusClassName(student)}>{combinedStudentStatusLabel(student)}</span></td>
                        <td>{student.documentationStatus}</td>
                        <td>{student.statusLabel}</td>
                        <td>
                          <div className="button-row">
                            <button className="secondary-button small-button" onClick={() => void handleLoadRequirementChecklist(student.id)} type="button">
                              Revisar
                            </button>
                            {student.enrollmentStatus === 'FICHA_ENTREGADA' ? (
                              <button
                                className="primary-button small-button"
                                disabled={preparingEnrollmentStudentId === student.id}
                                onClick={() => void handlePrepareEnrollmentReview(student)}
                                type="button"
                              >
                                {preparingEnrollmentStudentId === student.id ? 'Abriendo...' : 'Inscribir'}
                              </button>
                            ) : null}
                            {targetSemesterForReinscription(student) ? (
                              <button
                                className="primary-button small-button"
                                disabled={preparingEnrollmentStudentId === student.id}
                                onClick={() => void handlePrepareReinscriptionReview(student)}
                                type="button"
                              >
                                {preparingEnrollmentStudentId === student.id ? 'Abriendo...' : 'Reinscribir'}
                              </button>
                            ) : null}
                            {student.semesterLevel === 6 && isActiveForSemesterTransition(student) ? (
                              <button className="secondary-button small-button" onClick={() => void handleGraduateStudent(student)} type="button">
                                Egresar
                              </button>
                            ) : null}
                          </div>
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

              {formalStudents.length === 0 ? (
                <DashboardEmptyState
                  title="Todavía no hay alumnos registrados"
                  description="Comienza agregando un nuevo alumno o abre Admisión para trabajar con la captura inicial."
                  actions={<>
                    <button
                      className="primary-button"
                      onClick={() => {
                        setOperationsTab('captura');
                        setStudentFormMode('captura');
                        setCaptureTab('formulario');
                      }}
                      type="button"
                    >
                      Agregar alumno
                    </button>
                    <button
                      className="secondary-button"
                      disabled={isImportingEnrollmentRoster}
                      onClick={() => void handleImportEnrollmentRoster()}
                      type="button"
                    >
                      {isImportingEnrollmentRoster ? 'Importando...' : 'Importar padron'}
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
                />
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

              {formalStudents.length > 0 && filteredStudents.length === 0 ? (
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
              editingAcademicContext={editingAcademicContext}
              editingStudentId={editingStudentId}
              enrollmentChecklist={studentFormMode === 'inscripcion' || studentFormMode === 'reinscripcion' ? requirementChecklist : null}
              feedback={feedback}
              finalizingEnrollment={finalizingEnrollment}
              form={form}
              mode={studentFormMode}
              onBackToFichas={() => {
                setOperationsTab('captura');
                setCaptureTab('fichas');
              }}
              onCancelEdit={handleCancelStudentForm}
              onChecklistItemChange={handleChecklistItemChange}
              onFinalizeEnrollment={handleFinalizeEnrollment}
              onSubmit={onSubmit}
              onUpdateField={onUpdateField}
              relationshipOptions={relationshipOptions}
              savingEnrollmentChecklist={savingChecklist}
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
