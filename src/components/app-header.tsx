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
  const lastSyncLabel = syncStatus.lastSuccessfulSyncAt
    ? new Date(syncStatus.lastSuccessfulSyncAt).toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '--:--'

  return (
    <header className="screen-header-bar single-line-header">
      <div className="compact-brand-block">
        <div className="app-brand-mark" aria-hidden="true">
          44
        </div>
        <div className="screen-header-copy">
          <h1 className="screen-header-title">CBTA 44 Sistema</h1>
        </div>
      </div>

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

      <div className="header-right-group">
        <span className={isOnline ? 'status-tag success' : 'status-tag warning'}>{isOnline ? 'Online' : 'Offline'}</span>
        <span className="context-chip">Sync {syncStatus.pendingTotal}</span>
        <span className="context-chip">{lastSyncLabel}</span>
        <button className="secondary-button small-button" disabled={syncing} onClick={onSyncNow} type="button">
          {syncing ? 'Sync...' : 'Sync'}
        </button>

        <div className="app-header-session-compact">
          <div className="app-header-avatar">{authSession.displayName.slice(0, 2).toUpperCase()}</div>
          <div className="app-header-session-copy">
            <strong>{authSession.role}</strong>
            <span>{authSession.displayName}</span>
          </div>
          <button className="secondary-button small-button" onClick={onLogout} type="button">
            Cerrar sesión
          </button>
        </div>
      </div>
    </header>
  )
}
