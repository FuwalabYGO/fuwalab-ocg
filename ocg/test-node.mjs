import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCore, createDuel, autoResponse, isExtra } from './engine.js'

const ROOT = dirname(fileURLToPath(import.meta.url))
const V = join(ROOT, 'vendor')
const cards = JSON.parse(readFileSync(join(V, 'cards.json'), 'utf8'))
const index = JSON.parse(readFileSync(join(V, 'scripts-index.json'), 'utf8'))
const pack = readFileSync(join(V, 'scripts.pack'))
const texts = JSON.parse(readFileSync(join(V, 'texts.json'), 'utf8'))
const name = (c) => texts[c]?.[0] || c

const list = (process.argv[2] || '14558127,14558127,14558127,89631139,89631139,89631139,38517737,23434538,23434538,55144522,83764718,12580477,5318639,44095762').split(',').map(Number)
const pool = [...list]
while (pool.length < 40) pool.push(...list)
const deck = { main: pool.slice(0, 40).filter(c => !isExtra(cards[c])), extra: list.filter(c => isExtra(cards[c])) }

const missing = new Set()
const lib = await loadCore()
const duel = createDuel(lib, {
  decks: [deck, deck],
  readCard: (c) => cards[c] || null,
  readScript: (n) => { const e = index[n]; if (!e) { missing.add(n); return null } return pack.toString('utf8', e[0], e[0] + e[1]) },
  onError: (t, m) => console.warn('[core]', t, m),
})

let r = duel.run(null, [1])
let steps = 0
while (r.prompt && steps < 400) {
  steps++
  const p = r.prompt
  const b = duel.board()
  if (steps < 25) console.log(`T${b.turn} ph${b.phase} prompt ${p.type}${p.retry ? ' RETRY' : ''}`, p.type === 11 ? `acts=${p.activates.length} sum=${p.summons.length} ss=${p.special_summons.length}` : '', 'hand:', b.players[0].hand.map(c => name(c?.code)).join(' | '))
  let resp = autoResponse(p)
  if (p.type === 11 && p.summons.length && b.turn < 6) resp = { type: 1, action: 0, index: 0 }
  else if (p.type === 11 && p.activates.length && b.turn < 6 && steps % 3) resp = { type: 1, action: 5, index: 0 }
  r = duel.run(resp, [1])
}
const b = duel.board()
console.log('fin', { steps, turn: b.turn, lp: b.lp, ended: b.ended, winner: b.winner })
console.log('terrain J0', b.players[0].mzone.map(c => c && name(c.code)), b.players[0].grave.map(c => name(c?.code)))
console.log('scripts manquants', [...missing].slice(0, 20))
