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

const OP = 0x4000000000000000n
const OPS = {
  [OP + 0x000000000n]: 'add', [OP + 0x100000000n]: 'sub', [OP + 0x200000000n]: 'mul', [OP + 0x300000000n]: 'div',
  [OP + 0x400000000n]: 'and', [OP + 0x500000000n]: 'or', [OP + 0x600000000n]: 'neg', [OP + 0x700000000n]: 'not',
  [OP + 0x800000000n]: 'band', [OP + 0x900000000n]: 'bor', [OP + 0x1000000000n]: 'bnot', [OP + 0x1100000000n]: 'bxor',
  [OP + 0x1200000000n]: 'shl', [OP + 0x1300000000n]: 'shr', [OP + 0x1400000000n]: 'alias', [OP + 0x1500000000n]: 'token',
  [OP + 0x10000000000n]: 'iscode', [OP + 0x10100000000n]: 'isset', [OP + 0x10200000000n]: 'istype', [OP + 0x10300000000n]: 'israce',
  [OP + 0x10400000000n]: 'isattr', [OP + 0x10500000000n]: 'code', [OP + 0x10700000000n]: 'type', [OP + 0x10800000000n]: 'race',
  [OP + 0x10900000000n]: 'attr',
}

export function declarable(code, row, opcodes) {
  if (!row) return false
  const st = []
  const b = (v) => (v ? 1n : 0n)
  const i64 = (v) => BigInt.asIntN(64, v)
  const type = BigInt(row[2]), race = BigInt(row[5]), attr = BigInt(row[4]), cd = BigInt(code)
  let alias = false
  let token = false
  for (const raw of opcodes || []) {
    const op = BigInt(raw)
    const k = OPS[op]
    const two = (f) => { if (st.length >= 2) { const r = st.pop(); const l = st.pop(); st.push(i64(f(l, r))) } }
    const one = (f) => { if (st.length >= 1) st.push(i64(f(st.pop()))) }
    switch (k) {
      case 'add': two((l, r) => l + r); break
      case 'sub': two((l, r) => l - r); break
      case 'mul': two((l, r) => l * r); break
      case 'div': two((l, r) => (r ? l / r : 0n)); break
      case 'and': two((l, r) => b(l && r)); break
      case 'or': two((l, r) => b(l || r)); break
      case 'neg': one(v => -v); break
      case 'not': one(v => b(!v)); break
      case 'band': two((l, r) => l & r); break
      case 'bor': two((l, r) => l | r); break
      case 'bxor': two((l, r) => l ^ r); break
      case 'bnot': one(v => ~v); break
      case 'shl': two((l, r) => l << r); break
      case 'shr': two((l, r) => l >> r); break
      case 'iscode': one(v => b(cd === BigInt.asUintN(32, v))); break
      case 'istype': one(v => type & v); break
      case 'israce': one(v => race & v); break
      case 'isattr': one(v => attr & v); break
      case 'code': st.push(cd); break
      case 'type': st.push(type); break
      case 'race': st.push(race); break
      case 'attr': st.push(attr); break
      case 'isset': one((v) => {
        const sc = Number(BigInt.asIntN(32, v))
        const t = sc & 0xfff
        const sub = sc & 0xf000
        return b((row[1] || []).some(x => (x & 0xfff) === t && (x & 0xf000 & sub) === sub))
      }); break
      case 'alias': alias = true; break
      case 'token': token = true; break
      default: st.push(i64(op))
    }
  }
  if (st.length !== 1 || st[0] === 0n) return false
  return code === 17955766 || code === 17732278 || ((alias || !row[0]) && (token || (row[2] & 0x4001) !== 0x4001))
}

let rps = 0

