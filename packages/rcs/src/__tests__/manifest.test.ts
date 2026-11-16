import { describe, expect, test } from 'bun:test'

interface ManifestIcon {
  src: string
  sizes: string
  type?: string
  purpose?: string
}

interface Manifest {
  name: string
  short_name: string
  description?: string
  display: string
  start_url: string
  scope: string
  background_color: string
  theme_color: string
  icons: ManifestIcon[]
}

const manifestUrl = new URL('../../public/manifest.webmanifest', import.meta.url)
const publicDir = new URL('../../public/', import.meta.url)

function loadManifest(): Promise<Manifest> {
  return Bun.file(manifestUrl).json() as Promise<Manifest>
}

describe('web app manifest', () => {
  test('is standalone and scoped to /code/', async () => {
    const manifest = await loadManifest()

    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/code/')
    expect(manifest.scope).toBe('/code/')
    expect(manifest.icons.map((icon) => icon.sizes)).toContain('512x512')
  })

  test('declares a maskable icon', async () => {
    const manifest = await loadManifest()
    const maskable = manifest.icons.filter((icon) => icon.purpose?.split(' ').includes('maskable'))

    expect(maskable.length).toBeGreaterThan(0)
    expect(maskable.map((icon) => icon.sizes)).toContain('512x512')
  })

  test('every referenced icon exists on disk', async () => {
    const manifest = await loadManifest()
    const checks = manifest.icons.map((icon) => {
      // Manifest srcs are served under `/code`; map them back to `public/`.
      const relative = icon.src.startsWith('/code/') ? icon.src.slice('/code/'.length) : icon.src.replace(/^\//, '')
      const exists = Bun.file(new URL(relative, publicDir)).exists()
      return exists
    })

    const results = await Promise.all(checks)
    expect(results.every(Boolean)).toBe(true)
  })
})
