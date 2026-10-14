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

Card data is rebuilt daily by the [Cartes workflow](.github/workflows/cards.yml) and published as a [release](https://github.com/FuwalabYGO/fuwalab-ocg/releases/latest). Each release lists the exact CardScripts and BabelCDB commits it was built from, and the live site downloads the latest one.

- Core: @n1xx1/ocgcore-wasm 0.1.2, built from [ygopro-core](https://github.com/edo9300/ygopro-core)

## Contents

- `ocg/`: engine loop, Web Worker, card data sync (`sync.mjs`), command line test, export script.
- `ocg/core/`: unmodified build of @n1xx1/ocgcore-wasm 0.1.2.
- `app/simulator/ocg/`: React hook and panel connecting the engine to the simulator, and the route serving engine files.

Card scripts and databases are not copied here: `node ocg/sync.mjs` downloads them from the repositories above and packs them into `ocg/vendor/`. `ocg/update.mjs` downloads the latest release on the live server.

The rest of the simulator interface communicates with the engine through Web Worker messages only.

Yu-Gi-Oh! card names, texts and artwork are property of Konami. This project is not affiliated with or endorsed by Konami.
