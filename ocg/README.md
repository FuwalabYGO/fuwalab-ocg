# OCG Lab (prototype simulateur automatique)

Moteur de règles EDOPro (ygopro-core, build WASM `ocgcore-wasm` 0.1.2, MIT) exécuté dans un Web Worker.
Scripts de cartes et base : Project Ignis (CardScripts, BabelCDB), licence AGPL-3.0.

## Fichiers

- `sync.mjs` : clone ou met à jour CardScripts et BabelCDB dans le dossier temporaire (`OCG_GIT_DIR` pour le changer), puis génère dans `vendor/` : `scripts.pack` (tous les .lua dans un seul fichier, index dans `scripts-index.json`), `cards.json`, `texts.json`, `strings.json`.
- `engine.js` : boucle de duel, réponses automatiques de l'adversaire, lecture du plateau.
- `worker.js` : Web Worker du navigateur (scripts chargés à la demande par XHR synchrone).
- `core/` : copie du build `ocgcore-wasm` (sync uniquement).
- `test-node.mjs` : duel de test en ligne de commande.
- `export.mjs` : prépare le dépôt public AGPL (`node ocg/export.mjs <dossier>`), voir plus bas.
- `vendor/versions.json` : commits exacts des scripts et de la base, écrit par `sync.mjs`.
- Intégration simulateur : `app/simulator/ocg/` (hook `useOcgDuel`, panneau `OcgPanel`, fichiers servis par `res/[...p]/route.js`), branché dans `SoloSimulator.jsx` (bouton « Règles automatiques » du lobby) et action `OCG_SYNC` dans `gameEngine.js`.

## Mise en route

```bash
node ocg/sync.mjs
node ocg/test-node.mjs
```

Puis `/simulator`, activer « Règles automatiques (bêta) » dans le lobby.

## Limites connues

- Le build WASM date d'avril 2026, les scripts sont plus récents : `CHAININFO_TRIGGERING_LINK/LSCALE/RSCALE` sont neutralisés par un shim dans `engine.js`. La 0.1.4 (JSR) suit le core d'août 2026.
- Textes d'effets en anglais (BabelCDB).

## Licence et dépôt public

Le core et les scripts sont sous AGPL-3.0 : tout ce qui touche au moteur est publié sur https://github.com/FuwalabYGO/fuwalab-ocg (constante `OCG_SOURCE_URL` dans `app/simulator/ocg/license.js`, lien affiché dans le lobby en mode automatique).

À chaque modification de `ocg/` ou `app/simulator/ocg/`, ou après un `sync.mjs` déployé en prod :

```bash
node ocg/export.mjs ../fuwalab-ocg
cd ../fuwalab-ocg && git add -A && git commit -m "Mise à jour" && git push
```

Le code du moteur doit rester dans ces deux dossiers : le reste du simulateur ne lui parle que par messages au Worker.

## Tout supprimer

Supprimer `ocg/` et `app/simulator/ocg/`, puis retirer de `SoloSimulator.jsx` les lignes qui mentionnent `ocg` et de `gameEngine.js` le cas `OCG_SYNC`.
