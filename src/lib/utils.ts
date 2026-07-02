import type { ChargeConceptSummary, StudentSummary } from '@/types/domain'

export const relationshipOptions = ['Padre', 'Madre', 'Tutor', 'Abuelo', 'Abuela', 'Otro']

export const CONTROL_STUDENTS_PER_PAGE = 20
export const RECEIPTS_PER_PAGE = 5
export const INSCRIPTION_CONCEPT_CODE = 'B002'

export const CAREER_LABELS_BY_CODE = {
  TA: 'Tecnico agropecuario',
  TO: 'Tecnico en ofimatica',
  TDC: 'Tecnico en desarrollo comunitario',
} as const

export function getCareerCodeFromGroupLabel(groupLabel: string | null | undefined) {
  const match = groupLabel?.trim().match(/-(TA|TO|TDC)$/)
  return match?.[1] as keyof typeof CAREER_LABELS_BY_CODE | undefined
}

export function getCareerLabelFromGroupLabel(groupLabel: string | null | undefined) {
  const code = getCareerCodeFromGroupLabel(groupLabel)
  return code ? CAREER_LABELS_BY_CODE[code] : 'Sin carrera asignada'
}

export function formatGroupLabelWithoutCareer(groupLabel: string | null | undefined, semesterLevel?: number) {
  if (!groupLabel) return 'Sin grupo'
  const withoutCareer = groupLabel.trim().replace(/-(TA|TO|TDC)$/, '')
  if (!semesterLevel) return withoutCareer || groupLabel
  return withoutCareer.replace(String(semesterLevel), '') || withoutCareer || groupLabel
}

export const conceptGroupHeaders: Record<string, { code: string; name: string; description: string }> = {
  A000: {
    code: 'A000',
    name: 'Servicios administrativos escolares',
    description: 'Agrupa los ingresos por servicios administrativos escolares.',
  },
  B000: {
    code: 'B000',
    name: 'Aportaciones y cuotas de cooperacion voluntaria',
    description: 'Agrupa aportaciones, cooperaciones y donaciones relacionadas.',
  },
  C000: {
    code: 'C000',
    name: 'Servicios generales',
    description: 'Agrupa ingresos por servicios generales a estudiantes y comunidad.',
  },
}

export function isSelectableConcept(concept: ChargeConceptSummary) {
  return !concept.code.endsWith('000') && !concept.isLifeInsurance
}

export function resolveGroupKey(concept: ChargeConceptSummary) {
  if (concept.groupCode && concept.groupCode.trim().length > 0) {
    return concept.groupCode
  }

  const prefix = concept.code.slice(0, 1)
  return `${prefix}000`
}

export function groupConcepts(concepts: ChargeConceptSummary[], query?: string) {
  const groupOrder: string[] = []
  const groupMap = new Map<
    string,
    { header: ChargeConceptSummary | null; items: ChargeConceptSummary[] }
  >()

  const normalizedQuery = query?.trim().toLowerCase() ?? ''

  for (const concept of concepts) {
    const groupKey = resolveGroupKey(concept)
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, { header: null, items: [] })
      groupOrder.push(groupKey)
    }

    const group = groupMap.get(groupKey)
    if (!group) continue

    if (concept.code === groupKey) {
      group.header = concept
    } else {
      if (!normalizedQuery) {
        group.items.push(concept)
        continue
      }

      const haystack = [concept.code, concept.name, concept.description ?? '', concept.groupCode ?? '']
        .join(' ')
        .toLowerCase()

      if (haystack.includes(normalizedQuery)) {
        group.items.push(concept)
      }
    }
  }

  return groupOrder
    .map((groupKey) => ({
      key: groupKey,
      header: groupMap.get(groupKey)?.header ?? null,
      items: groupMap.get(groupKey)?.items ?? [],
    }))
    .filter((group) => group.items.length > 0)
}

export function groupedSelectableConcepts(concepts: ChargeConceptSummary[]) {
  const items = concepts.filter(isSelectableConcept)
  const grouped = new Map<string, ChargeConceptSummary[]>()

  for (const concept of items) {
    const key = resolveGroupKey(concept)
    const current = grouped.get(key) ?? []
    current.push(concept)
    grouped.set(key, current)
  }

  return Array.from(grouped.entries()).map(([key, groupItems]) => ({
    key,
    header: {
      code: conceptGroupHeaders[key]?.code ?? key,
      groupCode: key,
      name: conceptGroupHeaders[key]?.name ?? `Grupo ${key}`,
      description: conceptGroupHeaders[key]?.description ?? 'Grupo derivado automaticamente desde la clave.',
      amount: 0,
      periodLabel: 'Sin tarifa',
      isSuggested: false,
      excludeFromRoc: false,
      isLifeInsurance: false,
    },
    items: groupItems,
  }))
}

