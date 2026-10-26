# Journal des nouveautés

Toutes les évolutions notables du module « Filiation des parcelles (DFI, DGFiP) ». Le format suit
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le versionnement
[SemVer](https://semver.org/lang/fr/).

Ce fichier est affiché dans GEO, dans la fenêtre « Nouveautés » du module : il s'écrit pour les
**utilisateurs**, en français, pas pour les développeurs (la liste des commits est dans git). La version
la plus récente publiée doit être celle de `package.json` et de `src/plugin.geoext.json`
(`npm test` le vérifie).

## [Non publié]

## [0.2.0] — 2026-10-26

### Ajouté

- Bouton **« Localiser sur la carte »** sur la parcelle cherchée et sur chaque parcelle du graphe : la carte zoome sur la
  parcelle, qui est centrée dans la partie non recouverte par le panneau, et son contour est dessiné. « Effacer le repérage »
  retire le contour. Une parcelle qui n'existe plus au cadastre (divisée, réunie ou renumérotée) est signalée au lieu d'être
  localisée. En plein écran, le module repasse en panneau normal pour montrer la carte
- Le contour vient de l'API Carto Cadastre de l'IGN (service public, sans inscription) : l'adresse IP du poste et la référence
  de la parcelle lui sont transmises. Réglages : activer ou non le bouton, adresse du service

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
