/**
 * Logique du module sans GEO ni Angular : lecture des données DFI, graphe de filiation, mise en page.
 * Testée sous Node (test/dfi-data.test.mjs). Syntaxe limitée à ce que webpack 4 sait lire (pas de `?.` ni de `??`).
 *
 * Les données viennent de l'intégrateur integrator-dfi (un JSON par commune + index.json) :
 *   un lot est [identifiant du DFI, numéro de lot, nature, date ISO, parcelles mères, parcelles filles] ;
 *   une parcelle est « section(2) + numéro(4) », précédée du préfixe de section (3) s'il n'est pas « 000 ».
 */

// Version du format de sortie lue dans index.json : une autre version est refusée (voir README de l'intégrateur).
export var SUPPORTED_FORMAT = 1;

export var NATURES = {
    1: "Document d'arpentage",
    2: 'Croquis de conservation',
    4: 'Remaniement',
    5: "Document d'arpentage numérique",
    6: 'Lotissement numérique',
    7: 'Lotissement',
    8: 'Rénovation'
};

export class DfiError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'DfiError';
        this.code = code;
    }
}

// ─── Identifiants de parcelle ────────────────────────────────────────────────────────────────────────

/**
 * Découpe un IDU (14 caractères : INSEE 5 + préfixe 3 + section 2 + numéro 4). Retourne null s'il est invalide.
 * `key` est l'écriture des fichiers de données (préfixe omis lorsqu'il vaut « 000 »).
 */
export function parseIdu(text) {
    var idu = String(text == null ? '' : text).toUpperCase().replace(/\s+/g, '');
    var m = /^(\d[0-9AB]\d{3})(\d{3})([0-9A-Z]{2})(\d{4})$/.exec(idu);
    if (!m) { return null; }
    return {
        idu: idu, insee: m[1], commune: m[1].slice(2), prefix: m[2], section: m[3], number: m[4],
        key: parcelKey(m[2], m[3], m[4])
    };
}

export function parcelKey(prefix, section, number) {
    return (prefix && prefix !== '000' ? prefix : '') + section + number;
}

/** Découpe une parcelle d'un fichier de données (6 ou 9 caractères) ; l'INSEE est celui du fichier. */
export function splitKey(key, insee) {
    var hasPrefix = key.length === 9;
    var prefix = hasPrefix ? key.slice(0, 3) : '000';
    var rest = hasPrefix ? key.slice(3) : key;
    return {
        insee: insee, prefix: prefix, section: rest.slice(0, 2), number: rest.slice(2),
        idu: insee + prefix + rest, key: key
    };
}

/** « AH 280 » : section sans zéro de cadrage (« 0A » -> « A »), numéro sans zéros de tête, préfixe devant s'il existe. */
export function parcelLabel(key) {
    var p = splitKey(key, '');
    var num = p.number.replace(/^0+/, '') || '0';
    return (p.prefix !== '000' ? p.prefix + ' ' : '') + p.section.replace(/^0/, '') + ' ' + num;
}

export function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || '');
}

// ─── Chargement des données ──────────────────────────────────────────────────────────────────────────

export function dataUrl(base, name) {
    return String(base || '').replace(/\/+$/, '') + '/' + name;
}

/**
 * Lit un JSON avec `fetchFn` (fetch du navigateur, pas $http : les intercepteurs de GEO pourraient joindre des
 * en-têtes d'authentification à une adresse tierce, ce qui échouerait en CORS et divulguerait un jeton).
 */
export function loadJson(fetchFn, url) {
    return fetchFn(url, { credentials: 'omit' }).then(function (response) {
        if (response.status === 404) { throw new DfiError('notfound', 'Données introuvables : ' + url); }
        if (!response.ok) { throw new DfiError('http', 'Réponse ' + response.status + ' pour ' + url); }
        return response.json().catch(function () { throw new DfiError('json', 'Fichier illisible : ' + url); });
    }, function () {
        throw new DfiError('network', 'Données inaccessibles (réseau ou accès bloqué) : ' + url);
    });
}

export function checkIndex(index) {
    if (!index || typeof index !== 'object' || typeof index.communes !== 'object') {
        throw new DfiError('index', "L'index des données est illisible.");
    }
    if (index.format !== SUPPORTED_FORMAT) {
        throw new DfiError('format', 'Les données sont au format ' + index.format + ', ce module lit le format '
            + SUPPORTED_FORMAT + ' : mettre le module à jour.');
    }
    return index;
}

export function loadIndex(fetchFn, base) {
    return loadJson(fetchFn, dataUrl(base, 'index.json')).then(checkIndex);
}

export function loadCommune(fetchFn, base, index, insee) {
    if (!index.communes[insee]) {
        return Promise.reject(new DfiError('commune', "La commune " + insee + " n'est pas publiée dans les données."));
    }
    return loadJson(fetchFn, dataUrl(base, insee + '.json')).then(function (data) {
        if (!data || !Array.isArray(data.lots)) { throw new DfiError('json', 'Fichier de la commune ' + insee + ' illisible.'); }
        return data;
    });
}

