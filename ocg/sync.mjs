import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, openSync, writeSync, closeSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = dirname(fileURLToPath(import.meta.url))
const VENDOR = join(ROOT, 'vendor')
const GIT = process.env.OCG_GIT_DIR || join(tmpdir(), 'fuwalab-ocg')
const REPOS = {
  CardScripts: 'https://github.com/ProjectIgnis/CardScripts.git',
  BabelCDB: 'https://github.com/ProjectIgnis/BabelCDB.git',
}
const CORE = { name: '@n1xx1/ocgcore-wasm', version: '0.1.2', url: 'https://github.com/n1xx1/ocgcore-wasm', core: 'https://github.com/edo9300/ygopro-core' }
const STRINGS_URL = 'https://raw.githubusercontent.com/ProjectIgnis/Distribution/master/config/strings.conf'
const SCRIPT_DIRS = ['', 'official', 'pre-release', 'unofficial']
const CDB_SKIP = /rush|skills|goat/i

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'inherit' })
}

function syncRepo(name, url) {
  const dir = join(GIT, name)
  if (existsSync(join(dir, '.git'))) {
    git(['fetch', '--depth', '1', 'origin'], dir)
    git(['reset', '--hard', 'FETCH_HEAD'], dir)
  } else {
    git(['clone', '--depth', '1', url, dir], GIT)
  }
}

function repoInfo(name, url) {
  const dir = join(GIT, name)
  try {
    const [commit, date] = execFileSync('git', ['log', '-1', '--format=%H %cI'], { cwd: dir, encoding: 'utf8' }).trim().split(' ')
    return { url: url.replace(/\.git$/, ''), commit, date }
  } catch (e) {
    console.warn('[ocg-sync] version', name, e.message)
    return { url: url.replace(/\.git$/, ''), commit: null, date: null }
  }
}

function packScripts() {
  const base = join(GIT, 'CardScripts')
  const files = {}
  for (const sub of SCRIPT_DIRS) {
    const dir = join(base, sub)
    if (!existsSync(dir)) continue
    const walk = (d) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f)
        if (statSync(p).isDirectory()) { if (sub) walk(p); continue }
        if (f.endsWith('.lua') && !files[f]) files[f] = p
      }
    }
    walk(dir)
  }
  const tmp = join(VENDOR, 'scripts.pack.tmp')
  const fd = openSync(tmp, 'w')
  const index = {}
  let offset = 0
  try {
    for (const [name, p] of Object.entries(files)) {
      const buf = readFileSync(p)
      writeSync(fd, buf)
      index[name] = [offset, buf.length]
      offset += buf.length
    }
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, join(VENDOR, 'scripts.pack'))
  return index
}

function splitSetcodes(v) {
  let n = BigInt(v || 0)
  const out = []
  while (n > 0n) {
    const s = Number(n & 0xffffn)
    if (s) out.push(s)
    n >>= 16n
  }
  return out
}

function readCdbs() {
  const dir = join(GIT, 'BabelCDB')
  const files = readdirSync(dir).filter(f => f.endsWith('.cdb') && !CDB_SKIP.test(f))
  files.sort((a, b) => (a === 'cards.cdb' ? -1 : b === 'cards.cdb' ? 1 : a.localeCompare(b)))
  const cards = {}
  const texts = {}
  for (const f of files) {
    let db
    try {
      db = new DatabaseSync(join(dir, f), { readOnly: true })
      const q = db.prepare('select d.*, t.name, t.desc, t.str1, t.str2, t.str3, t.str4, t.str5, t.str6, t.str7, t.str8, t.str9, t.str10, t.str11, t.str12, t.str13, t.str14, t.str15, t.str16 from datas d left join texts t on t.id = d.id')
      q.setReadBigInts(true)
      for (const r of q.all()) {
        const id = Number(r.id)
        const type = Number(r.type)
        const lvl = Number(r.level)
        const isLink = (type & 0x4000000) !== 0
        cards[id] = [
          Number(r.alias),
          splitSetcodes(r.setcode),
          type,
          lvl & 0xff,
          Number(r.attribute),
          String(r.race),
          Number(r.atk),
          isLink ? 0 : Number(r.def),
          (lvl >> 24) & 0xff,
          (lvl >> 16) & 0xff,
          isLink ? Number(r.def) : 0,
        ]
        const strs = []
        for (let i = 1; i <= 16; i++) strs.push(r['str' + i] || '')
        while (strs.length && !strs[strs.length - 1]) strs.pop()
        texts[id] = strs.length ? [r.name || '', strs] : [r.name || '']
      }
    } catch (e) {
      console.warn('[ocg-sync] cdb', f, e.message)
    } finally {
      try { db?.close() } catch {}
    }
  }
  return { cards, texts }
}

async function fetchSystemStrings() {
  try {
    const r = await fetch(STRINGS_URL)
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const out = { system: {}, victory: {}, counter: {}, setname: {} }
    for (const line of (await r.text()).split(/\r?\n/)) {
      const m = line.match(/^!(system|victory|counter|setname)\s+(\S+)\s+(.*)$/)
      if (!m) continue
      const key = m[1] === 'system' ? String(parseInt(m[2], 10)) : String(parseInt(m[2], 16))
      out[m[1]][key] = m[3].trim()
    }
    return out
  } catch (e) {
    console.warn('[ocg-sync] strings.conf', e.message)
    return null
  }
}

mkdirSync(VENDOR, { recursive: true })
mkdirSync(GIT, { recursive: true })
if (!process.argv.includes('--no-git')) for (const [n, u] of Object.entries(REPOS)) syncRepo(n, u)
const index = packScripts()
const { cards, texts } = readCdbs()
const strings = await fetchSystemStrings()
writeFileSync(join(VENDOR, 'scripts-index.json'), JSON.stringify(index))
writeFileSync(join(VENDOR, 'cards.json'), JSON.stringify(cards))
writeFileSync(join(VENDOR, 'texts.json'), JSON.stringify(texts))
if (strings) writeFileSync(join(VENDOR, 'strings.json'), JSON.stringify(strings))
const versions = {
  generatedAt: new Date().toISOString(),
  license: 'AGPL-3.0-or-later',
  core: CORE,
  repos: Object.fromEntries(Object.entries(REPOS).map(([n, u]) => [n, repoInfo(n, u)])),
  strings: { url: STRINGS_URL, fetchedAt: strings ? new Date().toISOString() : null },
}
writeFileSync(join(VENDOR, 'versions.json'), JSON.stringify(versions, null, 2))
console.log(`[ocg-sync] ${Object.keys(index).length} scripts, ${Object.keys(cards).length} cartes`)
