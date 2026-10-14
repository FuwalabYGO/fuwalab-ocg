# fuwalab-ocg

Rules engine integration used by the automatic mode of the FUWALAB duel simulator.
Code source du mode « Règles automatiques » du simulateur FUWALAB.

## License

This repository is licensed under the GNU Affero General Public License, version 3 or later. See [LICENSE](LICENSE).

It is published to comply with the AGPL-3.0, because the simulator runs and serves to its users:

- [ygopro-core](https://github.com/edo9300/ygopro-core) (EDOPro core), AGPL-3.0-or-later, Copyright (C) Project Ignis / edo9300 and contributors.
- [CardScripts](https://github.com/ProjectIgnis/CardScripts), AGPL-3.0-or-later, Copyright (C) Project Ignis contributors.
- [BabelCDB](https://github.com/ProjectIgnis/BabelCDB), card database by Project Ignis.
- [@n1xx1/ocgcore-wasm](https://github.com/n1xx1/ocgcore-wasm) 0.1.2, MIT, WebAssembly build of ygopro-core.
- [strings.conf](https://raw.githubusercontent.com/ProjectIgnis/Distribution/master/config/strings.conf) from Project Ignis Distribution.

## Exact versions used

- Core: @n1xx1/ocgcore-wasm 0.1.2, built from [ygopro-core](https://github.com/edo9300/ygopro-core)
- [CardScripts](https://github.com/ProjectIgnis/CardScripts) @ [`b5a9480fa1`](https://github.com/ProjectIgnis/CardScripts/tree/b5a9480fa111cac197d0a541e6243e8619ab4c52) (2026-10-14T15:28:25+03:00)
- [BabelCDB](https://github.com/ProjectIgnis/BabelCDB) @ [`70e49a14dd`](https://github.com/ProjectIgnis/BabelCDB/tree/70e49a14dd2dcba7855efb37a371473655cb800e) (2026-10-13T18:25:16-07:00)
- Generated: 2026-10-14T12:37:26.658Z

Full details in [ocg/vendor/versions.json](ocg/vendor/versions.json).

## Contents

- `ocg/`: engine loop, Web Worker, card data sync (`sync.mjs`), command line test, export script.
- `ocg/core/`: unmodified build of @n1xx1/ocgcore-wasm 0.1.2.
- `app/simulator/ocg/`: React hook and panel connecting the engine to the simulator, and the route serving engine files.

Card scripts and databases are not copied here: `node ocg/sync.mjs` downloads them from the repositories above and packs them into `ocg/vendor/`. The commits used by the live site are listed above.

The rest of the simulator interface communicates with the engine through Web Worker messages only.

Yu-Gi-Oh! card names, texts and artwork are property of Konami. This project is not affiliated with or endorsed by Konami.
