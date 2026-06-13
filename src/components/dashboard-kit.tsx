import type { ReactNode } from 'react'
import type { AuditLogSummary } from '@/types/domain'

export type DashboardMetric = {
  label: string
  value: string | number
  helper?: string
  tone?: 'default' | 'warning'
}

type ModuleHeroProps = {
  eyebrow: string
  title: string
  subtitle: string
  metrics: DashboardMetric[]
  actions?: ReactNode
}

export function StatusBadge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  const className =
    tone === 'success'
      ? 'status-tag success'
      : tone === 'warning'
        ? 'status-tag warning'
        : tone === 'danger'
          ? 'status-tag danger'
          : 'status-tag'

  return <span className={className}>{children}</span>
}

export function MetricCard({ label, value, helper, tone = 'default' }: DashboardMetric) {
  return (
    <article className={tone === 'warning' ? 'dashboard-metric-card warning' : 'dashboard-metric-card'}>
      <span className="dashboard-metric-label">{label}</span>
      <strong>{value}</strong>
      {helper ? <p>{helper}</p> : null}
    </article>
  )
}

export function ModuleHero({ eyebrow, title, subtitle, metrics, actions }: ModuleHeroProps) {
  return (
    <section className="dashboard-hero-card">
      <div className="dashboard-hero-copy">
        <p className="dashboard-hero-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="dashboard-hero-side">
        {actions ? <div className="dashboard-hero-actions">{actions}</div> : null}
        <div className="dashboard-metric-grid">
          {metrics.map((metric) => (
            <MetricCard key={`${metric.label}-${metric.value}`} {...metric} />
          ))}
        </div>
      </div>
    </section>
  )
}

export function SurfaceCard({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={className ? `panel dashboard-surface ${className}` : 'panel dashboard-surface'}>{children}</section>
}

export function PanelSectionTitle({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="dashboard-section-head">
      <div>
        <p className="dashboard-section-eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action ? <div className="dashboard-section-action">{action}</div> : null}
    </div>
  )
}

export function DashboardEmptyState({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <div className="dashboard-empty-state">
      <div className="dashboard-empty-illustration" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <strong>{title}</strong>
      <p>{description}</p>
      {actions ? <div className="dashboard-empty-actions">{actions}</div> : null}
    </div>
  )
}

export function ActivityPanel({ logs }: { logs: AuditLogSummary[] }) {
  const visibleLogs = logs.slice(0, 5)

  return (
    <SurfaceCard className="dashboard-side-card">
      <PanelSectionTitle eyebrow="Bitácora" title="Actividad reciente" action={<StatusBadge>{logs.length}</StatusBadge>} />
      {visibleLogs.length === 0 ? (
        <DashboardEmptyState
          title="No hay eventos recientes"
          description="A medida que registres acciones, aquí aparecerán los movimientos más nuevos."
        />
      ) : (
        <div className="activity-feed">
          {visibleLogs.map((log) => (
            <article className="activity-feed-item" key={log.id}>
              <strong>{log.action}</strong>
              <p>{log.detail || `${log.entityType} ${log.entityId}`}</p>
              <span>{log.actorName} · {new Date(log.createdAt).toLocaleString('es-MX')}</span>
            </article>
          ))}
        </div>
      )}
    </SurfaceCard>
  )
}

export function QuickActions({
  items,
}: {
  items: Array<{ label: string; helper?: string; onClick: () => void; tone?: 'primary' | 'secondary' }>
}) {
  return (
    <SurfaceCard className="dashboard-side-card">
      <PanelSectionTitle eyebrow="Atajos" title="Accesos rápidos" />
      <div className="dashboard-quick-actions">
        {items.map((item) => (
          <button
            key={item.label}
            className={item.tone === 'primary' ? 'primary-button dashboard-quick-action' : 'secondary-button dashboard-quick-action'}
            onClick={item.onClick}
            type="button"
          >
            <strong>{item.label}</strong>
            {item.helper ? <span>{item.helper}</span> : null}
          </button>
        ))}
      </div>
    </SurfaceCard>
  )
}
