import createCore, { OcgDuelMode, OcgProcessResult, OcgResponseType, OcgQueryFlags } from './core/index.js'

export const LOC = { DECK: 1, HAND: 2, MZONE: 4, SZONE: 8, GRAVE: 16, REMOVED: 32, EXTRA: 64, OVERLAY: 128 }
export const MSG = {
  RETRY: 1, HINT: 2, WIN: 5,
  SELECT_BATTLECMD: 10, SELECT_IDLECMD: 11, SELECT_EFFECTYN: 12, SELECT_YESNO: 13, SELECT_OPTION: 14,
  SELECT_CARD: 15, SELECT_CHAIN: 16, SELECT_PLACE: 18, SELECT_POSITION: 19, SELECT_TRIBUTE: 20,
  SORT_CHAIN: 21, SELECT_COUNTER: 22, SELECT_SUM: 23, SELECT_DISFIELD: 24, SORT_CARD: 25,
  SELECT_UNSELECT_CARD: 26, NEW_TURN: 40, NEW_PHASE: 41, MOVE: 50, POS_CHANGE: 53, SET: 54,
  SUMMONING: 60, SPSUMMONING: 62, FLIPSUMMONING: 64, CHAINING: 70, CHAIN_SOLVED: 73, CHAIN_END: 74,
  CHAIN_NEGATED: 75, DRAW: 90, DAMAGE: 91, RECOVER: 92, LPUPDATE: 94, PAY_LPCOST: 100, ATTACK: 110,
  TOSS_COIN: 130, TOSS_DICE: 131, ROCK_PAPER_SCISSORS: 132, ANNOUNCE_RACE: 140, ANNOUNCE_ATTRIB: 141,
  ANNOUNCE_CARD: 142, ANNOUNCE_NUMBER: 143,
}
const STEP_MSGS = new Set([40, 41, 90, 60, 62, 64, 70, 72, 73, 91, 92])
const PAUSE_MSGS = new Set([40, 41, 50, 60, 62, 64, 70, 90, 91, 92, 110])
const PROMPTS = new Set([10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 132, 140, 141, 142, 143])
const EXTRA_TYPES = 0x40 | 0x2000 | 0x800000 | 0x4000000
const QFLAGS = OcgQueryFlags.CODE | OcgQueryFlags.POSITION | OcgQueryFlags.ATTACK | OcgQueryFlags.DEFENSE |
  OcgQueryFlags.LEVEL | OcgQueryFlags.RANK | OcgQueryFlags.LINK | OcgQueryFlags.OVERLAY_CARD | OcgQueryFlags.COUNTERS |
  OcgQueryFlags.OWNER | OcgQueryFlags.STATUS

const SHIM = `
local _gci=Duel.GetChainInfo
local _bad={[31]=true,[32]=true,[33]=true}
Duel.GetChainInfo=function(ch,...)
  local n=select('#',...)
  local flags={...}
  local hit=false
  for i=1,n do if _bad[flags[i]] then hit=true end end
  if not hit then return _gci(ch,...) end
  local out={}
  for i=1,n do
    if _bad[flags[i]] then out[i]=nil else out[i]=_gci(ch,flags[i]) end
  end
  return table.unpack(out,1,n)
end
`

let corePromise = null
export function loadCore() {
  if (!corePromise) corePromise = createCore({ sync: true })
  return corePromise
}

export function toCardData(code, row) {
  if (!row) return null
  return {
    code, alias: row[0], setcodes: row[1], type: row[2], level: row[3], attribute: row[4],
    race: BigInt(row[5]), attack: row[6], defense: row[7], lscale: row[8], rscale: row[9], link_marker: row[10],
  }
}

export function isExtra(row) {
  return !!row && (row[2] & EXTRA_TYPES) !== 0 && (row[2] & 0x1) !== 0
}

export function randomSeed() {
  const a = new BigUint64Array(4)
  globalThis.crypto.getRandomValues(a)
  for (let i = 0; i < 4; i++) if (a[i] === 0n) a[i] = 1n
  return [a[0], a[1], a[2], a[3]]
}

function firstPlaces(msg, count) {
  const out = []
  const mask = msg.field_mask >>> 0
  const zones = [[0, LOC.MZONE, 7, 0], [8, LOC.SZONE, 8, 0], [16, LOC.MZONE, 7, 1], [24, LOC.SZONE, 8, 1]]
  for (const [shift, location, n, side] of zones) {
    for (let i = 0; i < n && out.length < count; i++) {
      if (!(mask & (1 << (shift + i)))) out.push({ player: side ? 1 - msg.player : msg.player, location, sequence: i })
    }
  }
  return out
}

