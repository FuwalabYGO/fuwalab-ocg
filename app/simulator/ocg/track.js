const LIST = new Set([1, 2, 16, 32, 64])
const ZONE = new Set([4, 8])

export function trackUids(prev, msgs) {
  const lists = new Map()
  const zones = new Map()
  const overlays = new Map()
  const loose = new Set()
  const listOf = (p, loc) => {
    const k = `${p}:${loc}`
    if (!lists.has(k)) lists.set(k, [])
    return lists.get(k)
  }
  const ovOf = (host) => {
    if (!overlays.has(host)) overlays.set(host, [])
    return overlays.get(host)
  }
  for (const [key, v] of prev) {
    const parts = key.split(':')
    const [p, loc, seq] = parts.slice(0, 3).map(Number)
    if (parts[3]) ovOf(`${p}:${loc}:${seq}`)[Number(parts[3].slice(1))] = v.uid
    else if (LIST.has(loc)) listOf(p, loc)[seq] = v.uid
    else if (ZONE.has(loc)) zones.set(key, v.uid)
  }
  for (const l of [...lists.values(), ...overlays.values()]) for (let i = 0; i < l.length; i++) if (l[i] === undefined) l[i] = null

  const take = (c) => {
    if (!c || !c.location) return null
    if (c.overlay_sequence != null) {
      const l = ovOf(`${c.controller}:${c.location}:${c.sequence}`)
      return c.overlay_sequence < l.length ? l.splice(c.overlay_sequence, 1)[0] : null
    }
    if (LIST.has(c.location)) {
      const l = listOf(c.controller, c.location)
      const u = c.sequence < l.length ? l.splice(c.sequence, 1)[0] : null
      return loose.has(`${c.controller}:${c.location}`) ? null : u
    }
    if (ZONE.has(c.location)) {
      const k = `${c.controller}:${c.location}:${c.sequence}`
      const u = zones.get(k) ?? null
      zones.delete(k)
      return u
    }
    return null
  }
  const put = (c, uid) => {
    if (!c || !c.location) return
    if (c.overlay_sequence != null) {
      const l = ovOf(`${c.controller}:${c.location}:${c.sequence}`)
      l.splice(Math.min(c.overlay_sequence, l.length), 0, uid)
    } else if (LIST.has(c.location)) {
      const l = listOf(c.controller, c.location)
      l.splice(Math.min(c.sequence, l.length), 0, uid)
    } else if (ZONE.has(c.location)) {
      zones.set(`${c.controller}:${c.location}:${c.sequence}`, uid)
    }
  }
  const hostMove = (from, to) => {
    const a = overlays.get(`${from.controller}:${from.location}:${from.sequence}`)
    if (!a) return
    overlays.delete(`${from.controller}:${from.location}:${from.sequence}`)
    if (to && ZONE.has(to.location) && to.overlay_sequence == null) overlays.set(`${to.controller}:${to.location}:${to.sequence}`, a)
  }

  for (const m of msgs) {
    switch (m.type) {
      case 50: {
        const uid = take(m.from)
        if (m.from?.overlay_sequence == null && m.from && ZONE.has(m.from.location)) hostMove(m.from, m.to)
        put(m.to, uid)
        break
      }
      case 90: {
        const deck = listOf(m.player, 1)
        const hand = listOf(m.player, 2)
        const blind = loose.has(`${m.player}:1`)
        for (let i = 0; i < (m.drawn || []).length; i++) {
          const u = deck.length ? deck.pop() : null
          hand.push(blind ? null : u)
        }
        break
      }
      case 55: {
        const a = take(m.card1)
        const b = take(m.card2)
        const oa = overlays.get(`${m.card1.controller}:${m.card1.location}:${m.card1.sequence}`)
        const ob = overlays.get(`${m.card2.controller}:${m.card2.location}:${m.card2.sequence}`)
        overlays.delete(`${m.card1.controller}:${m.card1.location}:${m.card1.sequence}`)
        overlays.delete(`${m.card2.controller}:${m.card2.location}:${m.card2.sequence}`)
        if (oa) overlays.set(`${m.card2.controller}:${m.card2.location}:${m.card2.sequence}`, oa)
        if (ob) overlays.set(`${m.card1.controller}:${m.card1.location}:${m.card1.sequence}`, ob)
        put(m.card2, a)
        put(m.card1, b)
        break
      }
      case 32: loose.add(`${m.player}:1`); break
      case 33: loose.add(`${m.player}:2`); break
      case 39: loose.add(`${m.player}:64`); break
      case 35: loose.add(`${m.player}:1`); loose.add(`${m.player}:16`); loose.add(`${m.player}:64`); break
      case 37: loose.add('0:1'); loose.add('1:1'); break
      case 36: {
        const got = (m.cards || []).map(x => take(x.from))
        ;(m.cards || []).forEach((x, i) => put(x.to, got[i]))
        break
      }
    }
  }

  const at = new Map()
  for (const [k, l] of lists) {
    if (loose.has(k)) continue
    l.forEach((uid, i) => { if (uid) at.set(`${k}:${i}`, uid) })
  }
  for (const [k, uid] of zones) if (uid) at.set(k, uid)
  for (const [host, l] of overlays) l.forEach((uid, i) => { if (uid) at.set(`${host}:o${i}`, uid) })
  return at
}
