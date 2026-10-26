/**
 * geo-dfi — filiation des parcelles cadastrales (Documents de Filiation Informatisés de la DGFiP) dans un onglet
 * de la barre latérale droite de GEO : saisie d'un IDU, graphe des parcelles mères, des lots et des parcelles filles.
 *
 * Les données sont des fichiers JSON statiques (un par commune) préparés par integrator-dfi et publiés sur GitHub
 * Pages : aucun serveur, aucune base de données. Source : DGFiP, Licence Ouverte 2.0.
 * La logique sans GEO ni Angular est dans dfi-data.js (testée sous Node).
 */
import angular from 'angular';
import pluginConf from '../plugin.geoext.json';

import * as dfi from './dfi-data.js';
import { createChangelog } from './changelog.js';
import changelogMd from '../../CHANGELOG.md';

angular
    .module(pluginConf.code.moduleName, pluginConf.code.dependencies)
    .run(['geoApplication', 'acfExtensionService', '$rootScope', '$injector',
          function (geoApplication, acfExtensionService, $rootScope, $injector) {

        var changelog = createChangelog({
            name: pluginConf.name, title: pluginConf.displayName, version: pluginConf.version,
            markdown: changelogMd, prefix: 'geo-dfi'
        });

        // ============================================================
        // Configuration (remplie depuis le Générateur GEO)
        // ============================================================
        var _DEFAULT_DATA_URL = 'https://vienne-condrieu-agglomeration.github.io/geo-community-data-dfi/';
        var _dataUrl      = _DEFAULT_DATA_URL;
        var _communes     = null;          // { insee: true } ou null (toutes les communes publiées)
        var _toolName     = 'Filiation des parcelles';
        var _panelWidthPct = 45;       // largeur courante du panneau (100 en plein écran)
        var _panelWidthCfg = 45;       // largeur réglée dans le Générateur
        var _FULLSCREEN_BODY_CLASS = 'geo-dfi-fullscreen-active';
        var _registered   = false;
        var _widgetId     = null;
        var _currentScope = null;

        // Données en mémoire pour la durée de la page : index, puis un index de parcelles par commune
        var _indexPromise = null;
        var _source       = { dateLabel: '', millesime: '' };
        var _lookups      = {};            // insee -> promesse de { lookup }

        function _lucideSvg(inner) {
            return '<svg class="geo-dfi-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
                 + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
                 + inner + '</svg>';
        }
        var _ICONS = {
            maximize: _lucideSvg('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>'
                                + '<path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'),
            minimize: _lucideSvg('<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/>'
                                + '<path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>')
        };

        geoApplication.executeWhenInitialized(function () {
            var conf = geoApplication.getConfigurationByExtensionKey(pluginConf.name);
            if (!conf || conf.length < 1) {
                console.warn('[geo-dfi] aucune configuration pour ' + pluginConf.name + ' : onglet non enregistré.');
                return;
            }
            // Un module déposé plusieurs fois dans le gabarit donne plusieurs entrées : seule la première est lue.
            if (conf.length > 1) {
                console.warn('[geo-dfi] ' + conf.length + ' configurations pour ' + pluginConf.name
                    + ' (module déposé plusieurs fois dans le gabarit ?) : seule la première est utilisée.');
            }
            var props = conf[0].properties || {};

            _dataUrl      = String(props.dataUrl || '').trim() || _DEFAULT_DATA_URL;
            _toolName     = String(props.toolName || '').trim() || _toolName;
            var width     = parseFloat(props.panelWidth);
            _panelWidthPct = width >= 25 && width <= 80 ? width : _panelWidthPct;
            _panelWidthCfg = _panelWidthPct;

            var codes = String(props.communes || '').toUpperCase().split(/[\s,;]+/)
                .filter(function (c) { return /^\d[0-9AB]\d{3}$/.test(c); });
            _communes = null;
            if (codes.length) { _communes = {}; codes.forEach(function (c) { _communes[c] = true; }); }

            if (!_registered) {
                _registered = true;
                _injectStyles();
                _registerWidget();
            }
        });

        // ============================================================
        // Panneau natif GEO
        // ============================================================
        function _registerWidget() {
            acfExtensionService.registerWidgetExtension({
                type:         window.bgCanvasId === 'pro1' ? 'rightPanel' : 'widget.side',
                key:          pluginConf.name,
                extensionKey: pluginConf.name,
                name:         _toolName,
                icon:         'icon_search',          // icône native GEO (à remplacer par une icône de filiation)
                active:       false,
                widthPolicy:  'custom',
                enable:       function () { return true; },
                template:     _buildTemplate(),
                controller:   _buildController(),
                configure:    function (ext) {
                    _widgetId = ext && ext.id ? ext.id : pluginConf.name;
                    _requestPanelWidthSoon();
                }
            });
            $rootScope.$on('activeRightTabChanged', function (event, tabId) {
                if (tabId === pluginConf.name || tabId === _widgetId) { _requestPanelWidthSoon(); }
            });
        }

        // Le panneau natif est étroit par défaut : un graphe a besoin de place.
        function _requestPanelWidth() {
            $rootScope.$broadcast('EXTENSION_WIDGET_ACTION', {
                action: 'setPanelSize', widgetId: _widgetId || pluginConf.name, width: _panelWidthPct
            });
            window.dispatchEvent(new Event('resize'));
        }
        function _requestPanelWidthSoon() {
            [0, 100, 300].forEach(function (delay) { setTimeout(_requestPanelWidth, delay); });
        }

        // ============================================================
        // Données
        // ============================================================
        // fetch du navigateur et non $http : les intercepteurs de GEO pourraient joindre des en-têtes d'authentification
        // à cette adresse tierce (échec CORS et fuite de jeton). Voir dfi-data.js.
        function _fetch(url, options) { return window.fetch(url, options); }

        function _getIndex() {
            if (!_indexPromise) {
                _indexPromise = dfi.loadIndex(_fetch, _dataUrl).then(function (index) {
                    _source = { dateLabel: dfi.formatDate(index.situation), millesime: index.millesime || '' };
                    return index;
                });
                _indexPromise.catch(function () { _indexPromise = null; });   // nouvel essai possible
            }
            return _indexPromise;
        }

        function _getLookup(index, insee) {
            if (!_lookups[insee]) {
                _lookups[insee] = dfi.loadCommune(_fetch, _dataUrl, index, insee).then(dfi.buildLookup);
                _lookups[insee].catch(function () { delete _lookups[insee]; });
            }
            return _lookups[insee];
        }

        function _errorMessage(err, parsed) {
            console.error('[geo-dfi]', err);
            switch (err && err.code) {
                case 'network':  return 'Les données ne sont pas accessibles depuis ce poste (réseau ou accès à ' + _hostOf(_dataUrl) + ' bloqué).';
                case 'notfound': return "Les données sont introuvables à l'adresse configurée (" + _hostOf(_dataUrl) + ').';
                case 'commune':  return 'La commune ' + (parsed ? parsed.insee : '') + " n'est pas publiée dans les données.";
                default:         return (err && err.message) || 'Erreur inattendue (voir la console du navigateur).';
            }
        }
        function _hostOf(url) { var m = /^https?:\/\/([^/]+)/i.exec(url); return m ? m[1] : url; }

        // ============================================================
        // Gabarit et contrôleur du panneau
        // ============================================================
        function _buildTemplate() {
            return [
                '<div class="geo-dfi" ng-class="{\'geo-dfi--full\': isFullscreen}">',
                '  <div class="geo-dfi-bar">',
                '    <h3 class="geo-dfi-title">{{ title }}</h3>',
                '    <div class="geo-dfi-bar-actions">',
                '      <button type="button" class="geo-dfi-iconbtn" ng-class="{\'geo-dfi-iconbtn--on\': isFullscreen}" ng-click="toggleFullscreen()"',
                '              title="{{ isFullscreen ? \'Quitter le plein écran (Échap)\' : \'Plein écran\' }}"',
                '              aria-label="{{ isFullscreen ? \'Quitter le plein écran\' : \'Plein écran\' }}">',
                '        <span ng-if="!isFullscreen">' + _ICONS.maximize + '</span>',
                '        <span ng-if="isFullscreen">' + _ICONS.minimize + '</span>',
                '      </button>',
                '    </div>',
                '  </div>',
                '  <form class="geo-dfi-form" ng-submit="search()" novalidate>',
                '    <label for="geo-dfi-idu">Référence de la parcelle (IDU, 14 caractères)</label>',
                '    <div class="geo-dfi-row">',
                '      <input id="geo-dfi-idu" type="text" ng-model="state.idu" maxlength="24" autocomplete="off"',
                '             spellcheck="false" placeholder="38544000BI0498">',
                '      <button type="submit" class="geo-dfi-btn geo-dfi-btn--main" ng-disabled="state.loading">Chercher</button>',
                '    </div>',
                '  </form>',
                '  <div class="geo-dfi-msg geo-dfi-msg--error" role="alert" ng-if="state.error">{{ state.error }}</div>',
                '  <div class="geo-dfi-msg" ng-if="state.loading">Chargement des données…</div>',
                '  <div class="geo-dfi-result" ng-if="state.result">',
                '    <div class="geo-dfi-parcel">{{ state.result.label }} <span class="geo-dfi-idu">{{ state.result.idu }}</span></div>',
                '    <div class="geo-dfi-msg" ng-if="!state.result.hasHistory">Aucune filiation connue dans les DFI pour cette parcelle. ',
                '      L\'historique informatisé commence vers 1988-1990 et les remembrements n\'y figurent pas.</div>',
                '    <ul class="geo-dfi-summary" ng-if="state.result.hasHistory">',
                '      <li ng-repeat="t in state.result.originText">{{ t }}</li>',
                '      <li ng-repeat="t in state.result.futureText">{{ t }}</li>',
                '      <li ng-if="!state.result.futureText.length">Devenir : aucune évolution postérieure connue dans les DFI.</li>',
                '    </ul>',
                '    <div class="geo-dfi-msg" ng-if="state.result.truncated">Graphe tronqué : trop de parcelles liées.</div>',
                '    <div class="geo-dfi-graph" tabindex="-1"></div>',
                '    <div class="geo-dfi-detail" ng-if="state.selected">',
                '      <div class="geo-dfi-detail-title">{{ state.selected.title }}</div>',
                '      <div ng-repeat="line in state.selected.lines">{{ line }}</div>',
                '      <div class="geo-dfi-chips" ng-if="state.selected.mothers.length">Mère(s) :',
                '        <button type="button" class="geo-dfi-chip" ng-repeat="p in state.selected.mothers"',
                '                ng-click="focusParcel(p.idu)">{{ p.label }}</button></div>',
                '      <div class="geo-dfi-chips" ng-if="state.selected.daughters.length">Fille(s) :',
                '        <button type="button" class="geo-dfi-chip" ng-repeat="p in state.selected.daughters"',
                '                ng-click="focusParcel(p.idu)">{{ p.label }}</button></div>',
                '      <button type="button" class="geo-dfi-btn" ng-if="state.selected.parcel && !state.selected.current"',
                '              ng-click="focusParcel(state.selected.parcel.idu)">Voir la filiation de cette parcelle</button>',
                '    </div>',
                '  </div>',
                '  <div class="geo-dfi-foot">',
                '    Source : DGFiP, Documents de filiation informatisés (DFI){{ source.dateLabel ? \', mise à jour du \' + source.dateLabel : \'\' }},',
                '    Licence Ouverte 2.0. Projet communautaire, non affilié à la DGFiP ni à Business Geografic.',
                '    ' + changelog.linkHtml(),
                '  </div>',
                '</div>'
            ].join('\n');
        }

        function _buildController() {
            return ['$scope', '$element', '$timeout', function ($scope, $element, $timeout) {
                _currentScope = $scope;
                $scope.title     = _toolName;
                $scope.isFullscreen = false;
                $scope.source    = _source;
                $scope.state     = {
                    idu: '', loading: false, error: '', result: null, selected: null
                };
                var _layout = null;
                var _lookup = null;
                var _selectedId = null;

                // Lien « Nouveautés » : clic délégué (gabarit en HTML brut) ; repère « nouveau » remis à jour.
                $element[0].addEventListener('click', function (e) {
                    if (e.target.closest && e.target.closest('[data-changelog]')) { changelog.open(); }
                });
                $timeout(function () { changelog.refresh(); });

                function _apply(fn) { $timeout(fn, 0); }   // les promesses natives sont hors du cycle Angular

                $scope.search = function () {
                    var st = $scope.state;
                    st.error = ''; st.selected = null;
                    var parsed = dfi.parseIdu(st.idu);
                    if (!parsed) {
                        st.result = null;
                        st.error = 'Référence invalide : 14 caractères attendus (INSEE 5, préfixe 3, section 2, numéro 4), '
                            + 'par exemple 38544000BI0498.';
                        return;
                    }
                    if (_communes && !_communes[parsed.insee]) {
                        st.result = null;
                        st.error = 'La commune ' + parsed.insee + " ne fait pas partie du territoire configuré pour ce module.";
                        return;
                    }
                    st.loading = true; st.result = null;
                    _getIndex().then(function (index) { return _getLookup(index, parsed.insee); })
                        .then(function (lookup) { _apply(function () { _show(lookup, parsed); }); })
                        .catch(function (err) { _apply(function () { st.loading = false; st.error = _errorMessage(err, parsed); }); });
                };

                function _lotText(prefix, l) {
                    return prefix + l.kind + ' le ' + l.dateLabel + ' (' + l.natureLabel + ', DFI ' + l.dfi + '), '
                        + 'parcelle(s) mère(s) : ' + (l.mothers.length ? l.mothers.map(dfi.parcelLabel).join(', ') : 'aucune')
                        + ' ; fille(s) : ' + (l.daughters.length ? l.daughters.map(dfi.parcelLabel).join(', ') : 'aucune') + '.';
                }

                function _show(lookup, parsed) {
                    var st = $scope.state;
                    _lookup = lookup;
                    st.loading = false;
                    var graph = dfi.buildGraph(lookup, parsed.key);
                    var summary = dfi.parcelSummary(lookup, parsed.key);
                    st.result = {
                        parsed: parsed, idu: parsed.idu, label: dfi.parcelLabel(parsed.key), hasHistory: graph.hasHistory,
                        truncated: graph.truncated,
                        originText: summary.origin.map(function (l) { return _lotText('Origine : ', l); }),
                        futureText: summary.future.map(function (l) { return _lotText('Devenir : ', l); })
                    };
                    _layout = dfi.layoutGraph(graph, function (n) {
                        if (n.type === 'parcel') { return dfi.parcelLabel(n.key); }
                        var d = dfi.describeLot(lookup.lots[n.index]);
                        return d.kind + ' ' + d.dateLabel + (n.hidden ? ' (+' + n.hidden + ')' : '');
                    });
                    _selectedId = 'p:' + parsed.key;
                    $timeout(_draw, 0);   // le conteneur est créé par ng-if au prochain cycle
                }

                function _draw() {
                    var container = $element[0].querySelector('.geo-dfi-graph');
                    if (!container || !_layout) { return; }
                    _renderGraph(container, _layout, _selectedId, 'p:' + $scope.state.result.parsed.key, function (node) {
                        _apply(function () { _select(node); });
                    });
                }

                function _parcelInfo(key) {
                    var p = dfi.splitKey(key, _lookup.insee);
                    return { key: key, label: dfi.parcelLabel(key), idu: p.idu, prefix: p.prefix, section: p.section,
                             number: p.number, insee: p.insee, commune: p.insee.slice(2) };
                }

                function _select(node) {
                    _selectedId = node.id;
                    var st = $scope.state;
                    if (node.type === 'parcel') {
                        var info = _parcelInfo(node.key);
                        var s = dfi.parcelSummary(_lookup, node.key);
                        st.selected = {
                            title: 'Parcelle ' + info.label, parcel: info, mothers: [], daughters: [],
                            current: node.key === st.result.parsed.key,
                            lines: ['IDU : ' + info.idu]
                                .concat(s.origin.map(function (l) { return _lotText('Origine : ', l); }))
                                .concat(s.future.map(function (l) { return _lotText('Devenir : ', l); }))
                        };
                    } else {
                        var d = dfi.describeLot(_lookup.lots[node.index]);
                        st.selected = {
                            title: d.kind + ' — ' + d.natureLabel, parcel: null,
                            lines: ['Date : ' + d.dateLabel, 'DFI n° ' + d.dfi + ', lot ' + d.lotNumber],
                            mothers: d.mothers.map(_parcelInfo), daughters: d.daughters.map(_parcelInfo)
                        };
                    }
                    _draw();
                }

                $scope.focusParcel = function (idu) { $scope.state.idu = idu; $scope.search(); };

                // Plein écran : le panneau prend toute la largeur ; les boutons de la carte (qui se replient et chevauchent
                // ceux de gauche quand la carte est masquée) sont cachés tant que dure le plein écran. Échap en sort.
                function _onEscape(e) {
                    if (e.key === 'Escape' && $scope.isFullscreen) { _apply(function () { _setFullscreen(false); }); }
                }
                function _setFullscreen(on) {
                    $scope.isFullscreen = on;
                    _panelWidthPct = on ? 100 : _panelWidthCfg;
                    _requestPanelWidthSoon();
                    document.body.classList.toggle(_FULLSCREEN_BODY_CLASS, on);
                    document[on ? 'addEventListener' : 'removeEventListener']('keydown', _onEscape, true);
                    $timeout(_draw, 250);   // le conteneur du graphe a changé de taille
                }
                $scope.toggleFullscreen = function () { _setFullscreen(!$scope.isFullscreen); };

                $scope.$on('$destroy', function () {
                    if ($scope.isFullscreen) { _panelWidthPct = _panelWidthCfg; document.removeEventListener('keydown', _onEscape, true); }
                    document.body.classList.remove(_FULLSCREEN_BODY_CLASS);
                    if (_currentScope === $scope) { _currentScope = null; }
                });
            }];
        }

        // ============================================================
        // Graphe SVG
        // ============================================================
        var _SVG = 'http://www.w3.org/2000/svg';
        function _svg(tag, attrs, parent) {
            var el = document.createElementNS(_SVG, tag);
            Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
            if (parent) { parent.appendChild(el); }
            return el;
        }

        function _renderGraph(container, layout, selectedId, searchedId, onSelect) {
            var keepX = container.scrollLeft, keepY = container.scrollTop;
            container.innerHTML = '';
            var svg = _svg('svg', {
                width: layout.width, height: layout.height, viewBox: '0 0 ' + layout.width + ' ' + layout.height,
                'class': 'geo-dfi-svg', role: 'group', 'aria-label': 'Graphe de filiation de la parcelle'
            }, container);
            var defs = _svg('defs', {}, svg);
            var marker = _svg('marker', { id: 'geo-dfi-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5',
                markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, defs);
            _svg('path', { d: 'M0,0 L10,5 L0,10 z', 'class': 'geo-dfi-arrowhead' }, marker);
            layout.paths.forEach(function (p) {
                _svg('path', { d: p.d, 'class': 'geo-dfi-edge', 'marker-end': 'url(#geo-dfi-arrow)' }, svg);
            });
            var searchedNode = null;
            layout.nodes.forEach(function (n) {
                var cls = 'geo-dfi-node geo-dfi-node--' + n.type
                    + (n.id === searchedId ? ' geo-dfi-node--searched' : '')
                    + (n.type === 'parcel' && !n.explored ? ' geo-dfi-node--leaf' : '')
                    + (n.id === selectedId ? ' geo-dfi-node--selected' : '');
                var g = _svg('g', { 'class': cls, transform: 'translate(' + n.x + ',' + n.y + ')', tabindex: '0', role: 'button',
                    'aria-label': n.label }, svg);
                _svg('rect', { width: n.w, height: n.h, rx: n.type === 'lot' ? 14 : 4 }, g);
                var t = _svg('text', { x: n.w / 2, y: n.h / 2 + 4, 'text-anchor': 'middle' }, g);
                t.textContent = n.label;
                g.addEventListener('click', function () { onSelect(n); });
                g.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n); }
                });
                if (n.id === searchedId) { searchedNode = n; }
            });
            if (searchedNode && !keepX && !keepY) {   // première image : la parcelle cherchée au centre de la zone visible
                container.scrollLeft = Math.max(0, searchedNode.x + searchedNode.w / 2 - container.clientWidth / 2);
                container.scrollTop  = Math.max(0, searchedNode.y + searchedNode.h / 2 - container.clientHeight / 2);
            } else { container.scrollLeft = keepX; container.scrollTop = keepY; }
        }

        // ============================================================
        // Styles
        // ============================================================
        function _injectStyles() {
            if (document.getElementById('geo-dfi-styles')) { return; }
            var style = document.createElement('style');
            style.id = 'geo-dfi-styles';
            style.textContent = [
                '.geo-dfi{padding:12px;font-size:13px;line-height:1.4;color:#222;background:#fff;height:100%;overflow:auto;box-sizing:border-box;}',
                '.geo-dfi-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px;}',
                '.geo-dfi-title{margin:0;font-size:16px;}',
                '.geo-dfi-bar-actions{display:flex;gap:6px;}',
                '.geo-dfi-iconbtn{display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;',
                '  border:1px solid #89898a;border-radius:50%;background:#fff;color:#333;cursor:pointer;}',
                '.geo-dfi-iconbtn:hover{background:#eef2f8;}',
                '.geo-dfi-iconbtn--on{background:#27487a;border-color:#27487a;color:#fff;}',
                '.geo-dfi-iconbtn--on:hover{background:#1d3a66;}',
                '.geo-dfi-icon{width:18px;height:18px;display:block;}',
                '.geo-dfi--full .geo-dfi-graph{max-height:70vh;}',
                'body.' + _FULLSCREEN_BODY_CLASS + ' .acf-map-controls-topright{display:none!important;}',
                '.geo-dfi label{display:block;margin-bottom:4px;font-weight:600;}',
                '.geo-dfi-row{display:flex;gap:6px;margin-bottom:8px;}',
                '.geo-dfi-row input{flex:1;min-width:0;padding:6px 8px;border:1px solid #9aa4b2;border-radius:4px;font:inherit;}',
                '.geo-dfi-btn{padding:5px 10px;border:1px solid #4a6fa5;border-radius:4px;background:#fff;color:#27487a;font:inherit;cursor:pointer;}',
                '.geo-dfi-btn:hover:not([disabled]){background:#e8f0fe;}',
                '.geo-dfi-btn[disabled]{opacity:.55;cursor:default;}',
                '.geo-dfi-btn--main{background:#27487a;color:#fff;}',
                '.geo-dfi-btn--main:hover:not([disabled]){background:#1d3a66;}',
                '.geo-dfi-msg{margin:8px 0;padding:6px 8px;background:#f1f3f6;border-radius:4px;}',
                '.geo-dfi-msg--error{background:#fdecea;color:#8a1c12;}',
                '.geo-dfi-parcel{margin:10px 0 4px;font-size:15px;font-weight:700;}',
                '.geo-dfi-idu{margin:0 6px;font-size:12px;font-weight:400;color:#555;}',
                '.geo-dfi-summary{margin:6px 0 8px;padding-left:18px;}',
                '.geo-dfi-graph{margin:8px 0;max-height:52vh;overflow:auto;border:1px solid #d5dae1;border-radius:4px;background:#fbfcfd;}',
                '.geo-dfi-svg{display:block;}',
                '.geo-dfi-edge{fill:none;stroke:#8a96a8;stroke-width:1.4;}',
                '.geo-dfi-arrowhead{fill:#8a96a8;}',
                '.geo-dfi-node{cursor:pointer;outline:none;}',
                '.geo-dfi-node rect{fill:#e8f0fe;stroke:#4a6fa5;stroke-width:1.2;}',
                '.geo-dfi-node text{font-size:12px;fill:#1b2b45;pointer-events:none;}',
                '.geo-dfi-node--lot rect{fill:#f4f1e8;stroke:#a08a4a;}',
                '.geo-dfi-node--leaf rect{stroke-dasharray:3 2;fill:#f5f7fa;}',
                '.geo-dfi-node--searched rect{fill:#ffe2b8;stroke:#c76a00;stroke-width:2.2;}',
                '.geo-dfi-node--selected rect{stroke:#0b6b3a;stroke-width:2.6;}',
                '.geo-dfi-node:focus-visible rect{stroke:#0b6b3a;stroke-width:3;}',
                '.geo-dfi-detail{margin:8px 0;padding:8px;border:1px solid #d5dae1;border-radius:4px;}',
                '.geo-dfi-detail-title{margin-bottom:4px;font-weight:700;}',
                '.geo-dfi-detail .geo-dfi-btn{margin:6px 6px 0 0;}',
                '.geo-dfi-chips{margin-top:4px;}',
                '.geo-dfi-chip{margin:2px 4px 2px 0;padding:1px 8px;border:1px solid #4a6fa5;border-radius:10px;background:#e8f0fe;color:#27487a;font:inherit;cursor:pointer;}',
                '.geo-dfi-foot{margin-top:14px;padding-top:8px;border-top:1px solid #e1e5ea;font-size:11px;color:#59616e;}'
            ].join('\n');
            document.head.appendChild(style);
        }
    }]);
