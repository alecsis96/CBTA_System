import type { FormEvent, MutableRefObject, ReactNode } from 'react'
import type { AdmissionSummary, StudentFormInput } from '@/types/domain'

type FieldRendererProps = {
  label: string
  required?: boolean
  className?: string
  children: ReactNode
}

type StudentCaptureFormPanelProps = {
  form: StudentFormInput
  activeAdmission: AdmissionSummary | null
  editingStudentId: string | null
  saving: boolean
  feedback: string | null
  captureSectionRef: MutableRefObject<HTMLElement | null>
  relationshipOptions: string[]
  FieldComponent: (props: FieldRendererProps) => JSX.Element
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onUpdateField: <K extends keyof StudentFormInput>(field: K, value: StudentFormInput[K]) => void
  onCancelEdit: () => void
  onBackToFichas: () => void
}

export function StudentCaptureFormPanel({
  form,
  activeAdmission,
  editingStudentId,
  saving,
  feedback,
  captureSectionRef,
  relationshipOptions,
  FieldComponent,
  onSubmit,
  onUpdateField,
  onCancelEdit,
  onBackToFichas,
}: StudentCaptureFormPanelProps) {
  const Field = FieldComponent

  return (
    <section className="panel" ref={captureSectionRef}>
      <div className="section-header">
        <div>
          <p className="eyebrow">Control Escolar</p>
          <h2>Captura y validacion del alumno</h2>
        </div>
        <div className="button-row">
          <span className="status-tag">{editingStudentId ? 'Edicion activa' : 'Captura real activa'}</span>
          <button className="secondary-button small-button" onClick={onBackToFichas} type="button">
            Regresar a fichas
          </button>
        </div>
      </div>

      {activeAdmission ? (
        <p className="feedback-banner">
          Captura activa para folio {activeAdmission.folio} ({activeAdmission.curp})
        </p>
      ) : (
        <p className="empty-state">Selecciona primero un pago desde la pestana "Captura de fichas".</p>
      )}

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
            <input value={form.sex} onChange={(event) => onUpdateField('sex', event.target.value)} />
          </Field>
          <Field label="Telefono alumno">
            <input inputMode="numeric" type="tel" value={form.phone} onChange={(event) => onUpdateField('phone', event.target.value)} />
          </Field>
          <Field label="Telefono alterno alumno">
            <input type="tel" value={form.studentPhoneSecondary} onChange={(event) => onUpdateField('studentPhoneSecondary', event.target.value)} />
          </Field>
          <Field label="Correo alumno">
            <input type="email" value={form.email} onChange={(event) => onUpdateField('email', event.target.value)} />
          </Field>
          <Field label="Lengua materna">
            <input value={form.motherTongue} onChange={(event) => onUpdateField('motherTongue', event.target.value)} />
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
          <Field label="Salon de examen">
            <input value={form.examRoom} onChange={(event) => onUpdateField('examRoom', event.target.value)} />
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
          <Field label="Telefono alterno tutor">
            <input type="tel" value={form.guardianPhoneSecondary} onChange={(event) => onUpdateField('guardianPhoneSecondary', event.target.value)} />
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
  )
}