export function placesFromMask(msg) {
  return firstPlaces(msg, 99)
}

export function autoResponse(msg) {
  const range = (n) => Array.from({ length: n }, (_, i) => i)
  switch (msg.type) {
    case MSG.SELECT_IDLECMD:
      return { type: OcgResponseType.SELECT_IDLECMD, action: msg.to_ep ? 7 : 6, index: null }
    case MSG.SELECT_BATTLECMD:
      return { type: OcgResponseType.SELECT_BATTLECMD, action: msg.to_ep ? 3 : 2, index: null }
    case MSG.SELECT_CHAIN:
      return { type: OcgResponseType.SELECT_CHAIN, index: msg.forced ? 0 : null }
    case MSG.SELECT_EFFECTYN:
      return { type: OcgResponseType.SELECT_EFFECTYN, yes: false }
    case MSG.SELECT_YESNO:
      return { type: OcgResponseType.SELECT_YESNO, yes: false }
    case MSG.SELECT_OPTION:
      return { type: OcgResponseType.SELECT_OPTION, index: 0 }
    case MSG.SELECT_CARD:
      return { type: OcgResponseType.SELECT_CARD, indicies: range(Math.max(1, msg.min)) }
    case MSG.SELECT_TRIBUTE:
      return { type: OcgResponseType.SELECT_TRIBUTE, indicies: range(Math.max(1, msg.min)) }
    case MSG.SELECT_UNSELECT_CARD:
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: msg.can_finish || !msg.select_cards.length ? null : 0 }
    case MSG.SELECT_PLACE:
      return { type: OcgResponseType.SELECT_PLACE, places: firstPlaces(msg, msg.count || 1) }
    case MSG.SELECT_DISFIELD:
      return { type: OcgResponseType.SELECT_DISFIELD, places: firstPlaces(msg, msg.count || 1) }
    case MSG.SELECT_POSITION: {
      for (const p of [1, 4, 2, 8]) if (msg.positions & p) return { type: OcgResponseType.SELECT_POSITION, position: p }
      return { type: OcgResponseType.SELECT_POSITION, position: 1 }
    }
    case MSG.SELECT_COUNTER: {
      let left = msg.count
      const counters = msg.cards.map(c => { const n = Math.min(c.count, left); left -= n; return n })
      return { type: OcgResponseType.SELECT_COUNTER, counters }
    }
    case MSG.SELECT_SUM:
      return { type: OcgResponseType.SELECT_SUM, indicies: sumPick(msg) }
    case MSG.SORT_CARD:
    case MSG.SORT_CHAIN:
      return { type: OcgResponseType.SORT_CARD, order: null }
    case MSG.ANNOUNCE_RACE: {
      const out = []
      for (let b = 1n; b <= msg.available && out.length < msg.count; b <<= 1n) if (msg.available & b) out.push(b)
      return { type: OcgResponseType.ANNOUNCE_RACE, races: out }
    }
    case MSG.ANNOUNCE_ATTRIB: {
      const out = []
      for (let b = 1; b <= msg.available && out.length < msg.count; b <<= 1) if (msg.available & b) out.push(b)
      return { type: OcgResponseType.ANNOUNCE_ATTRIB, attributes: out }
    }
    case MSG.ANNOUNCE_NUMBER:
      return { type: OcgResponseType.ANNOUNCE_NUMBER, value: 0 }
    case MSG.ANNOUNCE_CARD:
      return { type: OcgResponseType.ANNOUNCE_CARD, card: 89631139 }
    case MSG.ROCK_PAPER_SCISSORS:
      return { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: 1 }
    default:
      return null
  }
}

function sumValues(c) {
  const a = c.amount & 0xffff
  const b = (c.amount >>> 16) & 0xffff
  return b && b !== a ? [a, b] : [a]
}

function sumPick(msg) {
  const must = msg.selects_must || []
  const opts = msg.selects || []
  const base = must.reduce((s, c) => s + sumValues(c)[0], 0)
  const target = msg.amount
  const exact = msg.select_max === 0
  const n = Math.min(opts.length, 16)
  let best = null
  for (let m = 1; m < 1 << n; m++) {
    const picked = []
    for (let i = 0; i < n; i++) if (m & (1 << i)) picked.push(i)
    if (msg.max && picked.length > msg.max) continue
    if (picked.length < (msg.min || 0)) continue
    let sums = [base]
    for (const i of picked) sums = sums.flatMap(s => sumValues(opts[i]).map(v => s + v))
    const ok = exact ? sums.includes(target) : sums.some(s => s >= target)
    if (ok && (!best || picked.length < best.length)) best = picked
  }
  return best || []
}