export function deriveGradeFromGroup(groupLabel: string | null) {
  if (!groupLabel) return 'Sin grado'
  const match = groupLabel.trim().match(/^(\d+)/)
  if (!match) return 'Sin grado'
  return `${match[1]}o`
}

export function formatVisibleGroupLabel(groupLabel: string | null) {
  if (!groupLabel) return 'Sin asignar'
  const normalized = groupLabel.trim()
  const compact = normalized.replace(/^\d+\s*/u, '').trim()
  return compact.length > 0 ? compact : normalized
}

export function formatPreferredEnrollment(student: StudentSummary) {
  if (student.enrollmentStatus === 'FICHA_ENTREGADA' && student.enrollmentNumber.startsWith('FICHA-')) {
    const folio = student.enrollmentNumber.split('-').pop()?.replace(/^0+/, '') || student.enrollmentNumber
    return `Ficha ${folio}`
  }

  return student.officialEnrollmentNumber?.trim() || student.enrollmentNumber
}

export function dailyStatusClassName(status: StudentSummary['dailyStatus']) {
  if (status === 'PERMISO') return 'status-tag warning'
  if (status === 'AUSENTE') return 'status-tag danger'
  return 'status-tag success'
}

export function isWithdrawnEnrollmentStatus(status: string | null | undefined) {
  return status === 'BAJA' || status === 'BAJA_TEMPORAL' || status === 'BAJA_DEFINITIVA' || status === 'NO_SHOW' || status === 'EGRESADO'
}

export function isActiveEnrollmentStatus(status: string | null | undefined) {
  return status === 'INSCRITO' || status === 'ASIGNADO' || status === 'CONFIRMADO'
}

export function combinedStudentStatusLabel(student: Pick<StudentSummary, 'enrollmentStatus' | 'statusLabel' | 'dailyStatus' | 'dailyStatusLabel'>) {
  if (isWithdrawnEnrollmentStatus(student.enrollmentStatus)) return student.statusLabel
  if (!isActiveEnrollmentStatus(student.enrollmentStatus)) return student.statusLabel
  if (student.dailyStatus === 'PERMISO' || student.dailyStatus === 'AUSENTE') return student.dailyStatusLabel
  return 'Activo'
}

export function combinedStudentStatusClassName(student: Pick<StudentSummary, 'enrollmentStatus' | 'dailyStatus'>) {
  if (isWithdrawnEnrollmentStatus(student.enrollmentStatus)) return 'status-tag danger'
  if (!isActiveEnrollmentStatus(student.enrollmentStatus)) return 'status-tag warning'
  return dailyStatusClassName(student.dailyStatus)
}

export function splitFullName(fullName: string) {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length <= 1) {
    return { firstName: fullName.trim(), paternalLastName: '', maternalLastName: '' }
  }

  if (parts.length === 2) {
    return { firstName: parts[0], paternalLastName: parts[1], maternalLastName: '' }
  }

  const maternalLastName = parts[parts.length - 1]
  const paternalLastName = parts[parts.length - 2]
  const firstName = parts.slice(0, -2).join(' ')
  return { firstName, paternalLastName, maternalLastName }
}

export function getOutputFileName(outputPath: string) {
  const parts = outputPath.split(/[\\/]/)
  return parts[parts.length - 1] || outputPath
}

export function extractOutputFileNameFromFeedback(message: string) {
  const match = message.match(/Archivo:\s*([^.\n]+\.xlsx)/i)
  return match ? getOutputFileName(match[1].trim()) : null
}

export function normalizeFeedbackMessage(message: string) {
  return message.replace(/\s*Archivo:\s*([^.\n]+\.xlsx)\.?/i, '').trim()
}

export function toLocalDateInputValue(value = new Date()) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function toLocalDateTimeInputValue(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  const hour = String(value.getHours()).padStart(2, '0')
  const minute = String(value.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}
