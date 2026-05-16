export function formatCurrency(amount: number) {
  return amount.toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function unitsToWords(value: number): string {
  const words = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']
  return words[value] ?? ''
}

function tensToWords(value: number): string {
  const specials: Record<number, string> = {
    10: 'diez',
    11: 'once',
    12: 'doce',
    13: 'trece',
    14: 'catorce',
    15: 'quince',
    16: 'dieciseis',
    17: 'diecisiete',
    18: 'dieciocho',
    19: 'diecinueve',
    20: 'veinte',
  }

  if (value <= 9) {
    return unitsToWords(value)
  }

  if (specials[value]) {
    return specials[value]
  }

  if (value < 30) {
    return `veinti${unitsToWords(value - 20)}`
  }

  const tens = ['','', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
  const ten = Math.floor(value / 10)
  const unit = value % 10

  return unit === 0 ? tens[ten] : `${tens[ten]} y ${unitsToWords(unit)}`
}

function hundredsToWords(value: number): string {
  if (value < 100) {
    return tensToWords(value)
  }

  if (value === 100) {
    return 'cien'
  }

  const hundreds: Record<number, string> = {
    1: 'ciento',
    2: 'doscientos',
    3: 'trescientos',
    4: 'cuatrocientos',
    5: 'quinientos',
    6: 'seiscientos',
    7: 'setecientos',
    8: 'ochocientos',
    9: 'novecientos',
  }

  const hundred = Math.floor(value / 100)
  const remainder = value % 100

  return remainder === 0 ? hundreds[hundred] : `${hundreds[hundred]} ${tensToWords(remainder)}`
}

function integerToWords(value: number): string {
  if (value < 1000) {
    return hundredsToWords(value)
  }

  if (value < 1000000) {
    const thousands = Math.floor(value / 1000)
    const remainder = value % 1000
    const thousandText = thousands === 1 ? 'mil' : `${hundredsToWords(thousands)} mil`
    return remainder === 0 ? thousandText : `${thousandText} ${hundredsToWords(remainder)}`
  }

  return String(value)
}

export function amountToWords(amount: number) {
  const safe = Number.isFinite(amount) ? amount : 0
  const integer = Math.floor(safe)
  const cents = Math.round((safe - integer) * 100)
  const words = integerToWords(integer).toUpperCase()
  return `${words} PESOS, ${String(cents).padStart(2, '0')}/100 M.N.`
}

export function formatPrintDate(date: Date) {
  return date.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  })
}
