'use client'

import { useState } from 'react'
import { tL } from '../gameEngine'
import s from './ocgPanel.module.css'

const PICKS = new Set([15, 20, 23, 26])

const ATTRS = () => [[1, tL('Terre', 'Earth', 'Tierra')], [2, tL('Eau', 'Water', 'Agua')], [4, tL('Feu', 'Fire', 'Fuego')], [8, tL('Vent', 'Wind', 'Viento')], [16, tL('Lumière', 'Light', 'Luz')], [32, tL('Ténèbres', 'Dark', 'Oscuridad')], [64, tL('Divin', 'Divine', 'Divino')]]
const RACES = ['Warrior', 'Spellcaster', 'Fairy', 'Fiend', 'Zombie', 'Machine', 'Aqua', 'Pyro', 'Rock', 'Winged Beast', 'Plant', 'Insect', 'Thunder', 'Dragon', 'Beast', 'Beast-Warrior', 'Dinosaur', 'Fish', 'Sea Serpent', 'Reptile', 'Psychic', 'Divine-Beast', 'Creator God', 'Wyrm', 'Cyberse', 'Illusion']
const POSITIONS = () => [[1, tL('Attaque recto', 'Face-up Attack', 'Ataque boca arriba')], [4, tL('Défense recto', 'Face-up Defense', 'Defensa boca arriba')], [2, tL('Attaque verso', 'Face-down Attack', 'Ataque boca abajo')], [8, tL('Défense verso', 'Face-down Defense', 'Defensa boca abajo')]]

