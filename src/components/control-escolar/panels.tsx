import { useState } from 'react'
import type { AdmissionSummary, PreRegistrationSummary } from '@/types/domain'

export type PreRegistrationStatusUpdate =
  | 'EN_REVISION_CONTROL_ESCOLAR'
  | 'OBSERVADO'
  | 'RECHAZADO'
  | 'VALIDADO_PARA_PAGO'
  | 'PAGADO'

type CaptureModeTabsProps = {
  active: 'fichas' | 'formulario'
  onChange: (value: 'fichas' | 'formulario') => void
}

export function CaptureModeTabs({ active, onChange }: CaptureModeTabsProps) {
  return (
    <section className="panel compact">
      <div className="button-row">
        <button
          className={active === 'fichas' ? 'primary-button small-button' : 'secondary-button small-button'}
          onClick={() => onChange('fichas')}
          type="button"
        >
          Captura de fichas
        </button>
        <button
          className={active === 'formulario' ? 'primary-button small-button' : 'secondary-button small-button'}
          onClick={() => onChange('formulario')}
          type="button"
        >
          Formulario de captura
        </button>
      </div>
    </section>
  )
}

type AdmissionCaptureTableProps = {
  admissions: AdmissionSummary[]
  activeAdmissionId: string | null
  onSelect: (admission: AdmissionSummary) => Promise<void>
}

export function AdmissionCaptureTable({ admissions, activeAdmissionId, onSelect }: AdmissionCaptureTableProps) {
  return (
    <div className="student-table-wrap">
      <table className="student-table">
        <thead>
          <tr>
            <th>Folio</th>
            <th>Nombre</th>
            <th>CURP</th>
            <th>Estatus</th>
            <th>Accion</th>
          </tr>
        </thead>
        <tbody>
          {admissions.slice(0, 12).map((item) => {
            const isActive = activeAdmissionId === item.id
            return (
              <tr
                className={isActive ? 'student-row active' : 'student-row'}
                key={item.id}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    void onSelect(item)
                  }
                }}
                onClick={() => void onSelect(item)}
                role="button"
                tabIndex={0}
              >
                <td>{item.folio}</td>
                <td>{item.fullName}</td>
                <td>{item.curp}</td>
                <td>{item.status}</td>
                <td>
                  <button className="secondary-button small-button" onClick={() => void onSelect(item)} type="button">
                    Seleccionar
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type PreRegistrationInboxPanelProps = {
  preRegistrations: PreRegistrationSummary[]
  selectedPreRegistration: PreRegistrationSummary | null
  onSelectPreRegistration: (id: string) => void
  onUpdateStatus: (preRegistrationId: string, status: PreRegistrationStatusUpdate) => Promise<void>
  onExportSep: () => Promise<void>
}

export function PreRegistrationInboxPanel({
  preRegistrations,
  selectedPreRegistration,
  onSelectPreRegistration,
  onUpdateStatus,
  onExportSep,
}: PreRegistrationInboxPanelProps) {
  const [folioFilter, setFolioFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const normalizedFolio = folioFilter.trim().toLowerCase()
  const filteredPreRegistrations = preRegistrations.filter((item) => {
    const matchesFolio = normalizedFolio.length === 0 || item.folio.toLowerCase().includes(normalizedFolio)
    const matchesStatus = statusFilter === 'all' || item.status === statusFilter
    return matchesFolio && matchesStatus
  })

  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Control Escolar</p>
          <h2>Bandeja de pre-registro</h2>
        </div>
        <div className="table-actions">
          <span className="status-tag">{filteredPreRegistrations.length} folios</span>
          <button className="secondary-button small-button" onClick={() => void onExportSep()} type="button">
            Exportar SEP CSV
          </button>
        </div>
      </div>
      {preRegistrations.length > 0 ? (
        <div className="student-search-row">
          <label className="form-field span-2">
            <span>Filtro por folio</span>
            <input placeholder="Buscar por folio" value={folioFilter} onChange={(event) => setFolioFilter(event.target.value)} />
          </label>
          <label className="form-field">
            <span>Filtro por estatus</span>
            <select className="group-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Todos</option>
              <option value="PRE_REGISTRO_ENVIADO">Pre-registro enviado</option>
              <option value="EN_REVISION_CONTROL_ESCOLAR">En revision</option>
              <option value="OBSERVADO">Observado</option>
              <option value="RECHAZADO">Rechazado</option>
              <option value="VALIDADO_PARA_PAGO">Validado para pago</option>
              <option value="PAGADO">Pagado</option>
            </select>
          </label>
        </div>
      ) : null}
      {preRegistrations.length === 0 ? <p className="empty-state">Todavia no hay pre-registros recibidos.</p> : null}
      {filteredPreRegistrations.length > 0 ? (
        <div className="student-table-wrap">
          <table className="student-table">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Alumno</th>
                <th>CURP</th>
                <th>Estatus</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredPreRegistrations.map((item) => (
                <tr key={item.id}>
                  <td>{item.folio}</td>
                  <td>{item.fullName}</td>
                  <td>{item.curp}</td>
                  <td>{item.status}</td>
                  <td>
                    <div className="table-actions">
                      <button className="secondary-button small-button" onClick={() => onSelectPreRegistration(item.id)} type="button">
                        Voucher
                      </button>
                      <button
                        className="secondary-button small-button"
                        onClick={() => void onUpdateStatus(item.id, 'EN_REVISION_CONTROL_ESCOLAR')}
                        type="button"
                      >
                        Revisar
                      </button>
                      <button className="secondary-button small-button" onClick={() => void onUpdateStatus(item.id, 'OBSERVADO')} type="button">
                        Observar
                      </button>
                      <button className="primary-button small-button" onClick={() => void onUpdateStatus(item.id, 'VALIDADO_PARA_PAGO')} type="button">
                        Aprobar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {preRegistrations.length > 0 && filteredPreRegistrations.length === 0 ? (
        <p className="empty-state">No hay pre-registros que coincidan con los filtros.</p>
      ) : null}

      {selectedPreRegistration ? (
        <article className="receipt-preview" id="pre-registration-voucher">
          <div className="section-header">
            <h3>Voucher de pre-registro</h3>
            <button className="secondary-button small-button" onClick={() => window.print()} type="button">
              Imprimir voucher
            </button>
          </div>
          <p><strong>Folio:</strong> {selectedPreRegistration.folio}</p>
          <p><strong>Alumno:</strong> {selectedPreRegistration.fullName}</p>
          <p><strong>CURP:</strong> {selectedPreRegistration.curp}</p>
          <p><strong>Fecha envio:</strong> {new Date(selectedPreRegistration.submittedAt).toLocaleString('es-MX')}</p>
          <p><strong>Estatus:</strong> {selectedPreRegistration.status}</p>
          <p>Presentar este voucher en Control Escolar para continuar el proceso.</p>
        </article>
      ) : null}
    </section>
  )
}
