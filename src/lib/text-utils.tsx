import React from 'react'

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function highlightMatch(text: string, query: string) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return text
  const regex = new RegExp(`(${escapeRegex(normalizedQuery)})`, 'gi')
  const parts = text.split(regex)
  if (parts.length === 1) return text
  return parts.map((part, index) =>
    part.toLowerCase() === normalizedQuery.toLowerCase()
      ? <mark key={`${part}-${index}`} className="search-highlight">{part}</mark>
      : part,
  )
}

export function normalizeSheetCell(value: unknown) {
  return String(value ?? '').trim()
}

export function normalizeSheetUpper(value: unknown) {
  return normalizeSheetCell(value).toUpperCase()
}

export function normalizeSheetHeader(value: unknown) {
  return normalizeSheetCell(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function pickSheetValue(row: Record<string, unknown>, aliases: string[]) {
  for (const [rawKey, rawValue] of Object.entries(row)) {
    if (aliases.includes(normalizeSheetHeader(rawKey))) {
      return rawValue
    }
  }

  return ''
}

export function normalizeImportedGroupLabel(value: unknown) {
  const normalized = normalizeSheetUpper(value)
  if (/^[A-Z]$/.test(normalized)) {
    return `1${normalized}`
  }
  if (/^1[A-Z]$/.test(normalized)) {
    return normalized
  }
  return normalized
}
