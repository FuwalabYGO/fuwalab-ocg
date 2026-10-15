# fuwalab-ocg

Rules engine integration used by the automatic mode of the FUWALAB duel simulator.
Code source du mode « Règles automatiques » du simulateur FUWALAB.

## License

This repository is licensed under the GNU Affero General Public License, version 3 or later. See [LICENSE](LICENSE).

It is published to comply with the AGPL-3.0, because the simulator runs and serves to its users:

- [ygopro-core](https://github.com/edo9300/ygopro-core) (EDOPro core), AGPL-3.0-or-later, Copyright (C) Project Ignis / edo9300 and contributors.
- [CardScripts](https://github.com/ProjectIgnis/CardScripts), AGPL-3.0-or-later, Copyright (C) Project Ignis contributors.
- [BabelCDB](https://github.com/ProjectIgnis/BabelCDB), card database by Project Ignis.
- [ocgcore-wasm](https://github.com/n1xx1/ocgcore-wasm) 0.1.4, MIT, WebAssembly wrapper of ygopro-core.
- [strings.conf](https://raw.githubusercontent.com/ProjectIgnis/Distribution/master/config/strings.conf) from Project Ignis Distribution.
- French and Spanish system strings in `ocg/i18n.json` from Project Ignis Distribution (`config/languages`), AGPL-3.0. Effect string translations in the same file are by FUWALAB.

## Exact versions used

Card data is rebuilt daily by the [Cartes workflow](.github/workflows/cards.yml) and published as a [release](https://github.com/FuwalabYGO/fuwalab-ocg/releases/latest). Each release lists the exact CardScripts and BabelCDB commits it was built from, and the live site downloads the latest one.

- Core: ocgcore-wasm 0.1.4 ([`2f79a462f3`](https://github.com/n1xx1/ocgcore-wasm/tree/2f79a462f3f2cba6a0ec0092ad024446490ded45)), built with emscripten 3.1.6 from [ygopro-core](https://github.com/edo9300/ygopro-core) [`93eff32a9b`](https://github.com/edo9300/ygopro-core/tree/93eff32a9bfc65cc3a748c7cf8a8774c10260b7f) and [Lua](https://github.com/lua/lua) [`75ea9ccbea`](https://github.com/lua/lua/tree/75ea9ccbea7c4886f30da147fb67b693b2624c26). Rebuild with `ocg/build-core.sh` (details in `ocg/core/build.json`).

## Contents

- `ocg/`: engine loop, Web Worker, card data sync (`sync.mjs`), command line test, export script.
- `ocg/core/`: WebAssembly build of ygopro-core with the ocgcore-wasm 0.1.4 wrapper, produced by `ocg/build-core.sh`. ygopro-core and Lua are unmodified; the wrapper gets the message parser fixes in `ocg/core-patches/`.
- `app/simulator/ocg/`: React hook and panel connecting the engine to the simulator, and the route serving engine files.

Card scripts and databases are not copied here: `node ocg/sync.mjs` downloads them from the repositories above and packs them into `ocg/vendor/`. `ocg/update.mjs` downloads the latest release on the live server.

The rest of the simulator interface communicates with the engine through Web Worker messages only.

Yu-Gi-Oh! card names, texts and artwork are property of Konami. This project is not affiliated with or endorsed by Konami.