export function autoResponse(msg, ctx = {}) {
  const range = (n) => Array.from({ length: n }, (_, i) => i)
  switch (msg.type) {
    case MSG.SELECT_IDLECMD:
      return { type: OcgResponseType.SELECT_IDLECMD, action: msg.to_ep ? 7 : 6, index: null }
    case MSG.SELECT_BATTLECMD:
      if (!msg.to_m2 && !msg.to_ep && msg.attacks.length) return { type: OcgResponseType.SELECT_BATTLECMD, action: 1, index: 0 }
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
    case MSG.ANNOUNCE_CARD: {
      const pool = [...(ctx.preferCodes?.() || []), ...(ctx.allCodes?.() || [])]
      const card = pool.find(c => declarable(c, ctx.card?.(c), msg.opcodes)) || 89631139
      return { type: OcgResponseType.ANNOUNCE_CARD, card }
    }
    case MSG.ROCK_PAPER_SCISSORS:
      return { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: ((rps++ + msg.player) % 3) + 1 }
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
const COSTLY = new Set([500, 501, 504, 519, 531])
const SUMMONED = new Set([61, 63, 65])

function threat(c, ctx) {
  if (!c) return 0
  const q = c.controller != null && c.location === LOC.MZONE ? ctx.mz?.(c.controller)?.[c.sequence] : null
  const row = ctx.card?.(c.code)
  if (q && q.position & 5) return 1000 + (q.attack || 0)
  if (q) return 900 + (row?.[6] || 0) / 2
  if (c.location === LOC.SZONE) return 800
  if (c.location === LOC.MZONE) return 900 + (row?.[6] || 0)
  return (row?.[6] || 0) / 10
}

function worth(c, ctx) {
  const row = ctx.card?.(c.code)
  if (!row) return 0
  if (row[2] & 1) return (row[6] || 0) + (row[3] & 0xff) * 50
  return 1200
}

function pickSide(msg, hint, n, ctx = {}) {
  const h = Number(hint || 0)
  const hostile = HOSTILE.has(h)
  const costly = COSTLY.has(h)
  const order = msg.selects.map((c, i) => ({ c, i }))
  const foe = (c) => c.controller !== msg.player
  order.sort((a, b) => {
    const ea = foe(a.c) === hostile ? 0 : 1
    const eb = foe(b.c) === hostile ? 0 : 1
    if (ea !== eb) return ea - eb
    if (hostile && h === 549 && ctx.attacker != null) return beat(b.c, ctx) - beat(a.c, ctx) || a.i - b.i
    if (hostile) return threat(b.c, ctx) - threat(a.c, ctx) || a.i - b.i
    if (costly) return worth(a.c, ctx) - worth(b.c, ctx) || a.i - b.i
    return worth(b.c, ctx) - worth(a.c, ctx) || a.i - b.i
  })
  return order.slice(0, n).map(x => x.i)
}

function guard(q, ctx) {
  if (!q) return 0
  if (q.position & 1) return q.attack || 0
  if (q.position & 4) return q.defense || 0
  return ctx.hiddenDef ?? 1600
}

function beat(c, ctx) {
  const q = ctx.mz?.(c.controller)?.[c.sequence]
  const g = guard(q, ctx)
  return ctx.attacker > g ? 10000 + g : -g
}

function attackPlan(msg, ctx, tried) {
  const foes = (ctx.mz?.(1 - msg.player) || []).filter(Boolean)
  const mine = ctx.mz?.(msg.player) || []
  let best = null
  msg.attacks.forEach((c, index) => {
    if (tried(`atk:${c.code}:${c.sequence}`) >= 1) return
    const atk = mine[c.sequence]?.attack ?? (ctx.card?.(c.code)?.[6] || 0)
    let score
    if (!foes.length || c.can_direct) score = 5000 + atk
    else {
      const wins = foes.filter(q => atk > guard(q, ctx))
      if (!wins.length) return
      score = 1000 + Math.max(...wins.map(q => guard(q, ctx)))
    }
    if (!best || score > best.score) best = { index, atk, key: `atk:${c.code}:${c.sequence}`, score }
  })
  return best
}

function chainOdds(msg, ctx) {
  if (msg.spe_count > 0) return 1
  const links = ctx.chainBy || []
  const last = links.length ? links[links.length - 1] : null
  if (last != null) return last === msg.player ? 0.25 : 0.9
  if (ctx.turnPlayer === msg.player) return 0.35
  if (SUMMONED.has(ctx.window)) return 0.85
  if (ctx.window === 110) return 0.6
  return 0.04
}

export function aiResponse(msg, memo, hint, ctx = {}) {
  const tried = (k) => memo.tried.get(k) || 0
  const mark = (k) => memo.tried.set(k, tried(k) + 1)
  const rnd = ctx.random || Math.random
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
      const plan = attackPlan(msg, ctx, tried)
      if (plan) {
        mark(plan.key)
        memo.attacker = plan.atk
        return { type: 0, action: 1, index: plan.index }
      }
      for (let index = 0; index < (msg.chains || []).length; index++) {
        const c = msg.chains[index]
        const key = `bchain:${c.code}:${c.location}:${String(c.description ?? '')}`
        if (tried(key) >= 1) continue
        mark(key)
        return { type: 0, action: 0, index }
      }
      if (!msg.to_m2 && !msg.to_ep && msg.attacks.length) {
        memo.attacker = ctx.mz?.(msg.player)?.[msg.attacks[0].sequence]?.attack ?? 0
        return { type: 0, action: 1, index: 0 }
      }
      return { type: 0, action: msg.to_m2 ? 2 : 3, index: null }
    }
    case MSG.SELECT_CHAIN: {
      if (!msg.selects.length) return { type: 8, index: null }
      if (msg.forced) return { type: 8, index: 0 }
      const links = ctx.chainBy || []
      const own = links.length && links[links.length - 1] === msg.player
      const odds = chainOdds(msg, ctx)
      const order = msg.selects.map((c, index) => ({ c, index, neg: ctx.negates?.(c.code, c.description) }))
      if (!own) order.sort((a, b) => (b.neg ? 1 : 0) - (a.neg ? 1 : 0) || a.index - b.index)
      for (const { c, index, neg } of order) {
        if (own && neg) continue
        const key = `chain:${c.code}:${c.location}:${String(c.description ?? '')}`
        if (tried(key) >= 2) continue
        if (rnd() < odds) { mark(key); return { type: 8, index } }
      }
      return { type: 8, index: null }
    }
    case MSG.SELECT_EFFECTYN: {
      const key = `yn:${msg.code}:${String(msg.description ?? '')}`
      const yes = tried(key) < 3
      if (yes) mark(key)
      return { type: OcgResponseType.SELECT_EFFECTYN, yes }
    }
    case MSG.SELECT_YESNO: {
      const key = `yesno:${String(msg.description ?? '')}`
      const yes = tried(key) < 4
      if (yes) mark(key)
      return { type: OcgResponseType.SELECT_YESNO, yes }
    }
    case MSG.SELECT_CARD:
      return { type: OcgResponseType.SELECT_CARD, indicies: pickSide(msg, hint, Math.max(1, msg.min), { ...ctx, attacker: memo.attacker }) }
    case MSG.SELECT_TRIBUTE:
      return { type: OcgResponseType.SELECT_TRIBUTE, indicies: pickSide(msg, 500, Math.max(1, msg.min), ctx) }
    case MSG.SELECT_UNSELECT_CARD: {
      if (msg.can_finish || !msg.select_cards.length) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null }
      const [i] = pickSide({ ...msg, selects: msg.select_cards }, hint, 1, { ...ctx, attacker: memo.attacker })
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: i ?? 0 }
    }
    case MSG.SELECT_POSITION: {
      const row = ctx.card?.(msg.code)
      const foes = (ctx.mz?.(1 - msg.player) || []).filter(q => q && q.position & 5)
      const top = foes.length ? Math.max(...foes.map(q => q.attack || 0)) : 0
      const atk = row?.[6] || 0
      const def = row?.[7] || 0
      const wantAtk = !!(row?.[2] & 0x4000000) || atk >= top || atk >= def
      const order = wantAtk ? [1, 2, 4, 8] : [4, 8, 1, 2]
      for (const p of order) if (msg.positions & p) return { type: OcgResponseType.SELECT_POSITION, position: p }
      return autoResponse(msg)
    }
    default:
      return autoResponse(msg, ctx)
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

