import { Fragment } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { StudentSummary } from '@/types/domain'
import { combinedStudentStatusClassName, combinedStudentStatusLabel, formatGroupLabelWithoutCareer, getCareerCodeFromGroupLabel } from '@/lib/utils'

type StudentTableProps = {
  paginatedStudents: StudentSummary[]
  editingStudentId: string | null
  expandedStudentId: string | null
  setExpandedStudentId: Dispatch<SetStateAction<string | null>>
  handleStartEditStudent: (studentId: string) => Promise<void>
  formatPreferredEnrollment: (student: StudentSummary) => string
}

export function StudentTable({
  paginatedStudents,
  editingStudentId,
  expandedStudentId,
  setExpandedStudentId,
  handleStartEditStudent,
  formatPreferredEnrollment,
}: StudentTableProps) {
  function documentationClassName(status: string) {
    return status === 'COMPLETA' ? 'status-tag success' : 'status-tag warning'
  }

  function enrollmentClassName(status: string) {
    if (status === 'Inscrito' || status === 'Asignado a grupo') return 'status-tag success'
    if (status === 'Baja' || status === 'Baja definitiva' || status === 'Egresado') return 'status-tag danger'
    return 'status-tag warning'
  }

  return (
    <div className="student-table-wrap">
      <table className="student-table control-directory-table">
        <thead>
          <tr>
            <th>Matrícula</th>
            <th>Alumno</th>
            <th>Tutor</th>
            <th>Semestre</th>
            <th>Grupo</th>
            <th>Carrera</th>
            <th>Estado actual</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {paginatedStudents.map((student) => {
            const active = editingStudentId === student.id
            const expanded = expandedStudentId === student.id
            const guardianName = student.guardianFullName?.trim().length ? student.guardianFullName : 'Sin tutor capturado'
            const guardianPhone = student.guardianPhone?.trim().length ? student.guardianPhone : 'Sin teléfono de tutor'
            const studentPhone = student.phone?.trim().length ? student.phone : 'Sin teléfono'
            const visibleGroup = formatGroupLabelWithoutCareer(student.groupLabel, student.semesterLevel)
            const careerCode = getCareerCodeFromGroupLabel(student.groupLabel) ?? 'Sin carrera'

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
                  <td className="student-enrollment-cell">
                    <strong>{formatPreferredEnrollment(student)}</strong>
                  </td>
                  <td>{student.fullName}</td>
                  <td>{guardianName}</td>
                  <td>{student.semesterLevel}°</td>
                  <td>{visibleGroup}</td>
                  <td>{careerCode}</td>
                  <td>
                    <span className={combinedStudentStatusClassName(student)}>{combinedStudentStatusLabel(student)}</span>
                  </td>
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
                      Revisar
                    </button>
                  </td>
                </tr>
                {expanded ? (
                  <tr className="student-detail-row">
                    <td colSpan={8}>
                      <div className="student-detail-grid">
                        <div>
                          <span className="detail-label">Documentación</span>
                          <strong><span className={documentationClassName(student.documentationStatus)}>{student.documentationStatus}</span></strong>
                        </div>
                        <div>
                          <span className="detail-label">Inscripción</span>
                          <strong><span className={enrollmentClassName(student.statusLabel)}>{student.statusLabel}</span></strong>
                        </div>
                        <div>
                          <span className="detail-label">CURP</span>
                          <strong>{student.curp}</strong>
                        </div>
                        <div>
                          <span className="detail-label">Teléfono alumno</span>
                          <strong>{studentPhone}</strong>
                        </div>
                        <div>
                          <span className="detail-label">Teléfono tutor</span>
                          <strong>{guardianPhone}</strong>
                        </div>
                        <div className="student-detail-wide">
                          <span className="detail-label">Domicilio</span>
                          <strong>{student.address ?? 'Sin domicilio'}</strong>
                        </div>
                        <div>
                          <span className="detail-label">Ciclo / periodo</span>
                          <strong>{student.schoolCycle}/{student.schoolPeriod}</strong>
                        </div>
                       
                        <div>
                          <span className="detail-label">Asesor</span>
                          <strong>{student.groupAdvisorName ?? 'Pendiente'}</strong>
                        </div>
                        <div>
                          <span className="detail-label">Permiso activo</span>
                          <strong>{student.activePermissionSummary ?? 'Sin permiso activo'}</strong>
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
  )
}
