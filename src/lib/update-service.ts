import packageInfo from '../../package.json'

export type UpdateManifest = {
  version: string
  notes?: string
  windowsUrl?: string
  macUrl?: string
  linuxUrl?: string
  releaseUrl?: string
}

export type UpdateCheckResult = {
  currentVersion: string
  updateAvailable: boolean
  latest?: UpdateManifest
  downloadUrl?: string
}

const DEFAULT_UPDATE_MANIFEST_URL =
  'https://github.com/alecsis96/CBTA_System/releases/latest/download/latest.json'

export const CURRENT_APP_VERSION = packageInfo.version
export const UPDATE_MANIFEST_URL = import.meta.env.VITE_UPDATE_MANIFEST_URL || DEFAULT_UPDATE_MANIFEST_URL

function parseVersion(version: string) {
  return version
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0))
}

export function isNewerVersion(latestVersion: string, currentVersion = CURRENT_APP_VERSION) {
  const latest = parseVersion(latestVersion)
  const current = parseVersion(currentVersion)
  const maxLength = Math.max(latest.length, current.length)

  for (let index = 0; index < maxLength; index += 1) {
    const latestPart = latest[index] ?? 0
    const currentPart = current[index] ?? 0
    if (latestPart > currentPart) return true
    if (latestPart < currentPart) return false
  }

  return false
}

function getPlatformDownloadUrl(manifest: UpdateManifest) {
  const platform = typeof navigator === 'undefined' ? '' : navigator.userAgent.toLowerCase()
  if (platform.includes('mac')) return manifest.macUrl ?? manifest.releaseUrl
  if (platform.includes('linux')) return manifest.linuxUrl ?? manifest.releaseUrl
  return manifest.windowsUrl ?? manifest.releaseUrl
}

export async function checkForAppUpdate(manifestUrl = UPDATE_MANIFEST_URL): Promise<UpdateCheckResult> {
  const response = await fetch(`${manifestUrl}${manifestUrl.includes('?') ? '&' : '?'}t=${Date.now()}`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`No se pudo consultar actualizaciones (${response.status}).`)
  }

  const manifest = await response.json() as UpdateManifest
  if (!manifest.version?.trim()) {
    throw new Error('El manifiesto de actualizacion no contiene version.')
  }

  const downloadUrl = getPlatformDownloadUrl(manifest)
  return {
    currentVersion: CURRENT_APP_VERSION,
    updateAvailable: isNewerVersion(manifest.version),
    latest: manifest,
    downloadUrl,
  }
}
