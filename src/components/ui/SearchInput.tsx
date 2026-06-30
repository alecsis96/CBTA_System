import { forwardRef, KeyboardEvent } from 'react'

type SearchInputProps = {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  disabled?: boolean
  showShortcut?: boolean
  shortcutText?: string
  'aria-label'?: string
  className?: string
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      value,
      onChange,
      onKeyDown,
      placeholder = 'Buscar...',
      disabled = false,
      showShortcut = false,
      shortcutText = 'Ctrl + K',
      'aria-label': ariaLabel,
      className = 'search-shell',
    },
    ref
  ) {
    return (
      <label className={className}>
        <span className="search-icon" aria-hidden="true"></span>
        <input
          ref={ref}
          aria-label={ariaLabel || placeholder}
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {showShortcut && <span className="search-shortcut-chip">{shortcutText}</span>}
      </label>
    )
  }
)
