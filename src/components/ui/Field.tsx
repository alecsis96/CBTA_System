import type { ReactNode } from 'react'

type FieldProps = {
  label: string
  required?: boolean
  className?: string
  children: ReactNode
}

export function Field({ label, required, className, children }: FieldProps) {
  return (
    <label className={className ? `form-field ${className}` : 'form-field'}>
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      {children}
    </label>
  )
}
