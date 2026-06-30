import type { GroupStat } from '@/types/domain'

export function groupSexBalanceLabel(stat: GroupStat) {
  const gap = Math.abs(stat.sex.hombre - stat.sex.mujer)
  return gap <= 4 ? 'OK' : gap <= 8 ? 'Revisar' : 'Ajustar'
}

export function groupBandBalanceLabel(stat: GroupStat) {
  const values = [stat.bands.alto, stat.bands.medio, stat.bands.bajo]
  const spread = Math.max(...values) - Math.min(...values)
  return spread <= 6 ? 'OK' : spread <= 12 ? 'Revisar' : 'Ajustar'
}
