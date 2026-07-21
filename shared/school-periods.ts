export const CURRENT_SCHOOL_CYCLE = '2026'
export const CURRENT_SCHOOL_PERIOD = 1 as const

export function getNextSchoolPeriod(cycle: string, period: 1 | 2) {
  if (period === 1) {
    return { schoolCycle: cycle, schoolPeriod: 2 as const }
  }

  return { schoolCycle: String(Number(cycle) + 1), schoolPeriod: 1 as const }
}

export const TARGET_SCHOOL_PERIOD_CONFIG = getNextSchoolPeriod(CURRENT_SCHOOL_CYCLE, CURRENT_SCHOOL_PERIOD)
export const TARGET_SCHOOL_CYCLE = TARGET_SCHOOL_PERIOD_CONFIG.schoolCycle
export const TARGET_SCHOOL_PERIOD = TARGET_SCHOOL_PERIOD_CONFIG.schoolPeriod
export const CURRENT_PERIOD_LABEL = `${CURRENT_SCHOOL_PERIOD}-${CURRENT_SCHOOL_CYCLE}`
export const TARGET_PERIOD_LABEL = `${TARGET_SCHOOL_PERIOD}-${TARGET_SCHOOL_CYCLE}`

export const FICHA_FOLIO_YEAR = '2026'
