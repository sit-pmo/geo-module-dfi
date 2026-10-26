# geo-dfi — Filiation des parcelles (DFI, DGFiP)

Module GEO qui affiche l'**historique de filiation d'une parcelle cadastrale** : de quelles parcelles elle est issue et
ce qu'elle est devenue, sous forme de graphe (parcelles mères → opération → parcelles filles).

> Projet communautaire indépendant, **non affilié à la DGFiP ni à Business Geografic**. GEO est un produit de Business Geografic.

## Fonctionnement

Onglet de la **barre latérale droite**, avec une barre de contrôle (bouton **plein écran** : le panneau prend toute la largeur, Échap pour en sortir) : on saisit la référence de la parcelle (IDU, 14 caractères, par exemple
`38544000BI0498`) ; le module affiche le graphe de ses ancêtres et de ses descendants. Chaque opération (division, réunion,
lotissement, remaniement…) indique sa date et la nature du document (arpentage, croquis de conservation…). Un clic sur une
parcelle ou une opération en donne le détail et permet de suivre la filiation d'une autre parcelle du graphe.

Les données sont des **fichiers JSON statiques, un par commune**, préparés par
[integrator-dfi](https://github.com/vienne-condrieu-agglomeration/geo-community-integrator-dfi) à partir du jeu
[« Documents de filiation informatisés (DFI) des parcelles »](https://www.data.gouv.fr/datasets/documents-de-filiation-informatises-dfi-des-parcelles)
de la DGFiP et publiés sur GitHub Pages
([geo-community-data-dfi](https://github.com/vienne-condrieu-agglomeration/geo-community-data-dfi)). Le module n'a besoin ni
de serveur ni de base de données. Il lit d'abord `index.json` et **refuse un format de données qu'il ne connaît pas**.

**Limites** : l'historique informatisé commence vers 1988-1990 ; les aménagements fonciers ruraux (remembrements) n'y figurent pas.

## Réglages du Générateur

| Réglage | Rôle |
|---|---|
| Adresse des données | Dossier des fichiers JSON (par défaut les pages GitHub ci-dessus) |
| Communes du territoire | Codes INSEE autorisés (vide : toutes les communes publiées) |
| Nom et largeur de l'onglet | Libellé de l'onglet ; part de l'écran occupée par le panneau |

Zones du gabarit : le module n'est proposé que pour la barre latérale droite (`widget.side.pro`, `widget.side`), jamais pour l'ensemble du gabarit
(`global.pro`). Constaté sur GEO 4.5.0 : la zone « Lanceur de fonctionnalités » (bandeau de gauche) n'accepte pas le module, et un onglet de type
`leftpanel` n'apparaît pas dans le gabarit Pro. Le module s'enregistre lui-même dans le panneau et ne lit qu'une configuration, même s'il a été
déposé plusieurs fois (avertissement dans la console).

## Source et licence des données

Données de la DGFiP sous [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/). Le module affiche la
source et la **date de mise à jour** des données (`situation` de `index.json`), comme la licence l'exige.

## Journal des nouveautés

`CHANGELOG.md` (Keep a Changelog, en français, pour les utilisateurs) est embarqué dans le module : le lien « Nouveautés » en bas du
panneau ouvre une fenêtre qui le montre. Les fichiers `src/js/changelog.js`, `scripts/check-version.js` et `test/changelog.test.mjs` sont
copiés du gabarit du dépôt d'origine (ne pas les modifier ici). `npm test` vérifie que `package.json`, `src/plugin.geoext.json` et le
premier `## [x.y.z]` du journal portent la même version.

## Développement

```bash
npm install
npm test          # versions, journal des nouveautés, logique du module (Node)
npm run build     # dist/main.js
npm run package   # build + geo-dfi_AAAAMMJJ-HHMM.zip (import dans le Générateur, ancienne interface : Modules > + Module)
```

La logique sans GEO ni Angular est dans `src/js/dfi-data.js` (lecture des données, graphe, mise en page), testée sous Node ; l'interface
est dans `src/js/extension.js`.

## Points d'attention

- Le module lit les données avec `fetch` (et non `$http`, dont les intercepteurs de GEO pourraient joindre des en-têtes d'identification) :
  les données doivent être servies avec `access-control-allow-origin: *` (c'est le cas de GitHub Pages).
- **Pas encore de localisation sur la carte** : un bouton « Localiser sur la carte », qui s'appuierait sur la recherche de parcelle du cadastre de
  l'application, est à l'étude (les filtres de cette recherche sont liés en cascade et se bloquent quand on les fixe par programme).
- Un graphe très ramifié (plusieurs centaines de parcelles liées) est large : défiler dans le cadre, ou passer en plein écran.