export default function OcgPanel({ ocg, onHover, onShowPick }) {
  const [search, setSearch] = useState('')
  const { prompt, busy, nm, desc, respond, picked, togglePick, candidates, actions, cardOf } = ocg

  if (!prompt || busy) return null
  if (prompt.type === 11 || prompt.type === 10) return prompt.retry ? <div className={s.bar}><span className={s.warn}>{tL('Choix refusé par le moteur', 'Choice rejected by the engine', 'Elección rechazada por el motor')}</span></div> : null

  const hint = prompt.hint != null ? desc(prompt.hint) : null
  const hover = (code) => onHover?.(cardOf(code))
  const yesNo = (type) => <>
    <button type="button" className={s.btn} onClick={() => respond({ type, yes: true })}>{tL('Oui', 'Yes', 'Sí')}</button>
    <button type="button" className={s.btn2} onClick={() => respond({ type, yes: false })}>{tL('Non', 'No', 'No')}</button>
  </>
  const bar = (text, buttons, extra) => (
    <div className={s.bar} onPointerDown={e => e.stopPropagation()}>
      {prompt.retry && <span className={s.warn}>{tL('Choix refusé, recommence.', 'Choice rejected, try again.', 'Elección rechazada, inténtalo de nuevo.')}</span>}
      {text && <span className={s.text}>{text}</span>}
      {buttons && <div className={s.row}>{buttons}</div>}
      {extra}
    </div>
  )

  if (PICKS.has(prompt.type)) {
    const isSum = prompt.type === 23
    const isUnsel = prompt.type === 26
    const mustN = isSum ? (prompt.selects_must || []).length : 0
    const vals = (c) => { const a = c.amount & 0xffff; const b = (c.amount >>> 16) & 0xffff; return b && b !== a ? [a, b] : [a] }
    let sums = [0]
    if (isSum) candidates.forEach((c, i) => { if (i < mustN || picked.includes(i - mustN)) sums = sums.flatMap(t => vals(c).map(v => t + v)) })
    const sum = !isSum ? 0 : sums.includes(prompt.amount) ? prompt.amount : prompt.select_max === 0 ? Math.min(...sums) : Math.max(...sums)
    const n = picked.length
    const ok = isSum || (n >= prompt.min && n <= prompt.max)
    const single = !isSum && !isUnsel && prompt.min === 1 && prompt.max === 1
    const count = isSum ? `${sum} / ${prompt.amount}` : isUnsel ? `${prompt.unselect_cards.length}` : `${n} / ${prompt.min === prompt.max ? prompt.min : `${prompt.min}-${prompt.max}`}`
    const buttons = <>
      {!isUnsel && !single && <button type="button" className={s.btn} disabled={!ok} onClick={() => respond(isSum
        ? { type: 14, indicies: picked }
        : { type: prompt.type === 20 ? 12 : 5, indicies: picked })}>{tL('Valider', 'Confirm', 'Confirmar')}</button>}
      {isUnsel && prompt.can_finish && <button type="button" className={s.btn} onClick={() => respond({ type: 7, index: null })}>{tL('Terminer', 'Finish', 'Terminar')}</button>}
      {prompt.can_cancel && <button type="button" className={s.btn2} onClick={() => respond(isUnsel ? { type: 7, index: null } : { type: prompt.type === 20 ? 12 : 5, indicies: null })}>{tL('Annuler', 'Cancel', 'Cancelar')}</button>}
    </>
    const title = hint || tL('Choisis une carte', 'Choose a card', 'Elige una carta')
    return bar(<>{title} <em className={s.count}>{count}</em></>, <>
      {buttons}
      {ocg.pickFan && onShowPick && <button type="button" className={s.btn2} onClick={onShowPick}>{tL('Afficher les cartes', 'Show the cards', 'Mostrar las cartas')}</button>}
    </>)
  }

  switch (prompt.type) {
    case 16:
      return bar(<>{hint ? `${hint} · ` : ''}{tL('Chaîner ?', 'Chain?', '¿Encadenar?')}</>, <>
        {actions.map((a, i) => (
          <button key={i} type="button" className={s.chip} onMouseEnter={() => hover(a.c.code)} onClick={() => respond(a.response)}>
            <strong>{nm(a.c.code)}</strong>{a.label !== tL('Activer', 'Activate', 'Activar') && <span> · {a.label}</span>}
          </button>
        ))}
        {!prompt.forced && <button type="button" className={s.btn2} onClick={() => respond({ type: 8, index: null })}>{tL('Passer', 'Pass', 'Pasar')}</button>}
      </>)
    case 12: {
      const q = desc(prompt.description || 200, prompt.code, prompt.location)
      return bar(q.includes(nm(prompt.code)) ? q : `${nm(prompt.code)} : ${q}`, yesNo(2))
    }
    case 13:
      return bar(desc(prompt.description), yesNo(3))
    case 14:
      return bar(hint, prompt.options.map((o, i) => <button key={i} type="button" className={s.chip} onClick={() => respond({ type: 4, index: i })}>{desc(o)}</button>))
    case 18:
    case 24:
      return bar(<>
        {prompt.count > 1 ? tL(`Choisis ${prompt.count} zones`, `Choose ${prompt.count} zones`, `Elige ${prompt.count} zonas`) : tL('Choisis une zone', 'Choose a zone', 'Elige una zona')}
        {hint && <em className={s.count}>{hint}</em>}
      </>)
    case 19:
      return bar(tL(`Position de ${nm(prompt.code)}`, `Position of ${nm(prompt.code)}`, `Posición de ${nm(prompt.code)}`),
        POSITIONS().filter(([b]) => prompt.positions & b).map(([b, l]) => <button key={b} type="button" className={s.chip} onClick={() => respond({ type: 11, position: b })}>{l}</button>))
    case 21:
    case 25:
      return bar(hint || tL('Ordre des cartes', 'Card order', 'Orden de las cartas'), <button type="button" className={s.btn} onClick={() => respond({ type: 15, order: null })}>{tL('Ordre par défaut', 'Default order', 'Orden por defecto')}</button>)
    case 22: {
      let left = prompt.count
      const counters = prompt.cards.map(c => { const k = Math.min(c.count, left); left -= k; return k })
      return bar(tL(`Retirer ${prompt.count} compteur(s)`, `Remove ${prompt.count} counter(s)`, `Retirar ${prompt.count} contador(es)`), <button type="button" className={s.btn} onClick={() => respond({ type: 13, counters })}>{tL('Retirer', 'Remove', 'Retirar')}</button>)
    }
    case 140:
    case 141: {
      const isRace = prompt.type === 140
      const opts = isRace ? RACES.map((l, i) => [1n << BigInt(i), l]).filter(([b]) => BigInt(prompt.available) & b) : ATTRS().filter(([b]) => prompt.available & b)
      return bar(isRace ? tL(`Déclare ${prompt.count} Type(s)`, `Declare ${prompt.count} Type(s)`, `Declara ${prompt.count} Tipo(s)`) : tL(`Déclare ${prompt.count} Attribut(s)`, `Declare ${prompt.count} Attribute(s)`, `Declara ${prompt.count} Atributo(s)`), <>
        {opts.map(([, l], i) => <button key={i} type="button" className={`${s.chip} ${picked.includes(i) ? s.chipOn : ''}`} onClick={() => togglePick(i)}>{l}</button>)}
        <button type="button" className={s.btn} disabled={picked.length !== prompt.count} onClick={() => respond(isRace
          ? { type: 16, races: picked.map(i => opts[i][0]) } : { type: 17, attributes: picked.map(i => opts[i][0]) })}>{tL('Valider', 'Confirm', 'Confirmar')}</button>
      </>)
    }
    case 143:
      return bar(hint || tL('Déclare un nombre', 'Declare a number', 'Declara un número'), prompt.options.map((o, i) => <button key={i} type="button" className={s.chip} onClick={() => respond({ type: 19, value: i })}>{String(o)}</button>))
    case 142: {
      const q = search.trim().toLowerCase()
      const hits = q.length < 2 || !ocg.texts ? [] : Object.entries(ocg.texts).filter(([, t]) => t[0]?.toLowerCase().includes(q)).slice(0, 8)
      return bar(tL('Déclare un nom de carte', 'Declare a card name', 'Declara un nombre de carta'),
        <input className={s.input} value={search} autoFocus onChange={e => setSearch(e.target.value)} placeholder={tL('Nom anglais', 'English name', 'Nombre en inglés')} />,
        hits.length > 0 && <div className={s.row}>{hits.map(([c, t]) => <button key={c} type="button" className={s.chip} onClick={() => { setSearch(''); respond({ type: 18, card: Number(c) }) }}>{t[0]}</button>)}</div>)
    }
    case 132:
      return bar(null, [tL('Pierre', 'Rock', 'Piedra'), tL('Feuille', 'Paper', 'Papel'), tL('Ciseaux', 'Scissors', 'Tijeras')].map((l, i) => <button key={i} type="button" className={s.btn2} onClick={() => respond({ type: 20, value: i + 1 })}>{l}</button>))
    default:
      return bar(tL(`Choix non géré (${prompt.type})`, `Unhandled choice (${prompt.type})`, `Elección no gestionada (${prompt.type})`))
  }
}

export function OcgChainLayer({ spots, banner }) {
  const seen = new Map()
  return (
    <div className={s.layer} aria-hidden="true">
      {spots.map((l) => {
        const k = `${Math.round(l.x)}:${Math.round(l.y)}`
        const n = seen.get(k) || 0
        seen.set(k, n + 1)
        return (
          <span key={l.size} className={[s.link, l.resolving && s.linkOn, l.negated && s.linkOff].filter(Boolean).join(' ')}
            style={{ left: l.x + n * 16, top: l.y - n * 16 }}>
            {l.size}
          </span>
        )
      })}
      {banner && <div key={banner.id} className={[s.banner, banner.kind === 'resolve' && s.bannerResolve, banner.kind === 'negate' && s.bannerNegate].filter(Boolean).join(' ')}>{banner.text}</div>}
    </div>
  )
}
