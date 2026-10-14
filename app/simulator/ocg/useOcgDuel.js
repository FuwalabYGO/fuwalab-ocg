'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isExtraDeckCard, isPendulumCard, tL, simLang, effectiveAtk, effectiveDef, OCG_PILES } from '../gameEngine'
import { SYS_FR, LOC_FR } from './sysFr'
import { stateChecksum } from '../replay'

export const OCG_RES = '/simulator/ocg/res/'
export const LOC = { DECK: 1, HAND: 2, MZONE: 4, SZONE: 8, GRAVE: 16, REMOVED: 32, EXTRA: 64, OVERLAY: 128 }
const PHASE_KEY = { 1: 'DP', 2: 'SP', 4: 'M1', 8: 'BP', 16: 'BP', 32: 'BP', 64: 'BP', 128: 'BP', 256: 'M2', 512: 'EP' }
const LISTS = [[LOC.DECK, 'deckList'], [LOC.HAND, 'hand'], [LOC.MZONE, 'mzone'], [LOC.SZONE, 'szone'], [LOC.GRAVE, 'grave'], [LOC.REMOVED, 'removed'], [LOC.EXTRA, 'extra']]
const PROGRESS_MSGS = new Set([50, 53, 54, 60, 62, 64, 70, 100])
const PILE = { [LOC.DECK]: 'mainDeck', [LOC.HAND]: 'hand', [LOC.GRAVE]: 'graveyard', [LOC.REMOVED]: 'banished', [LOC.EXTRA]: 'extraDeck' }

let VIEW = 0
let ME = 0
const keyOf = (c) => `${c.controller}:${c.location}:${c.sequence}`
const normLoc = (l) => (l & LOC.OVERLAY ? LOC.OVERLAY : l)
const oppName = (name) => `opp${name[0].toUpperCase()}${name.slice(1)}`

export function simPlace(p, loc, seq, view = VIEW) {
  const mine = p === view
  const side = mine ? 'field' : 'oppField'
  if (loc === LOC.MZONE) {
    if (seq < 5) return { location: side, zone: `monster${seq}` }
    return { location: side, zone: `emz${mine ? seq - 5 : 6 - seq}` }
  }
  if (loc === LOC.SZONE) {
    if (seq < 5) return { location: side, zone: `st${seq}` }
    if (seq === 5) return { location: side, zone: 'fieldZone' }
    return null
  }
  const pile = PILE[loc]
  return pile ? { location: mine ? pile : oppName(pile) } : null
}

export function ocgPlace(location, zone) {
  const p = location === 'oppField' ? 1 - VIEW : VIEW
  let m = /^monster(\d)$/.exec(zone)
  if (m) return [`${p}:4:${m[1]}`]
  m = /^st(\d)$/.exec(zone)
  if (m) return [`${p}:8:${m[1]}`]
  if (zone === 'fieldZone') return [`${p}:8:5`]
  m = /^emz(\d)$/.exec(zone)
  if (m) return m[1] === '0' ? [`${VIEW}:4:5`, `${1 - VIEW}:4:6`] : [`${VIEW}:4:6`, `${1 - VIEW}:4:5`]
  return []
}

function frameOf(type) {
  if (type & 2) return 'spell'
  if (type & 4) return 'trap'
  if (type & 0x40) return 'fusion'
  if (type & 0x2000) return 'synchro'
  if (type & 0x800000) return 'xyz'
  if (type & 0x4000000) return 'link'
  if (type & 0x80) return 'ritual'
  if (type & 0x4000) return 'token'
  if (type & 0x20) return 'effect'
  return 'normal'
}

function slotsOf(board) {
  const out = []
  board.players.forEach((pl, p) => {
    for (const [loc, name] of LISTS) {
      (pl[name] || []).forEach((q, seq) => {
        if (!q?.code) return
        const key = `${p}:${loc}:${seq}`
        out.push({ key, p, loc, seq, code: q.code, q })
        if (loc === LOC.MZONE) (q.overlayCards || []).forEach((c, i) => out.push({ key: `${key}:o${i}`, p, loc: LOC.OVERLAY, seq: i, code: c, host: key }))
      })
    }
  })
  return out
}

function assignUids(prev, slots, moves, mint) {
  const out = new Map()
  const used = new Set()
  for (const sl of slots) {
    const old = prev.get(sl.key)
    if (old && old.code === sl.code && !used.has(old.uid)) { out.set(sl.key, old.uid); used.add(old.uid) }
  }
  const byCode = new Map()
  for (const old of prev.values()) {
    if (used.has(old.uid)) continue
    if (!byCode.has(old.code)) byCode.set(old.code, [])
    byCode.get(old.code).push(old)
  }
  for (const sl of slots) {
    if (out.has(sl.key)) continue
    const list = (byCode.get(sl.code) || []).filter(o => !used.has(o.uid))
    const pick = list.find(o => moves.some(m => m.code === sl.code && m.from === o.loc && m.to === sl.loc))
      || list.find(o => o.loc === sl.loc) || list[0]
    const uid = pick ? pick.uid : mint()
    used.add(uid)
    out.set(sl.key, uid)
  }
  return out
}

const BASE_KEYS = ['id', 'name', '_frName', 'type', 'frameType', 'atk', 'def', 'level', 'race', 'attribute', 'linkval', 'linkmarkers', 'scale', 'alt_img_id']

function frameEncoder(deckIds) {
  const last = new Map()
  const base = (c) => {
    const b = {}
    for (const k of BASE_KEYS) if (c[k] != null) b[k] = c[k]
    if (c.card_images?.[0]?.id) b.card_images = [{ id: c.card_images[0].id }]
    return b
  }
  let full = new Map()
  const index = (st) => {
    const out = new Map()
    const add = (c) => { if (!c) return; out.set(c.uid, c); (c.overlayMaterials || []).forEach(add) }
    for (const key of OCG_PILES) (st[key] || []).forEach(add)
    for (const f of [st.field, st.oppField]) [...f.monsterZones, ...f.spellTrapZones, ...f.extraMonsterZones, f.fieldZone].forEach(add)
    return out
  }
  const enc = (c) => {
    if (!c) return 0
    const fc = full.get(c.uid) || c
    const id = Number(fc.id) || 0
    const hidden = !c.id && !!id
    const f = (c.position === 'DEF' ? 1 : 0) | (c.isFaceDown ? 2 : 0) | (c.owner === 'opp' ? 4 : 0) | (fc.isToken ? 16 : 0) | (hidden ? 32 : 0)
    const cnt = c.counters && Object.keys(c.counters).length ? c.counters : 0
    const mats = c.overlayMaterials?.length ? c.overlayMaterials.map(enc) : 0
    const b = !id ? (c.frameType || 'normal') : deckIds.has(id) ? 0 : base(fc)
    return [c.uid, id, f, effectiveAtk(c), effectiveDef(c), cnt, mats, b]
  }
  const field = (x) => ({ m: x.monsterZones.map(enc), s: x.spellTrapZones.map(enc), e: x.extraMonsterZones.map(enc), z: enc(x.fieldZone) })
  return (state, lines, extra, fullState) => {
    full = index(fullState || state)
    const vals = {
      h: [state.turn, state.phase, state.turnPlayer === 'opp' ? 1 : 0, state.lifePoints, state.oppLifePoints, state.sidesSwapped ? 1 : 0],
      field: field(state.field),
      oppField: field(state.oppField),
    }
    for (const key of OCG_PILES) vals[key] = (state[key] || []).map(enc)
    const k = {}
    for (const [key, v] of Object.entries(vals)) {
      const str = JSON.stringify(v)
      if (last.get(key) === str) continue
      last.set(key, str)
      k[key] = v
    }
    if (!Object.keys(k).length && !lines.length && !extra) return null
    if (extra && !Object.keys(k).length && !lines.length && Object.keys(extra).every(x => x === 'r')) return null
    return extra ? { k, l: lines, ...extra } : { k, l: lines }
  }
}

