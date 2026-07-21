import { PanelSectionTitle, SurfaceCard } from '@/components/dashboard-kit'
import { SearchInput } from '@/components/ui/SearchInput'
import type { StudentFormInput } from '@/types/domain'

type SemesterFilter = 'all' | '1' | '2' | '3' | '4' | '5' | '6'
type OperationsTab = 'captura' | 'bandeja' | 'grupos' | 'estadisticas' | 'inscripcion' | 'alumnos' | 'errores'

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
  quickOperationalFilter: string
  setQuickOperationalFilter: (value: string) => void
  quickFilterOptions: Array<{ value: string; label: string; count: number }>
  groupFilter: string
  setGroupFilter: (value: string) => void
  groupFilterOptions: Array<{ value: string; count: number }>
  careerFilter: string
  setCareerFilter: (value: string) => void
  careerFilterOptions: Array<{ value: string; count: number }>
  cycleFilter: string
  setCycleFilter: (value: string) => void
  cycleFilterOptions: Array<{ value: string; count: number }>
  hasToolbarFilters: boolean
  onClearToolbarFilters: () => void
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
  isImportingStudentData: boolean
  onCompleteFichaData: () => void
  onImportPropedeuticAreas: () => void
  importIssueCount?: number
  isEnrollmentAux?: boolean
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
  quickOperationalFilter,
  setQuickOperationalFilter,
  quickFilterOptions,
  groupFilter,
  setGroupFilter,
  groupFilterOptions,
  careerFilter,
  setCareerFilter,
  careerFilterOptions,
  cycleFilter,
  setCycleFilter,
  cycleFilterOptions,
  hasToolbarFilters,
  onClearToolbarFilters,
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
  isImportingStudentData,
  onCompleteFichaData,
  onImportPropedeuticAreas,
  importIssueCount = 0,
  isEnrollmentAux = false,
}: ControlEscolarToolbarProps) {
  const visibleQuickFilters = new Set(['all', 'docs-pending', 'with-ficha', 'pending-inscription', 'without-group'])
  const compactQuickFilterOptions = quickFilterOptions.filter((item) => visibleQuickFilters.has(item.value))
  const advancedQuickFilterOptions = quickFilterOptions.filter((item) => !visibleQuickFilters.has(item.value))
  const searchDisabled = operationsTab === 'bandeja' || operationsTab === 'grupos' || operationsTab === 'estadisticas' || operationsTab === 'errores'
  const academicFiltersDisabled = operationsTab === 'captura' || operationsTab === 'grupos' || operationsTab === 'estadisticas' || operationsTab === 'bandeja' || operationsTab === 'errores'

  return (
    <SurfaceCard className="dashboard-search-panel control-toolbar-panel">
      <PanelSectionTitle
        eyebrow="Exploracion"
        title="Buscar alumno"
        action={isEnrollmentAux ? undefined :
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
              disabled={isImportingEnrollmentRoster || isImportingStudentData}
              onClick={onImportEnrollmentRoster}
              type="button"
            >
              {isImportingEnrollmentRoster ? 'Importando...' : 'Importar padron'}
            </button>
            <button
              className="secondary-button small-button"
              disabled={isImportingEnrollmentRoster || isImportingStudentData}
              onClick={onCompleteFichaData}
              type="button"
            >
              Completar fichas
            </button>
            <button
              className="secondary-button small-button"
              disabled={isImportingEnrollmentRoster || isImportingStudentData}
              onClick={onImportPropedeuticAreas}
              type="button"
            >
              Areas 5to
            </button>
          </div>
        }
      />

      <div className="control-inline-toolbar">
        <div className="segmented-tabs control-toolbar-tabs">
          {!isEnrollmentAux ? <button className={operationsTab === 'alumnos' ? 'segmented-tab active' : 'segmented-tab'} onClick={() => setOperationsTab('alumnos')} type="button">Padron</button> : null}
          {!isEnrollmentAux ? <button className={operationsTab === 'captura' ? 'segmented-tab active' : 'segmented-tab'} onClick={() => setOperationsTab('captura')} type="button">Admision</button> : null}
          <button className={operationsTab === 'inscripcion' ? 'segmented-tab active' : 'segmented-tab'} onClick={() => setOperationsTab('inscripcion')} type="button">Inscripcion</button>
          {!isEnrollmentAux ? <button className={operationsTab === 'errores' ? 'segmented-tab active' : 'segmented-tab'} onClick={() => setOperationsTab('errores')} type="button">Datos con error{importIssueCount > 0 ? ` (${importIssueCount})` : ''}</button> : null}
          {!isEnrollmentAux ? <button className={operationsTab === 'grupos' ? 'segmented-tab active' : 'segmented-tab'} onClick={() => setOperationsTab('grupos')} type="button">Movimientos academicos</button> : null}
          {!isEnrollmentAux ? <button className={operationsTab === 'estadisticas' ? 'segmented-tab active' : 'segmented-tab'} onClick={() => setOperationsTab('estadisticas')} type="button">Estadisticas</button> : null}
          {!isEnrollmentAux && operationsTab === 'bandeja' ? (
            <button className="segmented-tab active" onClick={() => setOperationsTab('bandeja')} type="button">Bandeja SEP</button>
          ) : null}
        </div>

        <div className="control-toolbar-lower">
          <SearchInput
            aria-label="Buscar alumno"
            disabled={searchDisabled}
            placeholder={toolbarSearchPlaceholder}
            value={toolbarSearchValue}
            onChange={handleToolbarSearchChange}
            showShortcut
          />

          <div className="control-filters-panel compact-filter-panel">
            <button className="secondary-button small-button filter-toggle-button" onClick={() => setShowFilters((current) => !current)} type="button">
              {showFilters ? 'Ocultar filtros' : 'Filtros'}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
          </div>
        </div>

        {showFilters ? (
          <div className="control-toolbar-filters filter-popover">
            <div className="filter-popover-header">
              <strong>Filtros avanzados</strong>
              <span>{activeFilterCount} activos</span>
            </div>

            <label className="control-inline-field">
              <span>Grado / semestre</span>
              <select className="group-select" disabled={academicFiltersDisabled} value={semesterFilter} onChange={(event) => setSemesterFilter(event.target.value as SemesterFilter)}>
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
              <span>Grupo</span>
              <select className="group-select" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
                <option value="all">Todos</option>
                {groupFilterOptions.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}
              </select>
            </label>
            <label className="control-inline-field">
              <span>Carrera</span>
              <select className="group-select" value={careerFilter} onChange={(event) => setCareerFilter(event.target.value)}>
                <option value="all">Todas</option>
                {careerFilterOptions.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}
              </select>
            </label>
            <label className="control-inline-field">
              <span>Ciclo</span>
              <select className="group-select" value={cycleFilter} onChange={(event) => setCycleFilter(event.target.value)}>
                <option value="all">Todos</option>
                {cycleFilterOptions.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}
              </select>
            </label>
            <label className="control-inline-field">
              <span>Inscripcion</span>
              <select className="group-select" disabled={academicFiltersDisabled} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
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
              <span>Documentacion</span>
              <select className="group-select" disabled={academicFiltersDisabled} value={documentationFilter} onChange={(event) => setDocumentationFilter(event.target.value)}>
                <option value="all">Todas</option>
                {uniqueDocumentationStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>

            <div className="advanced-operational-filters">
              <span>Operativos</span>
              <div>
                {advancedQuickFilterOptions.map((item) => (
                  <button className={quickOperationalFilter === item.value ? 'quick-filter-chip active' : 'quick-filter-chip'} key={item.value} onClick={() => setQuickOperationalFilter(item.value)} type="button">
                    <span>{item.label}</span>
                    {item.count > 0 ? <strong>{item.count}</strong> : null}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-popover-actions">
              <button className="tertiary-button small-button" disabled={!hasToolbarFilters} onClick={onClearToolbarFilters} type="button">Limpiar filtros</button>
              <button className="primary-button small-button" onClick={() => setShowFilters(false)} type="button">Cerrar filtros</button>
            </div>
          </div>
        ) : null}

        <div className="quick-filter-row" aria-label="Filtros rapidos operativos">
          {compactQuickFilterOptions.map((item) => (
            <button className={quickOperationalFilter === item.value ? 'quick-filter-chip active' : 'quick-filter-chip'} key={item.value} onClick={() => setQuickOperationalFilter(item.value)} type="button">
              <span>{item.label}</span>
              {item.count > 0 ? <strong>{item.count}</strong> : null}
            </button>
          ))}
        </div>
      </div>
    </SurfaceCard>
  )
}
