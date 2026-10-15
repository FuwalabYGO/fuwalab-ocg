# OCG Lab (prototype simulateur automatique)

Moteur de règles EDOPro (ygopro-core) compilé en WASM avec l'enveloppe `ocgcore-wasm` 0.1.4 (MIT), exécuté dans un Web Worker.
Scripts de cartes et base : Project Ignis (CardScripts, BabelCDB), licence AGPL-3.0.

## Fichiers

- `sync.mjs` : clone ou met à jour CardScripts et BabelCDB dans le dossier temporaire (`OCG_GIT_DIR` pour le changer), puis génère dans `vendor/` : `scripts.pack` (tous les .lua dans un seul fichier, index dans `scripts-index.json`), `cards.json`, `texts.json`, `strings.json`.
- `engine.js` : boucle de duel, IA de l'adversaire (`aiResponse` : attaques qui gagnent le combat, position selon la menace, hand traps après une invocation adverse, cibles adverses les plus fortes, coûts sur les cartes les plus faibles), lecture du plateau, filtre des cartes déclarables (`declarable`).
- `worker.js` : Web Worker du navigateur (scripts chargés à la demande par XHR synchrone).
- `core/` : build WASM produit par `build-core.sh` (versions exactes dans `core/build.json`).
- `build-core.sh` : recompile `core/` (emscripten, git, node). Change les commits en tête du script pour suivre un core plus récent, puis relance-le. Met aussi à jour `OCG_CORE_ID` dans `app/simulator/ocg/license.js`.
- `core-patches/` : corrections du parseur de messages de `ocgcore-wasm` (`SHUFFLE_SET_CARD`, `ANNOUNCE_ATTRIB`), appliquées par `build-core.sh`.
- `i18n.json` : textes système FR/ES (Distribution Project Ignis) et traductions FR/ES des 1 000 descriptions d'effets les plus fréquentes, indexées par gabarit anglais (`"X"` = nom de carte, `N` = nombre). Les autres restent en anglais.
- `test-node.mjs` : duel de test en ligne de commande.
- `export.mjs` : prépare le dépôt public AGPL (`node ocg/export.mjs <dossier>`), voir plus bas.
- `vendor/versions.json` : commits exacts des scripts et de la base, écrit par `sync.mjs`.
- `update.mjs` : mise à jour automatique des cartes sur le serveur (lancé par `server.js`, 2 min après le boot puis toutes les 6 h).
- `release.mjs` et `ci/cards.yml` : workflow GitHub du dépôt public (copié dans `.github/workflows/` par l'export).
- Intégration simulateur : `app/simulator/ocg/` (hook `useOcgDuel`, panneau `OcgPanel`, suivi des cartes `track.js`, fichiers servis par `res/[...p]/route.js`), branché dans `SoloSimulator.jsx` (bouton « Règles automatiques » du lobby) et action `OCG_SYNC` dans `gameEngine.js`.

## Mise en route

```bash
node ocg/sync.mjs
node ocg/test-node.mjs
```

Puis `/simulator`, activer « Règles automatiques (bêta) » dans le lobby.

## Suivi des cartes

Le moteur ne donne pas d'identifiant fixe aux cartes. `track.js` rejoue les messages (`MOVE`, `DRAW`, `SWAP`, mélanges) sur le plateau précédent pour savoir où va chaque `uid`, ce qui fait partir les animations du bon exemplaire. Après un mélange, les cartes concernées retombent sur l'appariement par code.

## Annulation

Le worker note la position dans la liste des réponses à chaque décision du joueur (commande principale, combat, chaîne, effet optionnel). « Annuler » recrée le duel avec la même graine et rejoue les réponses jusqu'à la dernière décision (`fastForward`). Le hook restaure le journal et les `uid` de ce moment. Dans le replay, le frame d'annulation porte `c` : la liste des réponses est tronquée à `c` après ajout de son `r`.

Outils manuels : seules les consultations (Deck, Extra) restent actives en mode automatique, le moteur ne permet pas de déplacer une carte hors des règles.

## Limites connues

- Descriptions d'effets : environ 60 % des occurrences sont traduites (`i18n.json`), le reste est en anglais.

## Licence et dépôt public

Le core et les scripts sont sous AGPL-3.0 : tout ce qui touche au moteur est publié sur https://github.com/FuwalabYGO/fuwalab-ocg (constante `OCG_SOURCE_URL` dans `app/simulator/ocg/license.js`, lien affiché dans le lobby en mode automatique).

## Mise à jour automatique des cartes

1. Chaque nuit, le workflow « Cartes » du dépôt public lance `sync.mjs` sur GitHub et publie une release avec les 6 fichiers de `vendor/` si les scripts ou la base ont changé (5 dernières releases gardées).
2. `update.mjs` compare toutes les 6 h les commits de `vendor/versions.json` avec ceux de la dernière release. S'ils diffèrent, il télécharge dans `vendor.next/`, vérifie `scripts.pack`, puis remplace `vendor/`.
3. La route `res/` recharge l'index des scripts dès que `scripts-index.json` change, sans redémarrage.

Rien à faire à la main. Le core WASM, lui, ne se met pas à jour : relancer `ocg/build-core.sh` avec les nouveaux commits (Linux ou WSL, emscripten requis). Les replays enregistrés avec un autre core gardent la lecture mais perdent « Jouer à partir d'ici » (`o.core` comparé à `OCG_CORE_ID`).

## Republier le code

À chaque modification de `ocg/` ou `app/simulator/ocg/` :

```bash
node ocg/export.mjs ../fuwalab-ocg
cd ../fuwalab-ocg && git add -A && git commit -m "Mise à jour" && git push
```

Le code du moteur doit rester dans ces deux dossiers : le reste du simulateur ne lui parle que par messages au Worker.

## Tout supprimer

Supprimer `ocg/` et `app/simulator/ocg/`, puis retirer de `SoloSimulator.jsx` les lignes qui mentionnent `ocg` et de `gameEngine.js` le cas `OCG_SYNC`.