/** Index des parcelles : lots où elles sont mères et lots où elles sont filles. */
export function buildLookup(communeData) {
    var asMother = {};
    var asDaughter = {};
    communeData.lots.forEach(function (lot, i) {
        lot[4].forEach(function (p) { (asMother[p] = asMother[p] || []).push(i); });
        lot[5].forEach(function (p) { (asDaughter[p] = asDaughter[p] || []).push(i); });
    });
    return { insee: communeData.insee, lots: communeData.lots, asMother: asMother, asDaughter: asDaughter };
}

// ─── Lots ────────────────────────────────────────────────────────────────────────────────────────────

/** Décrit un lot en français : type d'opération déduit du nombre de mères et de filles, et nature du DFI. */
export function describeLot(lot) {
    var mothers = lot[4].length;
    var daughters = lot[5].length;
    var kind;
    if (mothers === 0) { kind = 'Création'; }
    else if (daughters === 0) { kind = 'Disparition'; }
    else if (mothers === 1 && daughters === 1) { kind = 'Changement de numérotation'; }
    else if (mothers === 1) { kind = 'Division'; }
    else if (daughters === 1) { kind = 'Réunion'; }
    else { kind = 'Réorganisation'; }
    return {
        dfi: lot[0], lotNumber: lot[1], nature: lot[2], natureLabel: NATURES[lot[2]] || 'Nature ' + lot[2],
        date: lot[3], dateLabel: formatDate(lot[3]), kind: kind, mothers: lot[4], daughters: lot[5]
    };
}

// ─── Graphe de filiation ─────────────────────────────────────────────────────────────────────────────

/**
 * Graphe des ancêtres et des descendants de `key`. Nœuds : parcelles (id « p:KEY ») et lots (id « l:INDEX »).
 * Niveau d'une parcelle : 0 pour la parcelle cherchée, négatif pour ses ancêtres, positif pour ses descendants ;
 * un lot est à mi-chemin entre ses mères et ses filles (niveau ±0,5). Les autres parcelles d'un lot rencontré
 * (sœurs, co-mères) sont montrées sans être explorées, dans la limite de `maxSiblings` par lot.
 */
export function buildGraph(lookup, key, options) {
    var o = Object.assign({ maxDepth: 30, maxNodes: 300, maxSiblings: 8 }, options || {});
    var nodes = {};
    var order = [];
    var edges = [];
    var seenEdges = {};
    var truncated = false;

    function addNode(id, node) {
        if (nodes[id]) { return nodes[id]; }
        if (order.length >= o.maxNodes) { truncated = true; return null; }
        nodes[id] = node;
        order.push(id);
        return node;
    }
    function addEdge(from, to) {
        var id = from + '>' + to;
        if (!seenEdges[id]) { seenEdges[id] = true; edges.push({ from: from, to: to }); }
    }
    function addParcel(k, level, explored) {
        return addNode('p:' + k, { id: 'p:' + k, type: 'parcel', key: k, level: level, explored: !!explored });
    }
    // Ajoute au plus `maxSiblings` parcelles non encore présentes ; retourne le nombre de parcelles non affichées.
    function addOthers(keys, except, level, link) {
        var shown = 0;
        var hidden = 0;
        keys.forEach(function (k) {
            if (k === except) { return; }
            if (nodes['p:' + k]) { link(k); return; }
            if (shown >= o.maxSiblings) { hidden++; return; }
            if (addParcel(k, level, false)) { shown++; link(k); } else { hidden++; }
        });
        return hidden;
    }

    addParcel(key, 0, true);

    // Ancêtres : lots dont la parcelle est fille ; on remonte vers leurs mères.
    var queue = [{ key: key, level: 0, depth: 0 }];
    while (queue.length) {
        var up = queue.shift();
        if (up.depth >= o.maxDepth) { truncated = true; continue; }
        (lookup.asDaughter[up.key] || []).forEach(function (i) {
            var lotId = 'l:' + i;
            var isNew = !nodes[lotId];
            var lotNode = addNode(lotId, { id: lotId, type: 'lot', index: i, level: up.level - 0.5, hidden: 0 });
            if (!lotNode) { return; }
            addEdge(lotId, 'p:' + up.key);
            if (!isNew) { return; }
            var lot = lookup.lots[i];
            lot[4].forEach(function (m) {
                if (m === up.key) { return; }
                var existing = nodes['p:' + m];
                if (addParcel(m, up.level - 1, true)) {
                    addEdge('p:' + m, lotId);
                    if (!existing) { queue.push({ key: m, level: up.level - 1, depth: up.depth + 1 }); }
                }
            });
            lotNode.hidden += addOthers(lot[5], up.key, up.level, function (k) { addEdge(lotId, 'p:' + k); });
        });
    }

    // Descendants : lots dont la parcelle est mère ; on descend vers leurs filles.
    queue = [{ key: key, level: 0, depth: 0 }];
    while (queue.length) {
        var down = queue.shift();
        if (down.depth >= o.maxDepth) { truncated = true; continue; }
        (lookup.asMother[down.key] || []).forEach(function (i) {
            var lotId = 'l:' + i;
            var isNew = !nodes[lotId];
            var lotNode = addNode(lotId, { id: lotId, type: 'lot', index: i, level: down.level + 0.5, hidden: 0 });
            if (!lotNode) { return; }
            addEdge('p:' + down.key, lotId);
            if (!isNew) { return; }
            var lot = lookup.lots[i];
            lot[5].forEach(function (d) {
                if (d === down.key) { return; }
                var existing = nodes['p:' + d];
                if (addParcel(d, down.level + 1, true)) {
                    addEdge(lotId, 'p:' + d);
                    if (!existing) { queue.push({ key: d, level: down.level + 1, depth: down.depth + 1 }); }
                }
            });
            lotNode.hidden += addOthers(lot[4], down.key, down.level, function (k) { addEdge('p:' + k, lotId); });
        });
    }

    return {
        key: key,
        nodes: order.map(function (id) { return nodes[id]; }),
        edges: edges.filter(function (e) { return nodes[e.from] && nodes[e.to]; }),
        truncated: truncated,
        hasHistory: order.length > 1
    };
}

