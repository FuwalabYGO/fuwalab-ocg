import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const OCG = dirname(fileURLToPath(import.meta.url))
const APP = join(OCG, '..')
const GIT = process.env.OCG_GIT_DIR || join(tmpdir(), 'fuwalab-ocg')
const DEST = process.argv[2] ? resolve(process.argv[2]) : null
const OCG_FILES = ['LICENSE', 'README.md', 'engine.js', 'worker.js', 'sync.mjs', 'test-node.mjs', 'export.mjs']

if (!DEST) {
  console.warn('[ocg-export] usage : node ocg/export.mjs <dossier du dépôt public>')
  process.exit(1)
}

function readVersions() {
  try {
    return JSON.parse(readFileSync(join(OCG, 'vendor', 'versions.json'), 'utf8'))
  } catch (e) {
    console.warn('[ocg-export] versions.json absent, lancer node ocg/sync.mjs', e.message)
    process.exit(1)
  }
}

function licenseText() {
  for (const p of [join(OCG, 'LICENSE'), join(GIT, 'CardScripts', 'COPYING')]) {
    try {
      if (existsSync(p)) return readFileSync(p, 'utf8')
    } catch (e) {
      console.warn('[ocg-export] licence', p, e.message)
    }
  }
  console.warn('[ocg-export] texte AGPL introuvable, lancer node ocg/sync.mjs avant')
  process.exit(1)
}

function readme(v) {
  const repo = (n) => {
    const r = v.repos[n]
    return r.commit ? `[${n}](${r.url}) @ [\`${r.commit.slice(0, 10)}\`](${r.url}/tree/${r.commit}) (${r.date})` : `[${n}](${r.url})`
  }
  return `# fuwalab-ocg

Rules engine integration used by the automatic mode of the FUWALAB duel simulator.
Code source du mode « Règles automatiques » du simulateur FUWALAB.

## License

This repository is licensed under the GNU Affero General Public License, version 3 or later. See [LICENSE](LICENSE).

It is published to comply with the AGPL-3.0, because the simulator runs and serves to its users:

- [ygopro-core](${v.core.core}) (EDOPro core), AGPL-3.0-or-later, Copyright (C) Project Ignis / edo9300 and contributors.
- [CardScripts](${v.repos.CardScripts.url}), AGPL-3.0-or-later, Copyright (C) Project Ignis contributors.
- [BabelCDB](${v.repos.BabelCDB.url}), card database by Project Ignis.
- [${v.core.name}](${v.core.url}) ${v.core.version}, MIT, WebAssembly build of ygopro-core.
- [strings.conf](${v.strings.url}) from Project Ignis Distribution.

## Exact versions used

- Core: ${v.core.name} ${v.core.version}, built from [ygopro-core](${v.core.core})
- ${repo('CardScripts')}
- ${repo('BabelCDB')}
- Generated: ${v.generatedAt}

Full details in [ocg/vendor/versions.json](ocg/vendor/versions.json).

## Contents

- \`ocg/\`: engine loop, Web Worker, card data sync (\`sync.mjs\`), command line test, export script.
- \`ocg/core/\`: unmodified build of ${v.core.name} ${v.core.version}.
- \`app/simulator/ocg/\`: React hook and panel connecting the engine to the simulator, and the route serving engine files.

Card scripts and databases are not copied here: \`node ocg/sync.mjs\` downloads them from the repositories above and packs them into \`ocg/vendor/\`. The commits used by the live site are listed above.

The rest of the simulator interface communicates with the engine through Web Worker messages only.

Yu-Gi-Oh! card names, texts and artwork are property of Konami. This project is not affiliated with or endorsed by Konami.
`
}

const v = readVersions()
const license = licenseText()
mkdirSync(DEST, { recursive: true })
for (const f of readdirSync(DEST)) if (f !== '.git') rmSync(join(DEST, f), { recursive: true, force: true })
mkdirSync(join(DEST, 'ocg', 'vendor'), { recursive: true })
for (const f of OCG_FILES) cpSync(join(OCG, f), join(DEST, 'ocg', f))
cpSync(join(OCG, 'core'), join(DEST, 'ocg', 'core'), { recursive: true })
cpSync(join(OCG, 'vendor', 'versions.json'), join(DEST, 'ocg', 'vendor', 'versions.json'))
cpSync(join(APP, 'app', 'simulator', 'ocg'), join(DEST, 'app', 'simulator', 'ocg'), { recursive: true })
writeFileSync(join(DEST, 'LICENSE'), license)
writeFileSync(join(DEST, 'README.md'), readme(v))
console.log('[ocg-export] dépôt prêt dans', DEST)
