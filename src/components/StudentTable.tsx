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

const propedeuticAreaLabels: Record<string, string> = {
  CS: 'Ciencias sociales',
  'C.S': 'Ciencias sociales',
  CNEyT: 'Ciencias naturales experimentales y tecnologia',
  CNEYT: 'Ciencias naturales experimentales y tecnologia',
  'PM/CNEyT': 'Pensamiento matematico y Ciencias naturales experimentales y tecnologia',
  'PM-CNEYT': 'Pensamiento matematico y Ciencias naturales experimentales y tecnologia',
  'P.M': 'Pensamiento matematico',
  'H/L y C': 'Humanidades, lengua y comunicacion',
  'H.L.Y C.': 'Humanidades, lengua y comunicacion',
}

function academicTrackLabel(student: Pick<StudentSummary, 'semesterLevel' | 'groupLabel' | 'propedeuticArea'>) {
  if (student.semesterLevel === 1) return 'Sin carrera'
  if (student.semesterLevel === 5) return student.propedeuticArea ? propedeuticAreaLabels[student.propedeuticArea] ?? student.propedeuticArea : 'Sin area'
  return getCareerCodeFromGroupLabel(student.groupLabel) ?? 'Sin carrera'
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
            const documentationPending = student.documentationStatus !== 'COMPLETA'
            const guardianName = hasGuardian ? student.guardianFullName : 'Sin tutor capturado'
            const studentPhone = hasStudentPhone ? student.phone : 'Sin telefono'
            const visibleGroup = formatGroupLabelWithoutCareer(student.groupLabel, student.semesterLevel)
            const academicTrack = academicTrackLabel(student)
            const criticalBadges = [
              documentationPending ? 'Documentos pendientes' : null,
              !hasAdvisor ? 'Sin asesor' : null,
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
                  <td>{academicTrack}</td>
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
                  </td>
                </tr>
                {expanded ? (
                  <tr className="student-detail-row">
                    <td colSpan={8}>
                      <div className="student-detail-panel">
                        <div className="student-detail-status-row">
                          {criticalBadges.map((badge) => (
                            <span className="status-tag warning" key={badge}>{badge}</span>
                          ))}
                        </div>

                        <div className="student-detail-summary">
                          <p>
                            <strong>CURP:</strong> {student.curp} · <strong>Asesor:</strong> {student.groupAdvisorName ?? 'Pendiente'}
                          </p>
                          <p>
                            <strong>Tutor:</strong> {guardianName} · <strong>Alumno:</strong> {studentPhone} · <strong>Domicilio:</strong> {student.address ?? 'Sin domicilio'}
                          </p>
                        </div>

                        <div className="student-detail-actions">
                          <button className="secondary-button mini-button" onClick={() => void handleStartEditStudent(student.id)} type="button">Editar alumno</button>
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