const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x)))

function buildState(board, uids, ctx) {
  const { cards, texts, controlBoth, log } = ctx
  const V = ctx.view ?? VIEW
  const base = (code, q) => cards.get(code) || { id: code, name: texts?.[code]?.[0] || '', frameType: frameOf(q?.type || 0), type: '' }
  const hiddenCard = (uid, owner, q, loc) => ({
    uid, owner, isFaceDown: true, position: loc === LOC.MZONE && (q?.position & 12) ? 'DEF' : 'ATK', frameType: frameOf(q?.type || 0),
    name: '', overlayMaterials: [], counters: {}, markers: {},
  })
  const make = (p, loc, seq, q, hide) => {
    const key = `${p}:${loc}:${seq}`
    const uid = uids.get(key)
    const rel = (x) => (x === V ? 'player' : 'opp')
    const owner = rel(p)
    if (hide) return hiddenCard(uid, owner, q, loc)
    let b = base(q.code, q)
    if ((loc === LOC.MZONE || (q.type || 0) & 1) && b.atk == null && q.attack != null) {
      b = { ...b, atk: q.attack, def: (q.type || 0) & 0x4000000 ? null : (q.defense ?? 0) }
      if (loc === LOC.MZONE && (q.type || 0) & 0x4000) b = { ...b, frameType: 'token', type: b.type || 'Token' }
    }
    const pos = q.position || 1
    const facedown = (loc === LOC.MZONE || loc === LOC.SZONE || loc === LOC.REMOVED) && !!(pos & 10)
    return {
      ...b,
      uid,
      owner: q.owner === 0 || q.owner === 1 ? rel(q.owner) : owner,
      position: loc === LOC.MZONE && pos & 12 ? 'DEF' : 'ATK',
      isFaceDown: facedown,
      fromExtraDeck: isExtraDeckCard(b),
      isPendulum: isPendulumCard(b),
      atkMod: 0,
      defMod: 0,
      atkOverride: b.atk != null && q.attack != null && q.attack !== b.atk ? q.attack : null,
      defOverride: b.def != null && q.defense != null && q.defense !== b.def ? q.defense : null,
      isToken: !!((q.type || 0) & 0x4000),
      overlayMaterials: (q.overlayCards || []).map((c, i) => ({ ...base(c), uid: uids.get(`${key}:o${i}`), owner, position: 'ATK', isFaceDown: false, overlayMaterials: [], counters: {}, markers: {} })),
      counters: q.counters ? { ...q.counters } : {},
      markers: {},
    }
  }
  const side = (p) => {
    const pl = board.players[p]
    const hid = p !== ME && !controlBoth
    const zone = (arr, loc, i) => (arr[i]?.code ? make(p, loc, i, arr[i], hid && !!(arr[i].position & 10)) : null)
    const emz = p === V ? [zone(pl.mzone, 4, 5), zone(pl.mzone, 4, 6)] : [zone(pl.mzone, 4, 6), zone(pl.mzone, 4, 5)]
    const list = (arr, loc, hide) => arr.map((q, i) => (q?.code ? make(p, loc, i, q, hide(q)) : null)).filter(Boolean)
    return {
      hand: list(pl.hand, LOC.HAND, () => hid),
      field: {
        monsterZones: [0, 1, 2, 3, 4].map(i => zone(pl.mzone, 4, i)),
        spellTrapZones: [0, 1, 2, 3, 4].map(i => zone(pl.szone, 8, i)),
        extraMonsterZones: emz,
        fieldZone: zone(pl.szone, 8, 5),
      },
      graveyard: list(pl.grave, LOC.GRAVE, () => false),
      banished: list(pl.removed, LOC.REMOVED, (q) => hid && !!(q.position & 10)),
      extraDeck: list(pl.extra, LOC.EXTRA, (q) => hid && !(q.position & 5)),
      mainDeck: list(pl.deckList || [], LOC.DECK, () => true),
    }
  }
  const a = side(V)
  const b = side(1 - V)
  return {
    isStarted: true,
    ...a,
    oppHand: b.hand,
    oppField: b.field,
    oppGraveyard: b.graveyard,
    oppBanished: b.banished,
    oppExtraDeck: b.extraDeck,
    oppMainDeck: b.mainDeck,
    lifePoints: board.lp[V],
    oppLifePoints: board.lp[1 - V],
    phase: PHASE_KEY[board.phase] || 'DP',
    turn: Math.max(1, board.turn),
    turnPlayer: board.turnPlayer === V ? 'player' : 'opp',
    sidesSwapped: V === 1,
    log,
    recMeta: null,
    rec: [],
  }
}

