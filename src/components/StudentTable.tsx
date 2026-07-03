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
  return (
    <div className="student-table-wrap control-directory-wrap">
      <table className="student-table control-directory-table">
        <thead>
          <tr>
            <th>Matricula</th>
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
            const hasGuardian = Boolean(student.guardianFullName?.trim())
            const hasGuardianPhone = Boolean(student.guardianPhone?.trim())
            const hasStudentPhone = Boolean(student.phone?.trim())
            const hasAdvisor = Boolean(student.groupAdvisorName?.trim())
            const hasPermission = Boolean(student.activePermissionSummary?.trim())
            const documentationPending = student.documentationStatus !== 'COMPLETA'
            const guardianName = hasGuardian ? student.guardianFullName : 'Sin tutor capturado'
            const guardianPhone = hasGuardianPhone ? student.guardianPhone : 'Sin telefono de tutor'
            const studentPhone = hasStudentPhone ? student.phone : 'Sin telefono'
            const visibleGroup = formatGroupLabelWithoutCareer(student.groupLabel, student.semesterLevel)
            const careerCode = getCareerCodeFromGroupLabel(student.groupLabel) ?? 'Sin carrera'
            const criticalBadges = [
              documentationPending ? 'Documentos pendientes' : null,
              !hasAdvisor ? 'Sin asesor' : null,
              !hasPermission ? 'Sin permiso activo' : null,
              !hasGuardian ? 'Sin tutor' : null,
              (!hasStudentPhone && !hasGuardianPhone) ? 'Sin telefono' : null,
            ].filter((item): item is string => Boolean(item)).slice(0, 3)

            return (
              <Fragment key={student.id}>
                <tr
                  aria-expanded={expanded}
                  className={expanded ? 'student-row expanded' : active ? 'student-row active' : 'student-row'}
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
                      className="secondary-button mini-button"
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
                    <button
                      className="tertiary-button mini-button"
                      onClick={(event) => {
                        event.stopPropagation()
                        event.preventDefault()
                        setExpandedStudentId(expanded ? null : student.id)
                      }}
                      type="button"
                    >
                      {expanded ? 'Cerrar' : 'Mas'}
                    </button>
                  </td>
                </tr>
                {expanded ? (
                  <tr className="student-detail-row">
                    <td colSpan={8}>
                      <div className="student-detail-panel">
                        <div className="student-detail-status-row">
                          {criticalBadges.map((badge) => (
                            <span className={badge === 'Sin permiso activo' ? 'status-tag' : 'status-tag warning'} key={badge}>{badge}</span>
                          ))}
                        </div>

                        <div className="student-detail-summary">
                          <p>
                            <strong>CURP:</strong> {student.curp} · <strong>Ciclo:</strong> {student.schoolCycle}/{student.schoolPeriod} · <strong>Grupo:</strong> {student.semesterLevel}° {visibleGroup} · <strong>Asesor:</strong> {student.groupAdvisorName ?? 'Pendiente'}
                          </p>
                          <p>
                            <strong>Tutor:</strong> {guardianName} · <strong>Alumno:</strong> {studentPhone} · <strong>Domicilio:</strong> {student.address ?? 'Sin domicilio'} · <strong>Permiso:</strong> {student.activePermissionSummary ?? 'Sin permiso activo'}
                          </p>
                        </div>

                        <div className="student-detail-actions">
                          <button className="secondary-button mini-button" onClick={() => void handleStartEditStudent(student.id)} type="button">Editar alumno</button>
                          <button className="secondary-button mini-button" disabled title="TODO: conectar vista de expediente" type="button">Ver expediente</button>
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
