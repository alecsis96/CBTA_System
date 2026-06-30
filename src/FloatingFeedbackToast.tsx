import { FloatingFeedbackToastProps } from './App';
import { extractOutputFileNameFromFeedback, normalizeFeedbackMessage } from '@/lib/utils';

export function FloatingFeedbackToast({ message, onClose }: FloatingFeedbackToastProps) {
  const isError = /(no se pudo|error|fall[oó])/i.test(message);
  const fileName = extractOutputFileNameFromFeedback(message);
  const title = isError
    ? 'Hay que revisar esta operación'
    : fileName
      ? 'ROC mensual generado correctamente'
      : 'Operación registrada';

  return (
    <article className={isError ? 'feedback-toast feedback-toast-error' : 'feedback-toast'} role="status">
      <div className="feedback-card-header">
        <strong>{title}</strong>
        <div className="feedback-toast-actions">
          <span className={isError ? 'status-tag status-tag-danger' : 'status-tag'}>
            {isError ? 'Error' : 'Listo'}
          </span>
          <button aria-label="Cerrar notificación" className="toast-close-button" onClick={onClose} type="button">
            ×
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
  );
}
