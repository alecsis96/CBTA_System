import { Fragment } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { StudentSummary } from '@/types/domain'

type StudentTableProps = {
  paginatedStudents: StudentSummary[]
  editingStudentId: string | null
  expandedStudentId: string | null
  setExpandedStudentId: Dispatch<SetStateAction<string | null>>
  handleStartEditStudent: (studentId: string) => Promise<void>
  formatPreferredEnrollment: (student: StudentSummary) => string
  formatVisibleGroupLabel: (groupLabel: string | null) => string
  dailyStatusClassName: (status: StudentSummary['dailyStatus']) => string
}

export function StudentTable({
  paginatedStudents,
  editingStudentId,
  expandedStudentId,
  setExpandedStudentId,
  handleStartEditStudent,
  formatPreferredEnrollment,
  formatVisibleGroupLabel,
  dailyStatusClassName,
}: StudentTableProps) {
  return (
    <div className="student-table-wrap">
      <table className="student-table control-directory-table">
        <thead>
          <tr>
            <th>Matrícula</th>
            <th>Alumno</th>
            <th>Tutor</th>
            <th>Tel. tutor</th>
            <th>Semestre</th>
            <th>Grupo</th>
            <th>Estatus hoy</th>
            <th>Documentación</th>
            <th>Estatus</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {paginatedStudents.map((student) => {
            const active = editingStudentId === student.id
            const expanded = expandedStudentId === student.id
            const guardianName = student.guardianFullName?.trim().length ? student.guardianFullName : 'Sin tutor capturado'
            const guardianPhone = student.guardianPhone?.trim().length ? student.guardianPhone : 'Sin teléfono de tutor'
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
                    <strong>{formatPreferredEnrollment(student)}</strong>
                  </td>
                  <td>{student.fullName}</td>
                  <td>{guardianName}</td>
                  <td>{guardianPhone}</td>
                  <td>{student.semesterLevel}°</td>
                  <td>{formatVisibleGroupLabel(student.groupLabel)}</td>
                  <td>
                    <span className={dailyStatusClassName(student.dailyStatus)}>{student.dailyStatusLabel}</span>
                  </td>
                  <td>{student.documentationStatus}</td>
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
                      editar
                    </button>
                  </td>
                </tr>
                {expanded ? (
                  <tr className="student-detail-row">
                    <td colSpan={10}>
                      <div className="student-detail-grid">
                        <div>
                          <span className="detail-label">CURP</span>
                          <strong>{student.curp}</strong>
                        </div>
                        <div>
                          <span className="detail-label">Turno</span>
                          <strong>{student.shiftLabel ?? 'Sin turno'}</strong>
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