export function createDuel(lib, { seed, decks, readCard, readScript, onError, onResponse, allCodes = null, startLP = 8000, hand = 5, hands = null }) {
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
    if (m.type !== MSG.HINT) state.window = m.type
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
    if (!opts.ai || prompt.retry) return autoResponse(prompt, aiContext(prompt.player))
    if (memo.turn !== state.turn) Object.assign(memo, { turn: state.turn, acts: 0, sets: 0, summoned: false, tried: new Map() })
    const hint = state.hints[prompt.player]
    state.hints[prompt.player] = null
    return aiResponse(prompt, memo, hint, aiContext(prompt.player))
  }

  function aiContext(player = 0) {
    return {
      preferCodes: () => [...new Set([...decks[1 - player].main, ...decks[1 - player].extra])],
      allCodes,
      chainBy: state.chainBy,
      negates,
      window: state.window,
      turnPlayer: state.turnPlayer,
      card: readCard,
      mz: (p) => lib.duelQueryLocation(handle, { flags: OcgQueryFlags.CODE | OcgQueryFlags.POSITION | OcgQueryFlags.ATTACK | OcgQueryFlags.DEFENSE, controller: p, location: LOC.MZONE }),
    }
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
    let retries = 0
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
        retries = prompt.retry ? retries + 1 : 0
        if (retries > 40) throw new Error(`auto response rejected (${prompt.type})`)
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

  return { run, board, respondAuto, aiContext, fastForward, destroy: () => lib.destroyDuel(handle), state, seed }
}
