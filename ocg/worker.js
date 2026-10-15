import { loadCore, createDuel, isExtra, randomSeed, MSG } from './engine.js'

const BASE = new URL('./', self.location.href)
const scripts = new Map()
let lib = null
let cards = null
let duel = null
let autoPlayers = [1]
let me = 0
let quietChains = true
let missing = new Set()
let pending = null
let PAUSE = { pause: true, ai: true }
let resps = []
let sent = 0
let codeList = null
let marks = []
const DECISIONS = new Set([10, 11, 12, 16])
let setup = null

const revive = (_k, v) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)

function getSync(path) {
  const x = new XMLHttpRequest()
  x.open('GET', new URL(path, BASE).href, false)
  x.send()
  return x.status === 200 ? x.responseText : null
}

function store(name, src) {
  const code = Number(name.match(/^c(\d+)\.lua$/)?.[1])
  if (src == null && code && cards?.[code] && (cards[code][2] & 0x20 || cards[code][2] & 0x6)) missing.add(name)
  scripts.set(name, src)
  return src
}

function readScript(name) {
  if (scripts.has(name)) return scripts.get(name)
  if (name === 'c0.lua') return store(name, null)
  return store(name, getSync('s/' + encodeURIComponent(name)))
}

async function preload(codes) {
  const want = [...new Set(codes)].filter(c => !scripts.has(`c${c}.lua`))
  if (!want.length && scripts.has('utility.lua')) return
  try {
    const r = await fetch(new URL('bundle?c=' + want.join(','), BASE))
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const all = await r.json()
    for (const [name, src] of Object.entries(all)) if (!scripts.has(name)) store(name, src)
  } catch (e) {
    console.warn('[ocg] bundle', e?.message || e)
  }
}

const step = (s) => self.postMessage({ t: 'progress', step: s })

function split(list) {
  const main = []
  const extra = []
  const unknown = []
  for (const code of list) {
    const row = cards[code]
    if (!row) unknown.push(code)
    else if (isExtra(row)) extra.push(code)
    else main.push(code)
  }
  return { main, extra, unknown }
}

function skipEmptyChain(res) {
  let r = res
  const log = [...r.log]
  const skip = (p) => p && p.type === MSG.SELECT_CHAIN && !p.forced && (!p.selects.length || (quietChains && !p.spe_count && !duel.state.chain.length))
  while (!r.auto && !r.cont && skip(r.prompt)) {
    r = duel.run({ type: 8, index: null }, autoPlayers, PAUSE)
    log.push(...r.log)
  }
  return { ...r, log }
}

function post(res, extra = null) {
  const out = skipEmptyChain(res)
  const has = (t) => out.log.some(m => m.type === t)
  const wait = has(72) ? 700 : has(MSG.CHAINING) ? 600 : has(MSG.NEW_TURN) ? 500 : has(MSG.ATTACK) ? 400 : has(MSG.NEW_PHASE) ? 320 : 220
  pending = out.auto || out.cont ? out : null
  const resp = resps.slice(sent)
  sent = resps.length
  self.postMessage({ t: 'state', log: out.log, prompt: out.prompt, board: duel.board(), missing: [...missing], thinking: !!pending, wait, resp, undo: marks.length, ...extra })
}

function makeDuel() {
  return createDuel(lib, {
    ...setup,
    readCard: (code) => cards[code] || null,
    allCodes: () => (codeList ||= Object.keys(cards).map(Number).filter(c => !cards[c][0])),
    readScript,
    onError: (type, text) => self.postMessage({ t: 'core', type, text }),
    onResponse: (r) => resps.push(r),
  })
}

function undo() {
  if (!duel || pending || !marks.length) return
  const cut = marks.pop()
  const keep = resps.slice(0, cut)
  duel.destroy()
  resps = []
  duel = makeDuel()
  const prompt = duel.fastForward(keep)
  sent = resps.length
  if (!prompt) return post(duel.run(null, autoPlayers, PAUSE), { cut })
  const hint = duel.state.hints[prompt.player]
  duel.state.hints[prompt.player] = null
  self.postMessage({ t: 'state', log: [], prompt: { ...prompt, hint }, board: duel.board(), missing: [...missing], thinking: false, wait: 0, resp: [], undo: marks.length, cut })
}

function next() {
  const out = pending
  if (!out) return
  pending = null
  post(out.cont ? duel.run(null, autoPlayers, PAUSE) : duel.run(duel.respondAuto(out.auto, PAUSE), autoPlayers, PAUSE))
}

self.onmessage = async ({ data }) => {
  try {
    if (data.t === 'start') {
      step('core')
      ;[lib, cards] = await Promise.all([
        lib || loadCore(),
        cards || fetch(new URL('cards.json', BASE)).then(r => r.json()),
      ])
      pending = null
      duel?.destroy()
      duel = null
      missing = new Set()
      step('scripts')
      await preload([...data.decks[0], ...data.decks[1]])
      step('duel')
      me = data.me ? 1 : 0
      autoPlayers = data.controlBoth ? [] : [1 - me]
      quietChains = data.quietChains !== false
      PAUSE = { pause: true, ai: data.aiOpp !== false }
      const p0 = split(data.decks[0])
      const p1 = split(data.decks[1])
      const fork = data.fork ? JSON.parse(JSON.stringify(data.fork), revive) : null
      const seed = fork ? fork.seed.map(x => BigInt(x)) : (data.seed || randomSeed())
      resps = []
      sent = 0
      const hands = data.hands || fork?.hands || null
      marks = []
      setup = { seed, hands, decks: [p0, p1] }
      duel = makeDuel()
      self.postMessage({ t: 'unknown', codes: [...new Set([...p0.unknown, ...p1.unknown])] })
      self.postMessage({ t: 'meta', seed: seed.map(String), decks: data.decks, hands })
      if (!fork) {
        post(duel.run(null, autoPlayers, PAUSE))
      } else {
        const prompt = duel.fastForward(fork.responses || [])
        sent = resps.length
        if (!prompt) post(duel.run(null, autoPlayers, PAUSE))
        else if (autoPlayers.includes(prompt.player)) post(duel.run(duel.respondAuto(prompt, PAUSE), autoPlayers, PAUSE))
        else {
          const hint = duel.state.hints[prompt.player]
          duel.state.hints[prompt.player] = null
          post({ log: [], prompt: { ...prompt, hint } })
        }
      }
    } else if (data.t === 'next' && duel) {
      next()
    } else if (data.t === 'respond' && duel && !pending) {
      if (DECISIONS.has(duel.state.lastPrompt?.type)) marks.push(resps.length)
      post(duel.run(data.response, autoPlayers, PAUSE))
    } else if (data.t === 'undo') {
      undo()
    } else if (data.t === 'control') {
      autoPlayers = data.controlBoth ? [] : [1 - me]
      quietChains = data.quietChains !== false
      PAUSE = { pause: true, ai: data.aiOpp !== false }
    }
  } catch (e) {
    self.postMessage({ t: 'error', message: e?.message || String(e) })
  }
}