/** Synthèse en français, comme dans l'outil de Romain : origine (lots où la parcelle est fille) et devenir. */
export function parcelSummary(lookup, key) {
    return {
        origin: (lookup.asDaughter[key] || []).map(function (i) { return describeLot(lookup.lots[i]); }),
        future: (lookup.asMother[key] || []).map(function (i) { return describeLot(lookup.lots[i]); })
    };
}

// ─── Mise en page ────────────────────────────────────────────────────────────────────────────────────

/**
 * Place les nœuds : une ligne par niveau (ancêtres en haut, descendants en bas), ordre des nœuds d'une ligne ajusté sur
 * la position moyenne de leurs voisins pour limiter les croisements. Retourne positions, courbes et dimensions.
 */
export function layoutGraph(graph, labelOf, options) {
    var o = Object.assign({ charW: 7, padX: 16, nodeH: 28, gapX: 16, gapY: 40, margin: 12 }, options || {});
    var rowsByLevel = {};
    graph.nodes.forEach(function (n) {
        n.label = labelOf(n);
        n.w = Math.max(48, Math.round(n.label.length * o.charW + o.padX));
        n.h = o.nodeH;
        (rowsByLevel[n.level] = rowsByLevel[n.level] || []).push(n);
    });
    var levels = Object.keys(rowsByLevel).map(Number).sort(function (a, b) { return a - b; });
    var rows = levels.map(function (lv) { return rowsByLevel[lv]; });

    var neighbours = {};
    graph.edges.forEach(function (e) {
        (neighbours[e.from] = neighbours[e.from] || []).push(e.to);
        (neighbours[e.to] = neighbours[e.to] || []).push(e.from);
    });
    var byId = {};
    graph.nodes.forEach(function (n) { byId[n.id] = n; });

    function assignX() {
        var maxW = 0;
        rows.forEach(function (row) {
            var w = row.reduce(function (s, n) { return s + n.w; }, 0) + o.gapX * (row.length - 1);
            row.width = w;
            if (w > maxW) { maxW = w; }
        });
        rows.forEach(function (row) {
            var x = o.margin + (maxW - row.width) / 2;
            row.forEach(function (n) { n.x = x; x += n.w + o.gapX; });
        });
        return maxW;
    }
    function sortRow(row) {
        var keys = new Map();
        row.forEach(function (n, i) {
            var xs = (neighbours[n.id] || []).map(function (id) { return byId[id]; })
                .filter(function (m) { return m && m.x != null && m !== n && m.level !== n.level; })
                .map(function (m) { return m.x + m.w / 2; });
            keys.set(n, xs.length ? xs.reduce(function (s, v) { return s + v; }, 0) / xs.length : n.x + n.w / 2 + i * 1e-6);
        });
        row.sort(function (a, b) { return keys.get(a) - keys.get(b); });
    }
    var maxW = assignX();
    for (var pass = 0; pass < 3; pass++) {
        rows.forEach(sortRow);
        maxW = assignX();
    }
    rows.forEach(function (row, r) { row.forEach(function (n) { n.y = o.margin + r * (o.nodeH + o.gapY); }); });

    var paths = graph.edges.map(function (e) {
        var a = byId[e.from];
        var b = byId[e.to];
        var x1 = a.x + a.w / 2;
        var y1 = a.y + a.h;
        var x2 = b.x + b.w / 2;
        var y2 = b.y;
        var mid = (y1 + y2) / 2;
        return { from: e.from, to: e.to, d: 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + mid + ' ' + x2 + ',' + mid + ' ' + x2 + ',' + y2 };
    });
    return {
        nodes: graph.nodes,
        paths: paths,
        width: maxW + 2 * o.margin,
        height: rows.length * o.nodeH + (rows.length - 1) * o.gapY + 2 * o.margin
    };
}
