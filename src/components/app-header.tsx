import type { AuthSession } from '@/types/domain'
import type { SyncStatusSnapshot } from '@/lib/sync-service'

type RoleNavigationItem = {
  screen: 'control-escolar' | 'ingresos-propios' | 'secretaria' | 'configuracion'
  label: string
}

type AppHeaderProps = {
  authSession: AuthSession
  screen: 'control-escolar' | 'ingresos-propios' | 'secretaria' | 'configuracion'
  roleNavigationItems: RoleNavigationItem[]
  setScreen: (screen: 'control-escolar' | 'ingresos-propios' | 'secretaria' | 'configuracion') => void
  isOnline: boolean
  syncStatus: SyncStatusSnapshot
  syncing: boolean
  onSyncNow: () => void
  onLogout: () => void
}

export function AppHeader({
  authSession,
  screen,
  roleNavigationItems,
  setScreen,
  isOnline,
  syncStatus,
  syncing,
  onSyncNow,
  onLogout,
}: AppHeaderProps) {
  return (
    <header className="screen-header-bar">
      <div className="screen-header-top">
        <div className="screen-header-main compact-brand-block">
          <div className="app-brand-mark" aria-hidden="true">44</div>
          <div className="screen-header-copy">
            <p className="screen-header-kicker">CBTA 44 Sistema</p>
            <h1 className="screen-header-title">Sistema escolar</h1>
            <p className="screen-header-subtitle">Control Escolar, Ingresos Propios y Secretaría en una misma operación.</p>
          </div>
        </div>

        <div className="screen-header-side">
          <div className="app-header-session">
            <div className="app-header-avatar">
              {authSession.displayName.slice(0, 2).toUpperCase()}
            </div>
            <div className="app-header-session-copy">
              <strong>{authSession.role}</strong>
              <span>{authSession.displayName}</span>
            </div>
            <button className="secondary-button small-button" onClick={onLogout} type="button">
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>

      <div className="screen-header-bottom">
        <div className="screen-header-bottom-main">
          <nav className="role-navigation" aria-label="Navegación principal">
            {roleNavigationItems.map((item) => (
              <button
                key={item.screen}
                className={screen === item.screen ? 'role-navigation-item active' : 'role-navigation-item'}
                onClick={() => setScreen(item.screen)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="screen-header-utility">
          <span className={isOnline ? 'status-tag success' : 'status-tag warning'}>{isOnline ? 'Online' : 'Offline'}</span>
          <span className="context-chip">Sync pendientes {syncStatus.pendingTotal}</span>
          <span className="context-chip">Sincronizado {syncStatus.lastSuccessfulSyncAt ? new Date(syncStatus.lastSuccessfulSyncAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : 'pendiente'}</span>
          <div className="screen-header-actions">
            <button className="secondary-button small-button" disabled={syncing} onClick={onSyncNow} type="button">
              {syncing ? 'Sincronizando...' : 'Sincronizar'}
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
