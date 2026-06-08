import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const AUTH_HASH_PREFIX = 'scrypt'

export function buildPasswordHash(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, 64).toString('hex')
  return `${AUTH_HASH_PREFIX}$${salt}$${derived}`
}

export function isValidPasswordHash(passwordHash: string) {
  if (!passwordHash.startsWith(`${AUTH_HASH_PREFIX}$`)) {
    return false
  }

  const parts = passwordHash.split('$')
  if (parts.length !== 3) {
    return false
  }

  const [prefix, salt, digest] = parts
  if (prefix !== AUTH_HASH_PREFIX || !salt || !digest) {
    return false
  }

  return /^[a-f0-9]+$/i.test(salt) && /^[a-f0-9]+$/i.test(digest)
}

export function verifyPassword(password: string, passwordHash: string) {
  const [prefix, salt, digest] = passwordHash.split('$')
  if (prefix !== AUTH_HASH_PREFIX || !salt || !digest) {
    return false
  }

  const expected = Buffer.from(digest, 'hex')
  const current = scryptSync(password, salt, expected.length)
  if (expected.length !== current.length) {
    return false
  }

  return timingSafeEqual(expected, current)
}
