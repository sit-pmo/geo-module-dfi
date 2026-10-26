# Licences des composants tiers

Le fichier `main.js` livré avec le module (`npm run build`) **n'embarque aucun composant tiers** : le bundle ne
contient que le code du module (GPL-3.0-or-later, voir `LICENSE`). AngularJS et OpenLayers sont fournis par la
plateforme GEO et non redistribués ici ; les dépendances de développement (webpack, archiver…) ne sont pas dans le
bundle.

## Données

Le module affiche les **Documents de filiation informatisés (DFI) des parcelles** de la DGFiP, sous
[Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/), lus à l'exécution dans des fichiers
publiés séparément (voir <https://github.com/vienne-condrieu-agglomeration/geo-community-data-dfi>). Ces données ne
sont pas embarquées dans le module.
