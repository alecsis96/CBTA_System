import { useEffect, useState } from 'react'
import { TariffEditorRowProps } from './App'

export function TariffEditorRow({ concept, isSaving, onSave, onToggleSuggested, canToggleSuggested = true }: TariffEditorRowProps) {
  const [amount, setAmount] = useState(String(concept.amount))
  const [periodLabel, setPeriodLabel] = useState(concept.periodLabel)

  useEffect(() => {
    setAmount(String(concept.amount))
    setPeriodLabel(concept.periodLabel)
  }, [concept.amount, concept.periodLabel])

  return (
    <tr>
      <td>{concept.code}</td>
      <td>
        {concept.name}
        {concept.isLifeInsurance ? (
          <div>
            <small>Seguro de vida</small>
          </div>
        ) : null}
        {concept.excludeFromRoc ? (
          <div>
            <small>No se imprime en ROC</small>
          </div>
        ) : null}
      </td>
      <td>
        <input className="table-input" min="0" step="0.01" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </td>
      <td>
        <input className="table-input" value={periodLabel} onChange={(event) => setPeriodLabel(event.target.value)} />
      </td>
      <td>
        <div className="button-row">
          <button
            className="primary-button small-button"
            disabled={isSaving}
            onClick={() => void onSave(concept.code, Number(amount || 0), periodLabel)}
            type="button"
          >
            {isSaving ? '...' : 'Guardar'}
          </button>
          {canToggleSuggested ? (
            <button
              className={concept.isSuggested ? 'secondary-button small-button' : 'tertiary-button small-button'}
              disabled={isSaving}
              onClick={() => void onToggleSuggested(concept.code, !concept.isSuggested)}
              type="button"
            >
              {concept.isSuggested ? 'Quitar sugerida' : 'Marcar sugerida'}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}