const HOSTILE = new Set([502, 503, 505, 507, 520, 530, 549, 551, 575, 576])

function pickSide(msg, hint, n) {
  const order = msg.selects.map((c, i) => ({ c, i }))
  const hostile = HOSTILE.has(Number(hint || 0))
  order.sort((a, b) => {
    const ea = (a.c.controller !== msg.player) === hostile ? 0 : 1
    const eb = (b.c.controller !== msg.player) === hostile ? 0 : 1
    return ea - eb || a.i - b.i
  })
  return order.slice(0, n).map(x => x.i)
}

export function aiResponse(msg, memo, hint, ctx = {}) {
  const tried = (k) => memo.tried.get(k) || 0
  const mark = (k) => memo.tried.set(k, tried(k) + 1)
  switch (msg.type) {
    case MSG.SELECT_IDLECMD: {
      if (memo.acts < 14) {
        const groups = [['activates', 5], ['special_summons', 1], ['summons', 0], ['spell_sets', 4]]
        for (const [k, action] of groups) {
          const list = msg[k] || []
          for (let index = 0; index < list.length; index++) {
            const c = list[index]
            const key = `${action}:${c.code}:${c.location}:${String(c.description ?? '')}`
            if (tried(key) >= 2) continue
            if (action === 4 && memo.sets >= 2) continue
            mark(key)
            memo.acts++
            if (action === 4) memo.sets++
            return { type: 1, action, index }
          }
        }
        if (!memo.summoned && msg.monster_sets?.length) {
          memo.summoned = true
          return { type: 1, action: 3, index: 0 }
        }
      }
      if (msg.to_bp && memo.turn > 1) return { type: 1, action: 6, index: null }
      return { type: 1, action: msg.to_ep ? 7 : 6, index: null }
    }
    case MSG.SELECT_BATTLECMD: {
      for (let index = 0; index < msg.attacks.length; index++) {
        const c = msg.attacks[index]
        const key = `atk:${c.code}:${c.sequence}`
        if (tried(key) >= 1) continue
        mark(key)
        return { type: 0, action: 1, index }
      }
      return { type: 0, action: msg.to_m2 ? 2 : 3, index: null }
    }
    case MSG.SELECT_CHAIN: {
      if (!msg.selects.length) return { type: 8, index: null }
      if (msg.forced) return { type: 8, index: 0 }
      const links = ctx.chainBy || []
      const last = links.length ? links[links.length - 1] : null
      const own = last === msg.player
      const triggers = msg.spe_count > 0
      const odds = triggers ? 1 : own ? 0.6 : last != null ? 1 : 0.5
      for (let index = 0; index < msg.selects.length; index++) {
        const c = msg.selects[index]
        if (own && ctx.negates?.(c.code, c.description)) continue
        const key = `chain:${c.code}:${c.location}:${String(c.description ?? '')}`
        if (tried(key) >= 2) continue
        if (Math.random() < odds) { mark(key); return { type: 8, index } }
      }
      return { type: 8, index: null }
    }
    case MSG.SELECT_EFFECTYN:
      return { type: OcgResponseType.SELECT_EFFECTYN, yes: true }
    case MSG.SELECT_YESNO:
      return { type: OcgResponseType.SELECT_YESNO, yes: true }
    case MSG.SELECT_CARD:
      return { type: OcgResponseType.SELECT_CARD, indicies: pickSide(msg, hint, Math.max(1, msg.min)) }
    case MSG.SELECT_TRIBUTE:
      return { type: OcgResponseType.SELECT_TRIBUTE, indicies: pickSide(msg, hint, Math.max(1, msg.min)) }
    case MSG.SELECT_UNSELECT_CARD: {
      if (msg.can_finish || !msg.select_cards.length) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null }
      const hostile = HOSTILE.has(Number(hint || 0))
      const i = msg.select_cards.findIndex(c => (c.controller !== msg.player) === hostile)
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: i >= 0 ? i : 0 }
    }
    default:
      return autoResponse(msg)
  }
}

export function isPrompt(msg) {
  return !!msg && PROMPTS.has(msg.type)
}

