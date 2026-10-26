# Journal des nouveautés

Toutes les évolutions notables du module « Filiation des parcelles (DFI, DGFiP) ». Le format suit
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le versionnement
[SemVer](https://semver.org/lang/fr/).

Ce fichier est affiché dans GEO, dans la fenêtre « Nouveautés » du module : il s'écrit pour les
**utilisateurs**, en français, pas pour les développeurs (la liste des commits est dans git). La version
la plus récente publiée doit être celle de `package.json` et de `src/plugin.geoext.json`
(`npm test` le vérifie).

## [Non publié]

## [0.1.0] — 2026-10-26

### Ajouté

- Onglet de la barre latérale droite : saisissez la référence d'une parcelle (IDU, 14 caractères) pour voir son
  historique de filiation sous forme de graphe : parcelles mères, opérations (division, réunion, lotissement,
  remaniement…) avec leur date et leur nature, puis parcelles filles. Un clic sur une parcelle ou une opération
  en donne le détail et permet de suivre la filiation de la parcelle choisie
- Barre de contrôle avec un bouton **plein écran** : le panneau prend toute la largeur de l'écran pour mieux lire les graphes volumineux (Échap pour revenir)
- Les données sont les Documents de filiation informatisés de la DGFiP (Licence Ouverte 2.0), lues dans des
  fichiers statiques par commune : aucun serveur à installer. Leur date de mise à jour est affichée avec la source
- Réglages : adresse des données, communes du territoire, nom et largeur de l'onglet
