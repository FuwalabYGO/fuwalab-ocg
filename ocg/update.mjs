import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { OCG_SOURCE_URL } from '../app/simulator/ocg/license.js'

const OCG = dirname(fileURLToPath(import.meta.url))
const VENDOR = join(OCG, 'vendor')
const NEXT = join(OCG, 'vendor.next')
const OLD = join(OCG, 'vendor.old')
const BASE = `${OCG_SOURCE_URL}/releases/latest/download/`
const FILES = ['versions.json', 'cards.json', 'texts.json', 'strings.json', 'scripts-index.json', 'scripts.pack']
const FIRST_CHECK = 2 * 60_000
const EVERY = 6 * 60 * 60_000
let running = false

const key = (v) => (v?.repos?.CardScripts?.commit && v?.repos?.BabelCDB?.commit ? `${v.repos.CardScripts.commit}-${v.repos.BabelCDB.commit}` : '')

async function get(file) {
  const r = await fetch(BASE + file, { redirect: 'follow', signal: AbortSignal.timeout(5 * 60_000) })
  if (!r.ok || !r.body) throw new Error(`${file} HTTP ${r.status}`)
  return r
}

async function localVersions() {
  try {
    return JSON.parse(await readFile(join(VENDOR, 'versions.json'), 'utf8'))
  } catch {
    return null
  }
}

async function checkPack(dir) {
  const index = JSON.parse(await readFile(join(dir, 'scripts-index.json'), 'utf8'))
  const end = Object.values(index).reduce((m, [o, l]) => Math.max(m, o + l), 0)
  const size = (await stat(join(dir, 'scripts.pack'))).size
  if (!end || size !== end) throw new Error(`scripts.pack incohérent (${size} / ${end})`)
  JSON.parse(await readFile(join(dir, 'cards.json'), 'utf8'))
}

export async function updateOcgCards() {
  if (running) return false
  running = true
  try {
    const remote = await (await get('versions.json')).json()
    const rk = key(remote)
    if (!rk) throw new Error('versions.json distant invalide')
    if (rk === key(await localVersions())) return false
    await rm(NEXT, { recursive: true, force: true })
    await mkdir(NEXT, { recursive: true })
    for (const f of FILES) {
      const r = await get(f)
      await pipeline(Readable.fromWeb(r.body), createWriteStream(join(NEXT, f)))
    }
    await checkPack(NEXT)
    await rm(OLD, { recursive: true, force: true })
    try {
      await rename(VENDOR, OLD)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
    await rename(NEXT, VENDOR)
    await rm(OLD, { recursive: true, force: true })
    console.log('[ocg-update] cartes du moteur mises à jour', remote.generatedAt)
    return true
  } catch (e) {
    console.warn('[ocg-update]', e.message)
    await rm(NEXT, { recursive: true, force: true }).catch(() => {})
    return false
  } finally {
    running = false
  }
}

export function startOcgUpdateTimer() {
  setTimeout(updateOcgCards, FIRST_CHECK).unref?.()
  setInterval(updateOcgCards, EVERY).unref?.()
}