function chainNegators(src) {
  const out = []
  const live = new Map()
  const flush = (v) => {
    const e = live.get(v)
    if (e && /NEGATE|DISABLE|DESTROY|REMOVE|TODECK|TOHAND|TOGRAVE|CONTROL|RELEASE/.test(e.cat) && /EVENT_CHAINING/.test(e.code)) out.push(e.desc)
  }
  for (const line of String(src || '').split('\n')) {
    let m = /^\s*(?:local\s+)?(\w+)\s*=\s*Effect\.CreateEffect\(/.exec(line)
    if (m) { flush(m[1]); live.set(m[1], { cat: '', code: '', desc: null }); continue }
    m = /^\s*(?:local\s+)?(\w+)\s*=\s*(\w+):Clone\(\)/.exec(line)
    if (m) { flush(m[1]); live.set(m[1], { ...(live.get(m[2]) || { cat: '', code: '', desc: null }) }); continue }
    m = /^\s*(\w+):SetCategory\((.*)\)/.exec(line)
    if (m && live.has(m[1])) { live.get(m[1]).cat = m[2]; continue }
    m = /^\s*(\w+):SetCode\((.*)\)/.exec(line)
    if (m && live.has(m[1])) { live.get(m[1]).code = m[2]; continue }
    m = /^\s*(\w+):SetDescription\(aux\.Stringid\(id,\s*(\d+)\)\)/.exec(line)
    if (m && live.has(m[1])) live.get(m[1]).desc = Number(m[2])
  }
  for (const v of live.keys()) flush(v)
  return out
}

function shuffled(list, seed) {
  let x = BigInt.asUintN(64, seed || 1n) || 1n
  const next = () => {
    x ^= BigInt.asUintN(64, x << 13n)
    x ^= x >> 7n
    x ^= BigInt.asUintN(64, x << 17n)
    return Number(x % 4294967296n) / 4294967296
  }
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function createDuel(lib, { seed, decks, readCard, readScript, onError, onResponse, startLP = 8000, hand = 5, hands = null }) {
  seed = seed || randomSeed()
  const fixedOf = decks.map((deck, team) => {
    const pool = [...deck.main]
    return (hands?.[team]?.fixed || []).map(Number).filter(code => {
      const i = pool.indexOf(code)
      if (i < 0) return false
      pool.splice(i, 1)
      return true
    }).slice(0, hands?.[team]?.n ?? hand)
  })
  const drawOf = (team) => Math.max(0, (hands?.[team]?.n ?? hand) - fixedOf[team].length)
  const handle = lib.createDuel({
    flags: OcgDuelMode.MODE_MR5,
    seed,
    team1: { startingLP: startLP, startingDrawCount: drawOf(0), drawCountPerTurn: 1 },
    team2: { startingLP: startLP, startingDrawCount: drawOf(1), drawCountPerTurn: 1 },
    cardReader: (code) => toCardData(code, readCard(code)),
    scriptReader: (name) => {
      try { return readScript(name) } catch (e) { onError?.('script', `${name}: ${e.message}`); return null }
    },
    errorHandler: (type, text) => onError?.(type, text),
  })
  if (!handle) throw new Error('createDuel failed')
  for (const name of ['constant.lua', 'utility.lua']) {
    const src = readScript(name)
    if (src) lib.loadScript(handle, name, src)
  }
  lib.loadScript(handle, 'fuwa_shim.lua', SHIM)
  decks.forEach((deck, team) => {
    const main = [...deck.main]
    for (const code of fixedOf[team]) {
      main.splice(main.indexOf(code), 1)
      lib.duelNewCard(handle, { team, duelist: 0, code, controller: team, location: LOC.HAND, sequence: 0, position: 8 })
    }
    for (const code of shuffled(main, seed[team + 1])) lib.duelNewCard(handle, { team, duelist: 0, code, controller: team, location: LOC.DECK, sequence: 0, position: 8 })
    for (const code of deck.extra) lib.duelNewCard(handle, { team, duelist: 0, code, controller: team, location: LOC.EXTRA, sequence: 0, position: 8 })
  })
  lib.startDuel(handle)

  const state = { lp: [startLP, startLP], turn: 0, turnPlayer: 0, phase: 0, ended: false, winner: null, lastPrompt: null, hint: null, hints: [null, null], chain: [], chainBy: [] }
  const memo = { turn: -1, acts: 0, sets: 0, summoned: false, tried: new Map() }
  const negCache = new Map()
  function negates(code, description) {
    const base = readCard(code)?.[0] || code
    let list = negCache.get(base)
    if (!list) {
      try { list = chainNegators(readScript(`c${base}.lua`)) } catch { list = [] }
      negCache.set(base, list)
    }
    if (!list.length) return false
    const d = BigInt(description ?? 0)
    if (d < 1048576000n) return true
    const k = Number(d & 0xfffffn)
    return list.some(x => x == null || x === k)
  }

  function track(m) {
    switch (m.type) {
      case MSG.NEW_TURN: state.turn++; state.turnPlayer = m.player; break
      case MSG.NEW_PHASE: state.phase = m.phase; break
      case MSG.LPUPDATE: state.lp[m.player] = m.lp; break
      case MSG.DAMAGE: case MSG.PAY_LPCOST: state.lp[m.player] = Math.max(0, state.lp[m.player] - m.amount); break
      case MSG.RECOVER: state.lp[m.player] += m.amount; break
      case MSG.WIN: state.ended = true; state.winner = m.player; break
      case MSG.CHAINING: state.chain.push(m.code); state.chainBy.push(m.triggering_controller ?? m.controller); break
      case MSG.CHAIN_END: state.chain = []; state.chainBy = []; break
      case MSG.HINT:
        if (m.hint_type === 3) state.hints[m.player] = m.hint
        break
    }
  }

  function respondAuto(prompt, opts = {}) {
    if (!opts.ai || prompt.retry) return autoResponse(prompt)
    if (memo.turn !== state.turn) Object.assign(memo, { turn: state.turn, acts: 0, sets: 0, summoned: false, tried: new Map() })
    const hint = state.hints[prompt.player]
    state.hints[prompt.player] = null
    return aiResponse(prompt, memo, hint, { chainBy: state.chainBy, negates })
  }

  function setResp(r) {
    onResponse?.(r)
    lib.duelSetResponse(handle, r)
  }

  function fastForward(list) {
    let i = 0
    for (let guard = 0; guard < 1000000; guard++) {
      const status = lib.duelProcess(handle)
      const msgs = lib.duelGetMessage(handle)
      let prompt = null
      for (const m of msgs) {
        track(m)
        if (isPrompt(m)) prompt = m
        else if (m.type === MSG.RETRY) prompt = state.lastPrompt && { ...state.lastPrompt, retry: true }
      }
      if (status === OcgProcessResult.END || state.ended) { state.ended = true; return null }
      if (status === OcgProcessResult.CONTINUE || !prompt) continue
      state.lastPrompt = prompt
      if (i < list.length) { setResp(list[i++]); continue }
      return prompt
    }
    throw new Error('fast-forward overflow')
  }

  function run(response, autoPlayers = [1], opts = {}) {
    const log = []
    if (response) setResp(response)
    for (let guard = 0; guard < 100000; guard++) {
      const status = lib.duelProcess(handle)
      const msgs = lib.duelGetMessage(handle)
      let prompt = null
      for (const m of msgs) {
        track(m)
        if (isPrompt(m)) prompt = m
        else if (m.type === MSG.RETRY) prompt = state.lastPrompt && { ...state.lastPrompt, retry: true }
        else log.push(m)
      }
      if (status === OcgProcessResult.END || state.ended) { state.ended = true; return { log, prompt: null } }
      if (status === OcgProcessResult.CONTINUE) {
        if (opts.pause && state.turn > 0 && msgs.some(m => STEP_MSGS.has(m.type))) return { log, prompt: null, cont: true }
        continue
      }
      if (!prompt) continue
      state.lastPrompt = prompt
      if (autoPlayers.includes(prompt.player)) {
        if (opts.pause && log.some(m => PAUSE_MSGS.has(m.type))) return { log, prompt: null, auto: prompt }
        setResp(respondAuto(prompt, opts))
        continue
      }
      const hint = state.hints[prompt.player]
      state.hints[prompt.player] = null
      return { log, prompt: { ...prompt, hint } }
    }
    throw new Error('process loop overflow')
  }

  function board() {
    const side = (p) => {
      const q = (location) => lib.duelQueryLocation(handle, { flags: QFLAGS, controller: p, location })
        .map(c => (c && c.code ? { ...c, type: readCard(c.code)?.[2] || 0 } : c))
      return {
        deck: lib.duelQueryCount(handle, p, LOC.DECK),
        deckList: q(LOC.DECK),
        hand: q(LOC.HAND),
        mzone: q(LOC.MZONE),
        szone: q(LOC.SZONE),
        grave: q(LOC.GRAVE),
        removed: q(LOC.REMOVED),
        extra: q(LOC.EXTRA),
      }
    }
    return { players: [side(0), side(1)], lp: [...state.lp], turn: state.turn, turnPlayer: state.turnPlayer, phase: state.phase, chain: [...state.chain], ended: state.ended, winner: state.winner }
  }

  return { run, board, respondAuto, fastForward, destroy: () => lib.destroyDuel(handle), state, seed }
}