export function useOcgDuel({ dispatch, fxActionsRef, onDeclare, fxRemaining }) {
  const [active, setActive] = useState(false)
  const [prompt, setPrompt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState([])
  const [places, setPlaces] = useState([])
  const [errors, setErrors] = useState([])
  const [ended, setEnded] = useState(null)
  const [controlBoth, setControlBothState] = useState(false)
  const [quietChains, setQuietChainsState] = useState(true)
  const [aiOpp, setAiOppState] = useState(true)
  const [keyByUid, setKeyByUid] = useState(new Map())
  const [chain, setChain] = useState([])
  const [banner, setBanner] = useState(null)
  const [loadStep, setLoadStep] = useState(null)
  const readyRef = useRef(null)
  const chainRef = useRef([])
  const [texts, setTexts] = useState(null)
  const [strings, setStrings] = useState(null)
  const workerRef = useRef(null)
  const cardsRef = useRef(new Map())
  const prevRef = useRef(new Map())
  const uidsRef = useRef(new Map())
  const boardRef = useRef(null)
  const logRef = useRef([])
  const seqRef = useRef(0)
  const firstRef = useRef(false)
  const initRef = useRef(null)
  const encRef = useRef(null)
  const metaRef = useRef(null)
  const respRef = useRef([])
  const forkRef = useRef(false)

  const frameOf = (state, lines, fullState, events) => {
    if (!encRef.current) return null
    const extra = {}
    if (events?.length) extra.x = events
    if (respRef.current.length) extra.r = jsonSafe(respRef.current)
    if (metaRef.current && !metaRef.current.done) extra.o = { seed: metaRef.current.seed, decks: metaRef.current.decks, ...(metaRef.current.hands ? { hands: metaRef.current.hands } : {}), ...(ME ? { me: ME } : {}) }
    const frame = encRef.current(state, lines, Object.keys(extra).length ? extra : null, fullState)
    if (frame) {
      respRef.current = []
      if (extra.o) metaRef.current.done = true
    }
    return frame
  }
  const askedRef = useRef(new Set())
  const textsRef = useRef(null)
  const ctlRef = useRef({ controlBoth: false, quietChains: true, aiOpp: true, reveal: false, me: 0 })
  const onDeclareRef = useRef(onDeclare)
  onDeclareRef.current = onDeclare
  const fxRemainingRef = useRef(fxRemaining)
  fxRemainingRef.current = fxRemaining
  const ackRef = useRef(null)
  const progressRef = useRef(0)

  const scheduleNext = useCallback((wait) => {
    clearInterval(ackRef.current)
    const t0 = performance.now()
    ackRef.current = setInterval(() => {
      const spent = performance.now() - t0
      const left = Math.min(fxRemainingRef.current?.() || 0, 2500 - spent)
      if (spent < wait || left > 0) return
      clearInterval(ackRef.current)
      ackRef.current = null
      workerRef.current?.postMessage({ t: 'next' })
    }, 30)
  }, [])

  useEffect(() => () => { clearInterval(ackRef.current); workerRef.current?.terminate() }, [])

  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(b => (b?.id === banner.id ? null : b)), 1800)
    return () => clearTimeout(t)
  }, [banner])

  const build = (board, uids, log) => {
    const ctx = { cards: cardsRef.current, texts: textsRef.current, log }
    const shown = ctlRef.current.controlBoth || ctlRef.current.reveal
    const canon = buildState(board, uids, { ...ctx, controlBoth: false, view: ME })
    const full = buildState(board, uids, { ...ctx, controlBoth: true, view: ME })
    const state = { ...buildState(board, uids, { ...ctx, controlBoth: shown }), ocgCanon: stateChecksum(canon) }
    return { state, full, canon }
  }

  const loadTexts = useCallback(async () => {
    if (textsRef.current) return
    try {
      const [t, st] = await Promise.all([fetch(OCG_RES + 'texts.json').then(r => r.json()), fetch(OCG_RES + 'strings.json').then(r => r.json())])
      textsRef.current = t
      setTexts(t)
      setStrings(st)
    } catch (e) {
      console.warn('[ocg] textes', e)
    }
  }, [])

  const cardOf = useCallback((code) => cardsRef.current.get(code) || { id: code, name: textsRef.current?.[code]?.[0] || '' }, [])

  const nm = useCallback((code) => {
    const c = cardsRef.current.get(code)
    return c?._frName || c?.name || textsRef.current?.[code]?.[0] || `#${code}`
  }, [])

  const locName = useCallback((loc) => {
    const l = Number(loc) || 0
    const bit = l & 0x200 ? 0x200 : l & 0x100 ? 0x100 : normLoc(l & 0xff)
    if (!bit) return ''
    if (simLang() === 'fr') return LOC_FR[bit] || ''
    const idx = { 1: 0, 2: 1, 4: 2, 8: 3, 16: 4, 32: 5, 64: 6, 128: 7, 256: 8, 512: 9 }[bit]
    return strings?.system?.[1000 + idx] || ''
  }, [strings])

  const desc = useCallback((d, card, loc) => {
    const v = BigInt(d ?? 0)
    let out
    if (v < 1048576000n) {
      const n = Number(v)
      out = !n ? tL('Activer', 'Activate', 'Activar') : (simLang() === 'fr' && SYS_FR[n]) || strings?.system?.[n] || (n > 10000 ? nm(n) : `#${n}`)
    } else {
      const c = Number(v >> 20n)
      const i = Number(v & 0xfffffn)
      out = textsRef.current?.[c]?.[1]?.[i] || (i ? tL(`Effet ${i + 1}`, `Effect ${i + 1}`, `Efecto ${i + 1}`) : tL('Activer', 'Activate', 'Activar'))
    }
    if (!card) return out
    let k = 0
    return out.replace(/\[%ls\]/g, '%ls').replace(/%ls/g, () => (k++ === 0 ? nm(card) : locName(loc)))
  }, [strings, nm, locName])

  const logLine = useCallback((m, codeAt) => {
    const who = (p) => (p === ME ? tL('Toi', 'You', 'Tú') : tL('Adv.', 'Opp.', 'Rival'))
    const open = (p) => p === ME || ctlRef.current.controlBoth || ctlRef.current.reveal
    const cardAt = (c) => { const code = c && codeAt?.(c); return code ? nm(code) : tL('une carte', 'a card', 'una carta') }
    switch (m.type) {
      case 41: {
        const ph = { 1: ['Draw Phase', 'Draw Phase', 'Fase de Robo'], 2: ['Standby Phase', 'Standby Phase', 'Fase de Espera'], 4: ['Main Phase 1', 'Main Phase 1', 'Fase Principal 1'], 8: ['Battle Phase', 'Battle Phase', 'Fase de Batalla'], 256: ['Main Phase 2', 'Main Phase 2', 'Fase Principal 2'], 512: ['End Phase', 'End Phase', 'Fase Final'] }[m.phase]
        return ph ? [tL(...ph), 'phase'] : null
      }
      case 40: return [tL(`Tour de ${who(m.player)}`, `${who(m.player)} turn`, `Turno: ${who(m.player)}`), 'system']
      case 90: return [tL(`${who(m.player)} pioche ${m.drawn?.length || 1} carte(s)`, `${who(m.player)} draws ${m.drawn?.length || 1} card(s)`, `${who(m.player)} roba ${m.drawn?.length || 1} carta(s)`), 'action']
      case 60: return [tL(`Invocation Normale : ${nm(m.code)}`, `Normal Summon: ${nm(m.code)}`, `Invocación Normal: ${nm(m.code)}`), 'action']
      case 62: return [tL(`Invocation Spéciale : ${nm(m.code)}`, `Special Summon: ${nm(m.code)}`, `Invocación Especial: ${nm(m.code)}`), 'action']
      case 64: return [tL(`Invocation Flip : ${nm(m.code)}`, `Flip Summon: ${nm(m.code)}`, `Invocación por Volteo: ${nm(m.code)}`), 'action']
      case 70: return [tL(`Chain Link ${m.chain_size} : ${nm(m.code)}`, `Chain Link ${m.chain_size}: ${nm(m.code)}`, `Eslabón ${m.chain_size}: ${nm(m.code)}`), 'action']
      case 75: return [tL(`Chain Link ${m.chain_size} annulé`, `Chain Link ${m.chain_size} negated`, `Eslabón ${m.chain_size} negado`), 'action']
      case 91: return [tL(`${who(m.player)} perd ${m.amount} LP`, `${who(m.player)} loses ${m.amount} LP`, `${who(m.player)} pierde ${m.amount} LP`), 'action']
      case 92: return [tL(`${who(m.player)} gagne ${m.amount} LP`, `${who(m.player)} gains ${m.amount} LP`, `${who(m.player)} gana ${m.amount} LP`), 'action']
      case 100: return [tL(`${who(m.player)} paie ${m.amount} LP`, `${who(m.player)} pays ${m.amount} LP`, `${who(m.player)} paga ${m.amount} LP`), 'action']
      case 5: return [m.player === ME ? tL('Victoire', 'Victory', 'Victoria') : tL('Défaite', 'Defeat', 'Derrota'), 'system']
      case 54: return [open(m.controller) ? tL(`Pose : ${nm(m.code)}`, `Set: ${nm(m.code)}`, `Coloca: ${nm(m.code)}`) : tL(`${who(m.controller)} pose une carte`, `${who(m.controller)} sets a card`, `${who(m.controller)} coloca una carta`), 'action']
      case 53: {
        if (!m.code || (m.prev_position & 10 && !(m.position & 10))) return null
        const def = m.position & 12
        return [tL(`${nm(m.code)} passe en ${def ? 'Défense' : 'Attaque'}`, `${nm(m.code)} switches to ${def ? 'Defense' : 'Attack'}`, `${nm(m.code)} pasa a ${def ? 'Defensa' : 'Ataque'}`), 'action']
      }
      case 110: return m.card ? [m.target
        ? tL(`${cardAt(m.card)} attaque ${cardAt(m.target)}`, `${cardAt(m.card)} attacks ${cardAt(m.target)}`, `${cardAt(m.card)} ataca a ${cardAt(m.target)}`)
        : tL(`${cardAt(m.card)} attaque directement`, `${cardAt(m.card)} attacks directly`, `${cardAt(m.card)} ataca directamente`), 'action'] : null
      case 130: return [tL(`Pile ou face : ${m.results.map(r => (r ? 'Face' : 'Pile')).join(', ')}`, `Coin toss: ${m.results.map(r => (r ? 'Heads' : 'Tails')).join(', ')}`, `Moneda: ${m.results.map(r => (r ? 'Cara' : 'Cruz')).join(', ')}`), 'system']
      case 131: return [tL(`Lancer de dé : ${m.results.join(', ')}`, `Die roll: ${m.results.join(', ')}`, `Dado: ${m.results.join(', ')}`), 'system']
      case 31: return m.cards?.length ? [tL(`Révélée(s) : ${m.cards.map(c => nm(c.code)).join(', ')}`, `Revealed: ${m.cards.map(c => nm(c.code)).join(', ')}`, `Revelada(s): ${m.cards.map(c => nm(c.code)).join(', ')}`), 'action'] : null
      case 83: return m.cards?.length ? [tL(`Ciblée(s) : ${m.cards.map(cardAt).join(', ')}`, `Targeted: ${m.cards.map(cardAt).join(', ')}`, `Objetivo(s): ${m.cards.map(cardAt).join(', ')}`), 'action'] : null
      case 32: return [tL(`${who(m.player)} mélange son Deck`, `${who(m.player)} shuffles their Deck`, `${who(m.player)} baraja su Deck`), 'system']
      case 50: {
        const from = normLoc(m.from.location)
        const to = normLoc(m.to.location)
        if (!m.card || from === to || from === LOC.OVERLAY) return null
        const where = {
          [LOC.GRAVE]: tL('au Cimetière', 'to the GY', 'al Cementerio'),
          [LOC.REMOVED]: m.to.position & 10 ? tL('bannie face verso', 'banished face-down', 'desterrada boca abajo') : tL('bannie', 'banished', 'desterrada'),
          [LOC.HAND]: tL('ajoutée à la main', 'added to the hand', 'añadida a la mano'),
          [LOC.DECK]: tL('renvoyée dans le Deck', 'returned to the Deck', 'devuelta al Deck'),
          [LOC.EXTRA]: tL("renvoyée dans l'Extra Deck", 'returned to the Extra Deck', 'devuelta al Extra Deck'),
        }[to]
        if (!where) return null
        const hidden = !open(m.to.controller) && (to === LOC.HAND || (to === LOC.REMOVED && m.to.position & 10))
        return [`${hidden ? tL('Une carte', 'A card', 'Una carta') : nm(m.card)} ${where}`, 'action']
      }
      default: return null
    }
  }, [nm])

  const sync = useCallback((board, msgs) => {
    if (msgs.some(m => PROGRESS_MSGS.has(m.type))) progressRef.current++
    const moves = []
    for (const m of msgs) {
      if (m.type === 50 && m.card) moves.push({ code: m.card, from: normLoc(m.from.location), to: normLoc(m.to.location) })
      if (m.type === 90) for (const d of m.drawn || []) moves.push({ code: d.code, from: LOC.DECK, to: LOC.HAND })
    }
    const slots = slotsOf(board)
    const uids = assignUids(prevRef.current, slots, moves, () => `ocg_${++seqRef.current}`)
    prevRef.current = new Map(slots.map(sl => [sl.key, { uid: uids.get(sl.key), code: sl.code, loc: sl.loc }]))
    uidsRef.current = uids
    boardRef.current = board
    setKeyByUid(new Map(slots.filter(sl => sl.loc !== LOC.OVERLAY).map(sl => [uids.get(sl.key), sl.key])))
    const time = new Date().toLocaleTimeString('fr-FR')
    const lines = []
    const codeIdx = new Map(slotsOf(board).map(sl => [sl.key, sl.code]))
    const codeAt = (c) => codeIdx.get(`${c.controller}:${normLoc(c.location)}:${c.sequence}`)
    for (const m of msgs) {
      const l = logLine(m, codeAt)
      if (l) lines.push({ id: `ocg_log_${++seqRef.current}`, message: l[0], type: l[1], time })
    }
    const chrono = lines.map(x => [x.message, x.type])
    logRef.current = [...lines.reverse(), ...logRef.current].slice(0, 3000)
    const { state, full, canon } = build(board, uids, logRef.current)
    const fxa = fxActionsRef.current
    if (!firstRef.current) {
      firstRef.current = true
      if (initRef.current && !forkRef.current) dispatch({ type: 'INIT_GAME', payload: { ...initRef.current, ocg: true } })
      else fxa.push({ type: 'INIT_GAME' })
    }
    const mineToHand = msgs.some(m => m.type === 50 && normLoc(m.to.location) === LOC.HAND && normLoc(m.from.location) !== LOC.HAND && (m.to.controller === VIEW || ctlRef.current.controlBoth))
    if (msgs.some(m => m.type === 90) || !mineToHand) fxa.push({ type: 'DRAW_CARD' })
    const PILE_OF = { [LOC.HAND]: 'hand', [LOC.GRAVE]: 'gy', [LOC.REMOVED]: 'ban', [LOC.EXTRA]: 'extra', [LOC.DECK]: 'deck' }
    const slotAt = (c) => slots.find(x => x.key === `${c.controller}:${normLoc(c.location)}:${c.sequence}`)
    const eventsFor = (view) => {
    const where = (sl, code, mode) => {
      if (!sl) return null
      const at = simPlace(sl.p, sl.loc, sl.seq, view)
      if (at?.zone) return { k: mode === 'target' ? 't' : 'd', l: at.location, z: at.zone }
      const pile = PILE_OF[sl.loc]
      return pile ? { k: 'p', u: uids.get(sl.key), p: pile, s: sl.p === view ? 'player' : 'opp', c: code ?? sl.code, m: mode } : null
    }
    const events = []
    for (const m of msgs) {
      if (m.type === 70) {
        const sl = slots.find(x => x.key === `${m.controller}:${m.location}:${m.sequence}` && x.code === m.code)
          || slots.find(x => x.p === m.controller && x.code === m.code && x.loc !== LOC.DECK && x.loc !== LOC.OVERLAY)
        const e = where(sl, m.code, 'declare')
        if (e) events.push(e)
      } else if (m.type === 110 && m.card) {
        const a = simPlace(m.card.controller, m.card.location, m.card.sequence, view)
        const t = m.target ? simPlace(m.target.controller, m.target.location, m.target.sequence, view) : null
        if (a?.zone) events.push({ k: 'a', a, t: t?.zone ? t : null })
      } else if (m.type === 83) {
        for (const c of m.cards || []) { const e = where(slotAt(c), null, 'target'); if (e) events.push(e) }
      } else if (m.type === 31 || m.type === 30) {
        for (const c of m.cards || []) {
          const at = slotAt(c)
          const sl = at && (!c.code || at.code === c.code) ? at
            : c.code ? slots.find(x => x.p === c.controller && x.loc === normLoc(c.location) && x.code === c.code) : null
          if (sl && sl.loc === LOC.HAND && moves.some(mv => mv.to === LOC.HAND && mv.from !== LOC.HAND && mv.code === sl.code)) continue
          if (sl) { const e = where(sl, c.code, 'reveal'); if (e && e.k === 'p') events.push(e) }
          else if (normLoc(c.location) === LOC.DECK) events.push({ k: 'p', u: null, p: 'deck', s: c.controller === view ? 'player' : 'opp', c: c.code, m: 'reveal' })
        }
      } else if (m.type === 32) {
        events.push({ k: 's', s: m.player === view ? 'player' : 'opp' })
      }
    }
    return events
    }
    const liveEvents = eventsFor(VIEW)
    dispatch({ type: 'OCG_SYNC', payload: { state, frame: frameOf(canon, chrono, full, VIEW === ME ? liveEvents : eventsFor(ME)), x: liveEvents } })
    let links = chainRef.current
    let note = null
    const locate = (link) => {
      const sl = slots.find(x => x.key === link.key && x.code === link.code)
        || slots.find(x => x.p === link.controller && x.code === link.code && x.loc !== LOC.DECK && x.loc !== LOC.OVERLAY)
      return sl ? uids.get(sl.key) : link.uid
    }
    for (const m of msgs) {
      if (m.type === 70) {
        const link = { size: m.chain_size, code: m.code, controller: m.controller, key: `${m.controller}:${m.location}:${m.sequence}` }
        links = [...links.filter(l => l.size !== m.chain_size), link]
        note = { text: tL(`Chain Link ${m.chain_size} : ${nm(m.code)}`, `Chain Link ${m.chain_size}: ${nm(m.code)}`, `Eslabón ${m.chain_size}: ${nm(m.code)}`), kind: 'chain' }
      } else if (m.type === 72) {
        links = links.map(l => ({ ...l, resolving: l.size === m.chain_size }))
        const l = links.find(x => x.size === m.chain_size)
        note = { text: tL(`Résolution du Chain Link ${m.chain_size}${l ? ` : ${nm(l.code)}` : ''}`, `Resolving Chain Link ${m.chain_size}${l ? `: ${nm(l.code)}` : ''}`, `Resolviendo el eslabón ${m.chain_size}${l ? `: ${nm(l.code)}` : ''}`), kind: 'resolve' }
      } else if (m.type === 73) {
        links = links.filter(l => l.size !== m.chain_size)
      } else if (m.type === 75 || m.type === 76) {
        links = links.map(l => (l.size === m.chain_size ? { ...l, negated: true } : l))
        note = { text: tL(`Chain Link ${m.chain_size} annulé`, `Chain Link ${m.chain_size} negated`, `Eslabón ${m.chain_size} negado`), kind: 'negate' }
      } else if (m.type === 74) {
        links = []
      }
    }
    links = links.map(l => ({ ...l, uid: locate(l) }))
    chainRef.current = links
    setChain(links)
    if (note) setBanner({ ...note, id: ++seqRef.current })

    const missing = [...new Set(slots.map(sl => sl.code))].filter(c => !cardsRef.current.has(c) && !askedRef.current.has(c))
    return missing
  }, [dispatch, fxActionsRef, logLine])

  const fetchCards = useCallback(async (codes) => {
    if (!codes.length) return
    for (const c of codes) askedRef.current.add(c)
    try {
      const r = await fetch(`/api/cards?ids=${codes.join(',')}`)
      const raw = await r.json()
      const arr = Array.isArray(raw) ? raw : (raw.data || raw.cards || [])
      for (const c of arr) {
        if (!cardsRef.current.has(Number(c.id))) cardsRef.current.set(Number(c.id), c)
        for (const im of c.card_images || []) if (im?.id && !cardsRef.current.has(Number(im.id))) cardsRef.current.set(Number(im.id), c)
      }
      const board = boardRef.current
      if (board) {
        const { state, full, canon } = build(board, uidsRef.current, logRef.current)
        dispatch({ type: 'OCG_SYNC', payload: { state, frame: frameOf(canon, [], full) } })
      }
    } catch (e) {
      console.warn('[ocg] cartes', e)
    }
  }, [dispatch])

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current
    const w = new Worker(OCG_RES + 'worker.js', { type: 'module' })
    w.onmessage = ({ data }) => {
      if (data.t === 'progress') {
        setLoadStep(data.step)
      } else if (data.t === 'meta') {
        metaRef.current = { seed: data.seed, decks: data.decks, hands: data.hands || null, done: forkRef.current }
      } else if (data.t === 'state') {
        if (readyRef.current) { readyRef.current.resolve(); readyRef.current = null; setLoadStep(null) }
        if (data.resp?.length) respRef.current.push(...data.resp)
        const missing = sync(data.board, data.log)
        setPrompt(data.prompt)
        setPicked([])
        setPlaces([])
        setBusy(!!data.thinking)
        if (data.thinking) scheduleNext(data.wait || 250)
        if (data.board.ended) setEnded({ winner: data.board.winner })
        if (missing.length) fetchCards(missing)
      } else if (data.t === 'core') {
        console.warn('[ocg] moteur', String(data.text).split('\n')[0])
        setErrors(e => [String(data.text).split('\n')[0], ...e].slice(0, 20))
      } else if (data.t === 'unknown' && data.codes.length) {
        setErrors(e => [tL(`Cartes absentes de la base : ${data.codes.join(', ')}`, `Cards missing from the database: ${data.codes.join(', ')}`, `Cartas ausentes de la base: ${data.codes.join(', ')}`), ...e])
      } else if (data.t === 'error') {
        console.warn('[ocg] worker', data.message)
        if (readyRef.current) { readyRef.current.reject(new Error(data.message)); readyRef.current = null; setLoadStep(null) }
        setErrors(e => [data.message, ...e])
        setBusy(false)
      }
    }
    w.onerror = (e) => {
      console.warn('[ocg] worker', e.message)
      if (readyRef.current) { readyRef.current.reject(new Error(e.message || 'worker')); readyRef.current = null; setLoadStep(null) }
      setErrors(x => [e.message || 'worker', ...x])
      setBusy(false)
    }
    workerRef.current = w
    return w
  }, [sync, fetchCards, scheduleNext])

  const start = useCallback(async ({ decks, cards, init, fork, hands, first }) => {
    ME = (fork ? fork.me : first === 'opp' ? 1 : 0) || 0
    ctlRef.current.me = ME
    const order = (pair) => (ME === 1 && pair ? [pair[1], pair[0]] : pair)
    initRef.current = init || null
    forkRef.current = !!fork
    metaRef.current = null
    respRef.current = []
    encRef.current = init ? frameEncoder(new Set([...init.mainCards, ...init.extraCards, ...init.oppMainCards, ...init.oppExtraCards].map(c => Number(c.id)))) : null
    if (fork?.state && encRef.current) encRef.current(fork.state, [], null, fork.state)
    for (const c of cards) {
      const id = Number(c.id)
      if (!cardsRef.current.has(id)) cardsRef.current.set(id, c)
    }
    clearInterval(ackRef.current)
    VIEW = ME
    setSwappedState(false)
    prevRef.current = new Map()
    uidsRef.current = new Map()
    chainRef.current = []
    setChain([])
    setBanner(null)
    logRef.current = fork?.state?.log ? [...fork.state.log] : []
    seqRef.current = fork?.state ? Math.max(0, ...(JSON.stringify(fork.state).match(/ocg_\d+/g) || []).map(x => Number(x.slice(4)))) : 0
    firstRef.current = false
    setErrors([])
    setEnded(null)
    setPrompt(null)
    setBusy(true)
    setActive(true)
    setLoadStep('core')
    readyRef.current?.resolve()
    const ready = new Promise((resolve, reject) => { readyRef.current = { resolve, reject } })
    const textsReady = loadTexts()
    ensureWorker().postMessage({ t: 'start', decks: fork ? decks : order(decks), hands: fork ? null : order(hands) || null, ...ctlRef.current, fork: fork ? { seed: fork.seed, responses: fork.responses, hands: fork.hands || null } : null })
    await Promise.all([ready, textsReady])
  }, [loadTexts, ensureWorker])

  const stop = useCallback(() => {
    clearInterval(ackRef.current)
    workerRef.current?.terminate()
    workerRef.current = null
    readyRef.current?.resolve()
    readyRef.current = null
    setLoadStep(null)
    VIEW = ME
    setSwappedState(false)
    setActive(false)
    setPrompt(null)
    setBusy(false)
  }, [])

  const respond = useCallback((response) => {
    if (!workerRef.current) return
    setBusy(true)
    workerRef.current.postMessage({ t: 'respond', response })
  }, [])

  const setControlBoth = useCallback((v) => {
    ctlRef.current.controlBoth = v
    setControlBothState(v)
    workerRef.current?.postMessage({ t: 'control', ...ctlRef.current })
  }, [])

  const setQuietChains = useCallback((v) => {
    ctlRef.current.quietChains = v
    setQuietChainsState(v)
    workerRef.current?.postMessage({ t: 'control', ...ctlRef.current })
  }, [])

  const [swapped, setSwappedState] = useState(false)
  const setSwapped = useCallback((v) => {
    VIEW = v ? 1 - ME : ME
    setSwappedState(!!v)
    const board = boardRef.current
    if (!board) return
    const { state, full, canon } = build(board, uidsRef.current, logRef.current)
    dispatch({ type: 'OCG_SYNC', payload: { state, frame: frameOf(canon, [], full) } })
  }, [dispatch])

  const [reveal, setRevealState] = useState(false)
  const setReveal = useCallback((v) => {
    if (!!ctlRef.current.reveal === !!v) return
    ctlRef.current.reveal = !!v
    setRevealState(!!v)
    const board = boardRef.current
    if (!board) return
    const { state, full, canon } = build(board, uidsRef.current, logRef.current)
    dispatch({ type: 'OCG_SYNC', payload: { state, frame: frameOf(canon, [], full) } })
  }, [dispatch])

  const setAiOpp = useCallback((v) => {
    ctlRef.current.aiOpp = v
    setAiOppState(v)
    workerRef.current?.postMessage({ t: 'control', ...ctlRef.current })
  }, [])

  const actions = useMemo(() => {
    if (!prompt) return []
    const out = []
    if (prompt.type === 11) {
      const groups = [
        ['summons', 0, 'summon', tL('Invocation Normale', 'Normal Summon', 'Invocación Normal'), 'bolt'],
        ['special_summons', 1, 'ss', tL('Invocation Spéciale', 'Special Summon', 'Invocación Especial'), 'sparkle'],
        ['pos_changes', 2, 'repos', tL('Changer de position', 'Change position', 'Cambiar posición'), 'refresh'],
        ['monster_sets', 3, 'mset', tL('Poser', 'Set', 'Colocar'), 'chevronDown'],
        ['spell_sets', 4, 'sset', tL('Poser', 'Set', 'Colocar'), 'chevronDown'],
        ['activates', 5, 'activate', null, 'bolt'],
      ]
      for (const [k, action, kind, label, icon] of groups) {
        (prompt[k] || []).forEach((c, index) => out.push({ c, kind, icon, label: label || desc(c.description, c.code), response: { type: 1, action, index } }))
      }
    } else if (prompt.type === 10) {
      prompt.chains.forEach((c, index) => out.push({ c, kind: 'activate', icon: 'bolt', label: desc(c.description, c.code), response: { type: 0, action: 0, index } }))
      prompt.attacks.forEach((c, index) => out.push({ c, kind: 'attack', icon: 'swords', label: c.can_direct ? tL('Attaquer (direct possible)', 'Attack (direct allowed)', 'Atacar (directo posible)') : tL('Attaquer', 'Attack', 'Atacar'), response: { type: 0, action: 1, index } }))
    } else if (prompt.type === 16) {
      prompt.selects.forEach((c, index) => out.push({ c, kind: 'activate', icon: 'chain', label: desc(c.description, c.code), response: { type: 8, index } }))
    }
    return out
  }, [prompt, desc])

  const uidByKey = useMemo(() => new Map([...keyByUid].map(([u, k]) => [k, u])), [keyByUid])

  const optionsFor = useCallback((uid) => {
    const key = keyByUid.get(uid)
    if (!key) return []
    return actions.map((a, i) => (keyOf(a.c) === key ? { id: `ocg:${i}`, label: a.label, icon: a.icon, cls: 'special' } : null)).filter(Boolean)
  }, [actions, keyByUid])

  const dropRef = useRef({ choices: [], pending: null })

  const pick = useCallback((id) => {
    const sid = String(id)
    if (sid.startsWith('ocgdrop:')) {
      const ch = dropRef.current.choices[Number(sid.slice(8))]
      if (!ch) return
      dropRef.current.pending = ch.pending
      respond(ch.response)
      return
    }
    const i = Number(sid.replace('ocg:', ''))
    if (actions[i]) respond(actions[i].response)
  }, [actions, respond])

  const dropCard = useCallback((uid, target) => {
    const key = keyByUid.get(uid)
    if (!key || !prompt || !target) return null
    const mine = actions.filter(a => keyOf(a.c) === key)
    if (!mine.length) return null
    const [, loc] = key.split(':').map(Number)
    const zone = target.zone || ''
    const own = (target.location === 'field') === (prompt.player === VIEW)
    const isMonsterZone = /^(monster|emz)/.test(zone)
    let kinds = []
    let pending = null
    if (prompt.type === 11) {
      if (own && isMonsterZone) kinds = ['summon', 'ss', 'mset']
      else if (own && (zone.startsWith('st') || zone === 'fieldZone')) kinds = loc === LOC.HAND ? ['activate', 'sset'] : ['activate']
      pending = { placeKeys: ocgPlace(target.location, zone) }
    } else if (prompt.type === 10) {
      if (!own && /^(field|oppField)$/.test(target.location) && isMonsterZone) {
        kinds = ['attack']
        pending = { targetKeys: ocgPlace(target.location, zone) }
      } else if (target.kind === 'oppHand') kinds = ['attack']
    }
    const list = mine.filter(a => kinds.includes(a.kind))
      .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind))
    if (!list.length) return null
    const byKind = new Set(list.map(a => a.kind))
    if (list.length === 1 || (byKind.size === 1 && list[0].kind !== 'activate')) {
      dropRef.current.pending = pending
      respond(list[0].response)
      return { done: true }
    }
    dropRef.current.choices = list.map(a => ({ response: a.response, pending }))
    return { options: list.map((a, i) => ({ id: `ocgdrop:${i}`, label: a.label, icon: a.icon, cls: 'special' })) }
  }, [keyByUid, prompt, actions, respond])

  const candidates = useMemo(() => {
    if (!prompt) return null
    if (prompt.type === 15 || prompt.type === 20) return prompt.selects
    if (prompt.type === 26) return [...prompt.select_cards, ...prompt.unselect_cards]
    if (prompt.type === 23) return [...(prompt.selects_must || []), ...prompt.selects]
    return null
  }, [prompt])

  const togglePick = useCallback((i) => setPicked(p => (p.includes(i) ? p.filter(x => x !== i) : [...p, i])), [])

  const isMat = useCallback((c) => !!(c.location & LOC.OVERLAY)
    || ((c.location & 0x7f) === LOC.MZONE && boardRef.current?.players?.[c.controller]?.mzone?.[c.sequence]?.code !== c.code), [])

  const pickIndex = useCallback((i) => {
    if (!prompt || !candidates) return
    if (prompt.type === 26) return respond({ type: 7, index: i })
    if (prompt.type === 23) {
      const mustN = (prompt.selects_must || []).length
      if (i >= mustN) togglePick(i - mustN)
      return
    }
    if (prompt.min === 1 && prompt.max === 1) return respond({ type: prompt.type === 20 ? 12 : 5, indicies: [i] })
    togglePick(i)
  }, [prompt, candidates, respond, togglePick])

  const clickCard = useCallback((uid) => {
    if (!candidates) return false
    if (String(uid).startsWith('ocgpick_')) {
      pickIndex(Number(String(uid).slice(8)))
      return true
    }
    const key = keyByUid.get(uid)
    if (!key) return false
    const hostKey = (c) => `${c.controller}:${LOC.MZONE}:${c.sequence}`
    let idx = candidates.map((c, i) => (keyOf(c) === key && !isMat(c) ? i : -1)).filter(i => i >= 0)
    if (!idx.length) idx = candidates.map((c, i) => (isMat(c) && hostKey(c) === key ? i : -1)).filter(i => i >= 0)
    if (!idx.length) return false
    const mustN = prompt.type === 23 ? (prompt.selects_must || []).length : 0
    const isOn = (i) => (prompt.type === 23 ? i < mustN || picked.includes(i - mustN) : picked.includes(i))
    const free = prompt.type === 26 ? idx.find(i => i < prompt.select_cards.length) : idx.find(i => !isOn(i))
    pickIndex(free ?? idx[idx.length - 1])
    return true
  }, [candidates, keyByUid, pickIndex, isMat, prompt, picked])

  const isPicked = useCallback((uid) => {
    if (!prompt || !candidates || !String(uid).startsWith('ocgpick_')) return false
    const i = Number(String(uid).slice(8))
    if (prompt.type === 26) return i >= prompt.select_cards.length
    if (prompt.type === 23) {
      const mustN = (prompt.selects_must || []).length
      return i < mustN || picked.includes(i - mustN)
    }
    return picked.includes(i)
  }, [prompt, candidates, picked])

  const pickFan = useMemo(() => {
    if (!prompt || !candidates?.length) return null
    const off = candidates.filter(c => isMat(c) || ![LOC.HAND, LOC.MZONE, LOC.SZONE].includes(c.location & 0xff))
    if (!off.length) return null
    const f = off[0]
    const title = prompt.hint != null ? desc(prompt.hint) : tL('Choisis une carte', 'Choose a card', 'Elige una carta')
    const cards = candidates.map((c, i) => ({ ...cardOf(c.code), uid: `ocgpick_${i}`, owner: c.controller === VIEW ? 'player' : 'opp', isFaceDown: false }))
    if (isMat(f)) return { key: 'ocgPick', title, cards, hit: '', at: simPlace(f.controller, LOC.MZONE, f.sequence) }
    const pile = { [LOC.DECK]: 'deck', [LOC.GRAVE]: 'gy', [LOC.REMOVED]: 'banished', [LOC.EXTRA]: 'extra' }[f.location & 0xff] || 'gy'
    const hit = `${f.controller === VIEW ? 'player' : 'opp'}:${pile}`
    return { key: 'ocgPick', title, cards, hit }
  }, [prompt, candidates, desc, cardOf, swapped, isMat])

  const placeOptions = useMemo(() => {
    if (!prompt || (prompt.type !== 18 && prompt.type !== 24)) return []
    const out = []
    const mask = prompt.field_mask >>> 0
    const zones = [[0, LOC.MZONE, 7, 0], [8, LOC.SZONE, 8, 0], [16, LOC.MZONE, 7, 1], [24, LOC.SZONE, 8, 1]]
    for (const [shift, location, n, side] of zones) {
      for (let i = 0; i < n; i++) if (!(mask & (1 << (shift + i)))) out.push({ player: side ? 1 - prompt.player : prompt.player, location, sequence: i })
    }
    return out
  }, [prompt])

  const choosePlace = useCallback((p) => {
    const next = [...places, p]
    if (next.length >= (prompt.count || 1)) respond({ type: prompt.type === 18 ? 10 : 9, places: next })
    else setPlaces(next)
  }, [places, prompt, respond])

  useEffect(() => {
    const pend = dropRef.current.pending
    if (!pend || !prompt || prompt.player !== ME) return
    if (prompt.type === 11 || prompt.type === 10) { dropRef.current.pending = null; return }
    if ((prompt.type === 18 || prompt.type === 24) && pend.placeKeys) {
      const opt = placeOptions.find(o => pend.placeKeys.includes(`${o.player}:${o.location}:${o.sequence}`))
      dropRef.current.pending = { ...pend, placeKeys: null }
      if (opt && (prompt.count || 1) === 1) respond({ type: prompt.type === 18 ? 10 : 9, places: [opt] })
      return
    }
    if (prompt.type === 15 && pend.targetKeys && candidates) {
      const i = candidates.findIndex(c => pend.targetKeys.includes(keyOf(c)))
      dropRef.current.pending = { ...pend, targetKeys: null }
      if (i >= 0 && prompt.min === 1 && prompt.max === 1) respond({ type: 5, indicies: [i] })
    }
  }, [prompt, placeOptions, candidates, respond])

  const clickZone = useCallback((location, zone) => {
    if (!placeOptions.length) return false
    const keys = ocgPlace(location, zone)
    const opt = placeOptions.find(o => keys.includes(`${o.player}:${o.location}:${o.sequence}`))
    if (!opt) return false
    choosePlace(opt)
    return true
  }, [placeOptions, choosePlace])

  const phase = useCallback((action) => {
    if (!prompt) return
    if (prompt.type === 11) {
      if (action === 'bp' && prompt.to_bp) respond({ type: 1, action: 6, index: null })
      else if (action === 'ep' && prompt.to_ep) respond({ type: 1, action: 7, index: null })
      else if (action === 'next' && (prompt.to_bp || prompt.to_ep)) respond({ type: 1, action: prompt.to_bp ? 6 : 7, index: null })
    } else if (prompt.type === 10) {
      if (action === 'm2' && prompt.to_m2) respond({ type: 0, action: 2, index: null })
      else if (action === 'ep' && prompt.to_ep) respond({ type: 0, action: 3, index: null })
      else if (action === 'next' && (prompt.to_m2 || prompt.to_ep)) respond({ type: 0, action: prompt.to_m2 ? 2 : 3, index: null })
    }
  }, [prompt, respond])

  const adjustHitmap = useCallback((layout) => {
    if (!layout) return
    if (!layout._ocgBase) layout._ocgBase = layout.hitmap
    const base = layout._ocgBase
    if (!active) { layout.hitmap = base; return }
    const byId = Object.fromEntries(base.filter(r => r.type === 'actionBtn').map(r => [r.id, r]))
    const btns = []
    const add = (r, id, action, label, icon) => r && btns.push({ ...r, id, action, label, icon })
    if ((prompt?.type === 11 || prompt?.type === 10) && prompt.to_ep) add(byId['btn:pass'], 'btn:ocg-ep', 'ep', tL('Fin de tour', 'End turn', 'Fin del turno'), 'arrowRight')
    if (byId['btn:phase']) btns.push({ ...byId['btn:phase'], action: 'next' })
    layout.hitmap = [...base.filter(r => r.type !== 'actionBtn'), ...btns]
  }, [active, prompt])

  const inter = useMemo(() => {
    if (!active) return { pendingZoneType: null, pendingSide: null, actHi: null }
    const marks = new Map()
    const mark = (k) => { if (!marks.has(k)) marks.set(k, { kinds: new Set(), pick: false }); return marks.get(k) }
    actions.forEach(a => mark(keyOf(a.c)).kinds.add(a.kind))
    if (candidates) candidates.forEach((c, i) => { if (prompt.type !== 26 || i < prompt.select_cards.length) mark(keyOf(c)).pick = true })
    const actHi = [...marks].map(([k, m]) => {
      const [p, loc, seq] = k.split(':').map(Number)
      const at = simPlace(p, loc, seq)
      if (!at) return null
      const base = loc === LOC.HAND ? { location: at.location, uid: uidByKey.get(k) } : at
      return { ...base, kinds: [...m.kinds], pick: m.pick && !m.kinds.size }
    }).filter(Boolean)
    const p = placeOptions[0]
    return {
      pendingZoneType: p ? (p.location === LOC.MZONE ? 'monster' : p.sequence === 5 ? 'field' : 'st') : null,
      pendingSide: p ? (p.player === VIEW ? 'player' : 'opp') : null,
      actHi,
    }
  }, [active, actions, candidates, prompt, placeOptions, uidByKey, swapped])

  return {
    active, busy, prompt, errors, ended, loadStep, controlBoth, quietChains, aiOpp, texts, chain, banner,
    start, stop, respond, setControlBoth, setQuietChains, setAiOpp, swapped, setSwapped, reveal, setReveal,
    actions, optionsFor, pick, dropCard, candidates, picked, togglePick, pickIndex, clickCard, isPicked, pickFan,
    placeOptions, places, choosePlace, clickZone, phase, adjustHitmap, inter, nm, desc, cardOf,
    progress: progressRef.current,
  }
}
