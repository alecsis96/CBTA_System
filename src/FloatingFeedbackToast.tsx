import type { FloatingFeedbackToastProps } from './App'
import { extractOutputFileNameFromFeedback, normalizeFeedbackMessage } from '@/lib/utils'

function inferFeedbackTone(message: string, tone?: FloatingFeedbackToastProps['tone']) {
  if (tone) return tone
  if (/(no se pudo|error|fall[oó]|invalid|inválid|400:|500:)/i.test(message)) return 'error'
  if (/(revisa|pendiente|faltan|advertencia|aun no|aún no)/i.test(message)) return 'warning'
  if (/(cancelad|leyendo|importando|abierto|selecciona primero)/i.test(message)) return 'info'
  return 'success'
}

export function FloatingFeedbackToast({ message, tone, onClose }: FloatingFeedbackToastProps) {
  const feedbackTone = inferFeedbackTone(message, tone)
  const fileName = extractOutputFileNameFromFeedback(message)
  const title = feedbackTone === 'error'
    ? 'Hay que revisar esta operacion'
    : feedbackTone === 'warning'
      ? 'Atencion requerida'
      : feedbackTone === 'info'
        ? 'Aviso'
        : fileName
          ? 'ROC mensual generado correctamente'
          : 'Operacion registrada'
  const tagLabel = feedbackTone === 'error' ? 'Error' : feedbackTone === 'warning' ? 'Aviso' : feedbackTone === 'info' ? 'Info' : 'Listo'

  return (
    <article className={`feedback-toast feedback-toast-${feedbackTone}`} role={feedbackTone === 'error' ? 'alert' : 'status'}>
      <div className="feedback-card-header">
        <strong>{title}</strong>
        <div className="feedback-toast-actions">
          <span className={`status-tag feedback-status-${feedbackTone}`}>{tagLabel}</span>
          <button aria-label="Cerrar notificacion" className="toast-close-button" onClick={onClose} type="button">
            x
          </button>
        </div>
      </div>
      <p>{normalizeFeedbackMessage(message)}</p>
      {fileName ? (
        <div className="feedback-file-chip">
          <span>Archivo abierto:</span>
          <strong>{fileName}</strong>
        </div>
      ) : null}
    </article>
  )
}
