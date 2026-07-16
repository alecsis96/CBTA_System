import type { UpdateCheckResult } from '@/lib/update-service'

type UpdateNoticeProps = {
  update: UpdateCheckResult
  onDownload: () => void
  onDismiss: () => void
}

export function UpdateNotice({ update, onDownload, onDismiss }: UpdateNoticeProps) {
  if (!update.latest) return null

  return (
    <section className="update-notice" role="status">
      <div>
        <span className="status-tag success">Actualizacion disponible</span>
        <strong>Version {update.latest.version}</strong>
        <p>{update.latest.notes || `Tu version actual es ${update.currentVersion}. Descarga la nueva version para actualizar el sistema.`}</p>
      </div>
      <div className="update-notice-actions">
        <button className="primary-button small-button" disabled={!update.downloadUrl} onClick={onDownload} type="button">
          Descargar
        </button>
        <button className="secondary-button small-button" onClick={onDismiss} type="button">
          Cerrar
        </button>
      </div>
    </section>
  )
}
