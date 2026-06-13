import { PanelSectionTitle, SurfaceCard } from '@/components/dashboard-kit'
import type { StudentFormInput } from '@/types/domain'

type ControlEscolarToolbarProps = {
  operationsTab: 'captura' | 'bandeja' | 'grupos' | 'inscripcion' | 'alumnos'
  setOperationsTab: (value: 'captura' | 'bandeja' | 'grupos' | 'inscripcion' | 'alumnos') => void
  setCaptureTab: (value: 'fichas' | 'formulario') => void
  toolbarSearchPlaceholder: string
  toolbarSearchValue: string
  handleToolbarSearchChange: (value: string) => void
  showFilters: boolean
  setShowFilters: (value: boolean | ((current: boolean) => boolean)) => void
  activeFilterCount: number
  form: StudentFormInput
  onUpdateField: <K extends keyof StudentFormInput>(field: K, value: StudentFormInput[K]) => void
  semesterFilter: 'all' | '1' | '3' | '5'
  setSemesterFilter: (value: 'all' | '1' | '3' | '5') => void
  statusFilter: string
  setStatusFilter: (value: string) => void
  documentationFilter: string
  setDocumentationFilter: (value: string) => void
  uniqueDocumentationStatuses: string[]
}

export function ControlEscolarToolbar({
  operationsTab,
  setOperationsTab,
  setCaptureTab,
  toolbarSearchPlaceholder,
  toolbarSearchValue,
  handleToolbarSearchChange,
  showFilters,
  setShowFilters,
  activeFilterCount,
  form,
  onUpdateField,
  semesterFilter,
  setSemesterFilter,
  statusFilter,
  setStatusFilter,
  documentationFilter,
  setDocumentationFilter,
  uniqueDocumentationStatuses,
}: ControlEscolarToolbarProps) {
  return (
    <SurfaceCard className="dashboard-search-panel control-toolbar-panel">
      <PanelSectionTitle
        eyebrow="Exploración"
        title="Buscar alumno"
        subtitle="Usa la búsqueda principal y los filtros para entrar directo al padrón, admisión, inscripción o movimientos."
        action={
          <div className="dashboard-inline-actions">
            <button
              className="primary-button small-button"
              onClick={() => {
                setOperationsTab('captura')
                setCaptureTab('formulario')
              }}
              type="button"
            >
              Agregar alumno
            </button>
            <button
              className="secondary-button small-button"
              onClick={() => {
                setOperationsTab('captura')
                setCaptureTab('fichas')
              }}
              type="button"
            >
              Importar padrón
            </button>
          </div>
        }
      />
      <div className="control-inline-toolbar">
        <div className="segmented-tabs control-toolbar-tabs">
          <button
            className={operationsTab === 'alumnos' ? 'segmented-tab active' : 'segmented-tab'}
            onClick={() => setOperationsTab('alumnos')}
            type="button"
          >
            Padrón
          </button>
          <button
            className={operationsTab === 'captura' ? 'segmented-tab active' : 'segmented-tab'}
            onClick={() => setOperationsTab('captura')}
            type="button"
          >
            Admisión
          </button>
          <button
            className={operationsTab === 'inscripcion' ? 'segmented-tab active' : 'segmented-tab'}
            onClick={() => setOperationsTab('inscripcion')}
            type="button"
          >
            Inscripción
          </button>
          <button
            className={operationsTab === 'grupos' ? 'segmented-tab active' : 'segmented-tab'}
            onClick={() => setOperationsTab('grupos')}
            type="button"
          >
            Movimientos académicos
          </button>
          {operationsTab === 'bandeja' ? (
            <button
              className="segmented-tab active"
              onClick={() => setOperationsTab('bandeja')}
              type="button"
            >
              Bandeja SEP
            </button>
          ) : null}
        </div>

        <div className="control-toolbar-lower">
          <label className="control-toolbar-search search-shell">
            <span className="search-icon" aria-hidden="true"></span>
            <input
              aria-label="Buscar alumno"
              disabled={operationsTab === 'bandeja' || operationsTab === 'grupos'}
              placeholder={toolbarSearchPlaceholder}
              value={toolbarSearchValue}
              onChange={(event) => handleToolbarSearchChange(event.target.value)}
            />
            <span className="search-shortcut-chip">Ctrl + K</span>
          </label>

          <div className="control-filters-panel compact-filter-panel">
            <button className="secondary-button small-button filter-toggle-button" onClick={() => setShowFilters((current) => !current)} type="button">
              Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
            {showFilters ? (
              <div className="control-toolbar-filters filter-popover">
                <label className="control-inline-field control-cycle-field">
                  <span>Ciclo</span>
                  <input
                    onChange={(event) => onUpdateField('schoolCycle', event.target.value)}
                    value={form.schoolCycle}
                  />
                </label>
                <label className="control-inline-field">
                  <span>Semestre</span>
                  <select
                    className="group-select"
                    disabled={operationsTab === 'captura' || operationsTab === 'grupos' || operationsTab === 'bandeja'}
                    value={semesterFilter}
                    onChange={(event) => setSemesterFilter(event.target.value as 'all' | '1' | '3' | '5')}
                  >
                    <option value="all">Todos</option>
                    <option value="1">1°</option>
                    <option value="3">3°</option>
                    <option value="5">5°</option>
                  </select>
                </label>
                <label className="control-inline-field">
                  <span>Estatus</span>
                  <select
                    className="group-select"
                    disabled={operationsTab === 'captura' || operationsTab === 'grupos' || operationsTab === 'bandeja'}
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value="all">Todos</option>
                    <option value="Ficha entregada">Ficha entregada</option>
                    <option value="Inscrito">Inscrito</option>
                    <option value="Baja temporal">Baja temporal</option>
                    <option value="Baja definitiva">Baja definitiva</option>
                    <option value="Portabilidad">Portabilidad</option>
                    <option value="Recursador">Recursador</option>
                  </select>
                </label>
                <label className="control-inline-field">
                  <span>Documentación</span>
                  <select
                    className="group-select"
                    disabled={operationsTab === 'captura' || operationsTab === 'grupos' || operationsTab === 'bandeja'}
                    value={documentationFilter}
                    onChange={(event) => setDocumentationFilter(event.target.value)}
                  >
                    <option value="all">Todas</option>
                    {uniqueDocumentationStatuses.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </SurfaceCard>
  )
}
