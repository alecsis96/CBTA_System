import { PanelSectionTitle, SurfaceCard } from '@/components/dashboard-kit'
import { SearchInput } from '@/components/ui/SearchInput'
import type { StudentFormInput } from '@/types/domain'

type SemesterFilter = 'all' | '1' | '2' | '3' | '4' | '5' | '6'
type OperationsTab = 'captura' | 'bandeja' | 'grupos' | 'estadisticas' | 'inscripcion' | 'alumnos'

type ControlEscolarToolbarProps = {
  operationsTab: OperationsTab
  setOperationsTab: (value: OperationsTab) => void
  setCaptureTab: (value: 'fichas' | 'formulario') => void
  toolbarSearchPlaceholder: string
  toolbarSearchValue: string
  handleToolbarSearchChange: (value: string) => void
  showFilters: boolean
  setShowFilters: (value: boolean | ((current: boolean) => boolean)) => void
  activeFilterCount: number
  form: StudentFormInput
  onUpdateField: <K extends keyof StudentFormInput>(field: K, value: StudentFormInput[K]) => void
  semesterFilter: SemesterFilter
  setSemesterFilter: (value: SemesterFilter) => void
  statusFilter: string
  setStatusFilter: (value: string) => void
  documentationFilter: string
  setDocumentationFilter: (value: string) => void
  uniqueDocumentationStatuses: string[]
  isImportingEnrollmentRoster: boolean
  onImportEnrollmentRoster: () => void
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
  isImportingEnrollmentRoster,
  onImportEnrollmentRoster,
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
              disabled={isImportingEnrollmentRoster}
              onClick={onImportEnrollmentRoster}
              type="button"
            >
              {isImportingEnrollmentRoster ? 'Importando...' : 'Importar padrón'}
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
          <button
            className={operationsTab === 'estadisticas' ? 'segmented-tab active' : 'segmented-tab'}
            onClick={() => setOperationsTab('estadisticas')}
            type="button"
          >
            Estadisticas
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
          <SearchInput
            aria-label="Buscar alumno"
            disabled={operationsTab === 'bandeja' || operationsTab === 'grupos' || operationsTab === 'estadisticas'}
            placeholder={toolbarSearchPlaceholder}
            value={toolbarSearchValue}
            onChange={handleToolbarSearchChange}
            showShortcut
          />

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
                    disabled={operationsTab === 'captura' || operationsTab === 'grupos' || operationsTab === 'estadisticas' || operationsTab === 'bandeja'}
                    value={semesterFilter}
                    onChange={(event) => setSemesterFilter(event.target.value as SemesterFilter)}
                  >
                    <option value="all">Todos</option>
                    <option value="1">1ro</option>
                    <option value="2">2do</option>
                    <option value="3">3ro</option>
                    <option value="4">4to</option>
                    <option value="5">5to</option>
                    <option value="6">6to</option>
                  </select>
                </label>
                <label className="control-inline-field">
                  <span>Inscripción</span>
                  <select
                    className="group-select"
                    disabled={operationsTab === 'captura' || operationsTab === 'grupos' || operationsTab === 'estadisticas' || operationsTab === 'bandeja'}
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value="all">Todos</option>
                    <option value="Ficha entregada">Ficha entregada</option>
                    <option value="Inscrito">Inscrito</option>
                    <option value="Asignado a grupo">Asignado a grupo</option>
                    <option value="Baja">Baja</option>
                    <option value="Baja temporal">Baja temporal</option>
                    <option value="Baja definitiva">Baja definitiva</option>
                    <option value="No presentado">No presentado</option>
                    <option value="Portabilidad">Portabilidad</option>
                    <option value="Recursador">Recursador</option>
                  </select>
                </label>
                <label className="control-inline-field">
                  <span>Documentación</span>
                  <select
                    className="group-select"
                    disabled={operationsTab === 'captura' || operationsTab === 'grupos' || operationsTab === 'estadisticas' || operationsTab === 'bandeja'}
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
