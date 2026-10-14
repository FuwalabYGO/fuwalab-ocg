import { readFile, open } from 'node:fs/promises'
import { join } from 'node:path'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const OCG = join(process.cwd(), 'ocg')
const VENDOR = join(OCG, 'vendor')
const CODE_FILES = /^(worker|engine)\.js$|^core\/[\w.-]+\.js$/
const DATA_FILES = new Set(['cards.json', 'texts.json', 'strings.json'])
let index = null

async function scriptIndex() {
  if (!index) index = JSON.parse(await readFile(join(VENDOR, 'scripts-index.json'), 'utf8'))
  return index
}

function send(body, type, maxAge) {
  return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': `public, max-age=${maxAge}` } })
}

const BASE_LUA = (name) => !/^c\d+\.lua$/.test(name)

async function bundle(req) {
  const idx = await scriptIndex()
  const codes = [...new Set((new URL(req.url).searchParams.get('c') || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 400)
  const names = [...Object.keys(idx).filter(BASE_LUA), ...codes.map(c => `c${c}.lua`)]
  const out = {}
  const fh = await open(join(VENDOR, 'scripts.pack'), 'r')
  try {
    for (const name of names) {
      const entry = idx[name]
      if (!entry) { out[name] = null; continue }
      const buf = Buffer.alloc(entry[1])
      await fh.read(buf, 0, entry[1], entry[0])
      out[name] = buf.toString('utf8')
    }
  } finally {
    await fh.close()
  }
  return send(JSON.stringify(out), 'application/json; charset=utf-8', 3600)
}

export async function GET(req, { params }) {
  const rel = (params.p || []).join('/')
  try {
    if (rel === 'bundle') return await bundle(req)
    if (CODE_FILES.test(rel)) return send(await readFile(join(OCG, rel)), 'text/javascript; charset=utf-8', 0)
    if (DATA_FILES.has(rel)) return send(await readFile(join(VENDOR, rel)), 'application/json; charset=utf-8', 3600)
    if (rel.startsWith('s/')) {
      const name = rel.slice(2)
      const entry = /^[\w.-]+\.lua$/.test(name) ? (await scriptIndex())[name] : null
      if (!entry) return new Response(null, { status: 404 })
      const fh = await open(join(VENDOR, 'scripts.pack'), 'r')
      try {
        const buf = Buffer.alloc(entry[1])
        await fh.read(buf, 0, entry[1], entry[0])
        return send(buf, 'text/plain; charset=utf-8', 3600)
      } finally {
        await fh.close()
      }
    }
  } catch (e) {
    console.warn('[ocg] res', rel, e.message)
  }
  return new Response(null, { status: 404 })
}
