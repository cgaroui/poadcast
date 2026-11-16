/* Carnet d'écoute — stockage local (IndexedDB, repli localStorage), aucun service externe. */
(function () {
  "use strict";

  var CATEGORIES = {
    culture: "Culture",
    anglais: "Anglais",
    mission: "Mission"
  };

  /* ——————————————————— Stockage ——————————————————— */

  var DB_NAME = "carnet-ecoute";
  var STORE = "entries";
  var LS_KEY = "carnet-ecoute:entries";

  function idbStore() {
    var dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error("IndexedDB bloquée")); };
    });

    function tx(mode, fn) {
      return dbPromise.then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(STORE, mode);
          var result = fn(t.objectStore(STORE));
          t.oncomplete = function () { resolve(result && "result" in result ? result.result : undefined); };
          t.onerror = function () { reject(t.error); };
          t.onabort = function () { reject(t.error || new Error("Transaction annulée")); };
        });
      });
    }

    return {
      kind: "IndexedDB",
      ready: dbPromise.then(function () { return true; }),
      all: function () { return tx("readonly", function (s) { return s.getAll(); }); },
      put: function (entry) { return tx("readwrite", function (s) { s.put(entry); }); },
      remove: function (id) { return tx("readwrite", function (s) { s.delete(id); }); },
      putMany: function (list) {
        return tx("readwrite", function (s) { list.forEach(function (e) { s.put(e); }); });
      }
    };
  }

  function lsStore() {
    function read() {
      try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch (e) { return []; }
    }
    function write(list) { localStorage.setItem(LS_KEY, JSON.stringify(list)); }
    return {
      kind: "localStorage",
      ready: Promise.resolve(true),
      all: function () { return Promise.resolve(read()); },
      put: function (entry) {
        var list = read().filter(function (e) { return e.id !== entry.id; });
        list.push(entry); write(list); return Promise.resolve();
      },
      remove: function (id) {
        write(read().filter(function (e) { return e.id !== id; })); return Promise.resolve();
      },
      putMany: function (items) {
        var map = {};
        read().concat(items).forEach(function (e) { map[e.id] = e; });
        write(Object.keys(map).map(function (k) { return map[k]; }));
        return Promise.resolve();
      }
    };
  }

  function openStorage() {
    if (!("indexedDB" in window) || !window.indexedDB) return Promise.resolve(lsStore());
    var idb;
    try { idb = idbStore(); } catch (e) { return Promise.resolve(lsStore()); }
    var timeout = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error("timeout")); }, 4000);
    });
    return Promise.race([idb.ready, timeout]).then(function () {
      // Migration éventuelle depuis le repli localStorage
      var legacy = lsStore();
      return legacy.all().then(function (old) {
        if (!old.length) return idb;
        return idb.putMany(old).then(function () {
          localStorage.removeItem(LS_KEY);
          return idb;
        });
      });
    }).catch(function () { return lsStore(); });
  }


  /* ——————————————————— Utilitaires ——————————————————— */

  var $ = function (id) { return document.getElementById(id); };

  var dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  var timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
  var todayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

  function formatDay(iso) {
    var d = new Date(iso);
    var diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
    return diffDays === 0 ? "Aujourd’hui" : diffDays === 1 ? "Hier" : dateFmt.format(d);
  }
  function formatDate(iso) { return formatDay(iso) + " · " + timeFmt.format(new Date(iso)); }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // N'accepte que les liens web (http/https) ; ajoute https:// si besoin.
  function normalizeUrl(value) {
    if (typeof value !== "string") return "";
    var v = value.trim();
    if (!v) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = "https://" + v;
    try {
      var u = new URL(v);
      if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname.indexOf(".") > 0) return u.href;
    } catch (err) {}
    return "";
  }

  function fold(str) {
    return (str || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function svg(paths, opts) {
    return '<svg viewBox="0 0 24 24" fill="' + (opts && opts.fill ? "currentColor" : "none") +
      '" stroke="' + (opts && opts.fill ? "none" : "currentColor") +
      '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  }
  var ICON_EDIT = svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>');
  var ICON_TRASH = svg('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>');
  var ICON_PLAY = svg('<path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.5-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z"/>', { fill: true });
  var ICON_X = svg('<path d="M7 7l10 10M17 7L7 17"/>');
  var ICON_CHECK = svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>');

  var NOTE_TYPES = {
    idee: {
      label: "Idée clé", plural: "Idées",
      placeholder: "Ce que j’ai compris, en une phrase…",
      icon: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>')
    },
    citation: {
      label: "Citation", plural: "Citations",
      placeholder: "Une phrase marquante, mot pour mot…",
      icon: svg('<path d="M10 11H6.5a.5.5 0 0 1-.5-.5V7.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V12c0 2.5-1.5 4-4 5"/><path d="M18 11h-3.5a.5.5 0 0 1-.5-.5V7.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V12c0 2.5-1.5 4-4 5"/>')
    },
    expression: {
      label: "Expression", plural: "Expressions",
      placeholder: "to put something off = remettre à plus tard",
      icon: svg('<path d="M3 18l4.5-12L12 18M4.7 14h5.6"/><path d="M20.5 18v-4.5a2.5 2.5 0 0 0-4.6-1.4M20.5 15.5c-3.5-.6-5.5.4-5.5 1.5 0 .8.7 1.3 1.7 1.3 1.6 0 3.8-1 3.8-2.8"/>')
    },
    creuser: {
      label: "À creuser", plural: "À creuser",
      placeholder: "Une question, une piste pour plus tard…",
      icon: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>')
    },
    ressource: {
      label: "Ressource", plural: "Ressources",
      placeholder: "Livre, site, auteur cité… (tu peux coller un lien)",
      icon: svg('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>')
    }
  };
  var TYPE_ORDER = ["idee", "citation", "expression", "creuser", "ressource"];

  /* ——————————————————— Modèle des notes ——————————————————— */

  function cleanNote(n, fallbackId) {
    if (!n || typeof n.text !== "string" || !n.text.trim()) return null;
    var note = {
      id: typeof n.id === "string" ? n.id : fallbackId,
      type: NOTE_TYPES.hasOwnProperty(n.type) ? n.type : "idee",
      text: n.text.trim()
    };
    if (note.type === "creuser" && n.done) note.done = true;
    return note;
  }

  // Les anciennes écoutes avaient un seul champ « note » : il devient une idée clé.
  function normalizeEntry(e) {
    var notes = [];
    if (Array.isArray(e.notes)) {
      e.notes.forEach(function (n, i) { var c = cleanNote(n, e.id + "-n" + i); if (c) notes.push(c); });
    } else if (typeof e.note === "string" && e.note.trim()) {
      notes.push({ id: e.id + "-n0", type: "idee", text: e.note.trim() });
    }
    var out = { id: e.id, title: e.title, category: e.category, notes: notes, url: normalizeUrl(e.url), createdAt: e.createdAt };
    if (typeof e.updatedAt === "string") out.updatedAt = e.updatedAt;
    return out;
  }

  // Affiche le texte en rendant cliquables les liens qu'il contient.
  var URL_RE = /((?:https?:\/\/|www\.)[^\s<>"]+[^\s<>".,;:!?)»])/gi;
  function appendLinkified(parent, text) {
    var last = 0;
    text.replace(URL_RE, function (match, _g, offset) {
      if (offset > last) parent.appendChild(document.createTextNode(text.slice(last, offset)));
      var href = normalizeUrl(match);
      if (href) {
        var a = document.createElement("a");
        a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
        a.textContent = match.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(match));
      }
      last = offset + match.length;
      return match;
    });
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  // Contenu d'une note selon son type
  function noteBody(note) {
    var body = document.createElement("div");
    body.className = "note-body";
    if (note.type === "expression") {
      var m = note.text.match(/^(.+?)\s*(?:=|:|→|->)\s*(.+)$/);
      if (m) {
        var term = document.createElement("strong");
        term.textContent = m[1];
        var meaning = document.createElement("span");
        meaning.className = "note-meaning";
        meaning.textContent = m[2];
        body.appendChild(term);
        body.appendChild(meaning);
        return body;
      }
    }
    if (note.type === "citation") {
      body.textContent = "« " + note.text.replace(/^[«"“\s]+|[»"”\s]+$/g, "") + " »";
      return body;
    }
    appendLinkified(body, note.text);
    return body;
  }

  // Icône de la note ; pour « À creuser », c'est une case à cocher.
  function noteMarker(note, onToggle) {
    if (note.type === "creuser" && onToggle) {
      var box = document.createElement("button");
      box.type = "button";
      box.className = "note-check" + (note.done ? " is-done" : "");
      box.setAttribute("aria-label", note.done ? "Marquer comme à creuser" : "Marquer comme traité");
      box.setAttribute("aria-pressed", note.done ? "true" : "false");
      box.innerHTML = ICON_CHECK;
      box.addEventListener("click", onToggle);
      return box;
    }
    var icon = document.createElement("span");
    icon.className = "note-icon";
    icon.innerHTML = NOTE_TYPES[note.type].icon;
    icon.title = NOTE_TYPES[note.type].label;
    return icon;
  }

  /* ——————————————————— État ——————————————————— */

  var store = null;
  var entries = [];
  var view = "entries";
  var filter = "all";
  var typeFilter = "all";
  var query = "";
  var lastChangedId = null;
  var editingId = null;

  var form = $("entry-form");
  var errorMsg = $("form-error");

  function sortEntries() {
    entries.sort(function (a, b) { return b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0; });
  }

  function saveEntry(entry) {
    return store.put(entry).then(function () {
      entries = entries.filter(function (e) { return e.id !== entry.id; });
      entries.push(entry);
      sortEntries();
    });
  }

  function toggleDone(entryId, noteId) {
    var entry = entries.find(function (e) { return e.id === entryId; });
    if (!entry) return;
    var updated = JSON.parse(JSON.stringify(entry));
    updated.notes.forEach(function (n) { if (n.id === noteId) n.done = !n.done; });
    saveEntry(updated).then(render);
  }

  /* ——————————————————— Carte « lecteur » ——————————————————— */

  // Onde sonore décorative, différente pour chaque dernière écoute
  function renderWave(seedText) {
    var bars = 42, seed = 0;
    for (var i = 0; i < seedText.length; i++) seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
    function rand() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    var frag = document.createDocumentFragment();
    for (var j = 0; j < bars; j++) {
      var envelope = 0.45 + 0.55 * Math.sin(Math.PI * (j + 0.5) / bars);
      var span = document.createElement("span");
      span.style.height = Math.max(12, Math.round((0.3 + 0.7 * rand()) * envelope * 100)) + "%";
      if (j < Math.round(bars * 0.38)) span.className = "on";
      frag.appendChild(span);
    }
    $("wave").replaceChildren(frag);
  }

  function renderStats() {
    var counts = { culture: 0, anglais: 0, mission: 0 };
    entries.forEach(function (e) { if (counts.hasOwnProperty(e.category)) counts[e.category]++; });
    $("stat-total").textContent = entries.length;
    $("stat-total-label").textContent = entries.length > 1 ? "écoutes" : "écoute";
    Object.keys(counts).forEach(function (k) { $("stat-" + k).textContent = counts[k]; });

    var last = entries[0];
    var play = $("last-play");
    if (last) {
      $("last-title").textContent = last.title;
      $("last-meta").textContent = (CATEGORIES[last.category] || "") + " · " + formatDate(last.createdAt);
      play.hidden = !last.url;
      if (last.url) play.href = last.url; else play.removeAttribute("href");
    } else {
      $("last-title").textContent = "Rien pour l’instant";
      $("last-meta").textContent = "Ajoute ta première écoute";
      play.hidden = true;
    }
    renderWave(last ? last.id + last.title : "carnet");
  }

  /* ——————————————————— Vue « Écoutes » ——————————————————— */

  function entryMatches(e, q) {
    if (!q) return true;
    var hay = fold(e.title + " " + CATEGORIES[e.category] + " " + e.notes.map(function (n) { return n.text; }).join(" "));
    return hay.indexOf(q) !== -1;
  }

  function renderEntry(e) {
    var li = document.createElement("li");
    li.className = "entry cat-" + e.category + (e.id === lastChangedId ? " is-new" : "");

    var top = document.createElement("div");
    top.className = "entry-top";
    var chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = CATEGORIES[e.category] || e.category;
    var date = document.createElement("time");
    date.className = "entry-date";
    date.dateTime = e.createdAt;
    date.textContent = formatDate(e.createdAt);
    top.appendChild(chip);
    top.appendChild(date);
    li.appendChild(top);

    var title = document.createElement("h3");
    title.className = "entry-title";
    title.textContent = e.title;
    li.appendChild(title);

    if (e.notes.length) {
      var ul = document.createElement("ul");
      ul.className = "entry-notes";
      e.notes.forEach(function (n) {
        var item = document.createElement("li");
        item.className = "note note-" + n.type + (n.done ? " is-done" : "");
        item.appendChild(noteMarker(n, function () { toggleDone(e.id, n.id); }));
        item.appendChild(noteBody(n));
        ul.appendChild(item);
      });
      li.appendChild(ul);
    }

    if (e.url) {
      var link = document.createElement("a");
      link.className = "entry-link";
      link.href = e.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      var icon = document.createElement("span");
      icon.className = "entry-link-icon";
      icon.innerHTML = ICON_PLAY;
      var label = document.createElement("span");
      label.textContent = "Réécouter";
      var host = document.createElement("span");
      host.className = "entry-link-host";
      try { host.textContent = new URL(e.url).hostname.replace(/^(www|open|m)\./, ""); } catch (err) { host.textContent = ""; }
      link.appendChild(icon);
      link.appendChild(label);
      link.appendChild(host);
      li.appendChild(link);
    }

    var actions = document.createElement("div");
    actions.className = "entry-actions";
    var edit = document.createElement("button");
    edit.type = "button";
    edit.className = "icon-btn";
    edit.setAttribute("aria-label", "Modifier « " + e.title + " »");
    edit.innerHTML = ICON_EDIT;
    edit.addEventListener("click", function () { openSheet(e.id); });
    var del = document.createElement("button");
    del.type = "button";
    del.className = "icon-btn danger";
    del.setAttribute("aria-label", "Supprimer « " + e.title + " »");
    del.innerHTML = ICON_TRASH;
    del.addEventListener("click", function () { deleteEntry(e.id); });
    actions.appendChild(edit);
    actions.appendChild(del);
    li.appendChild(actions);

    return li;
  }

  function renderEntries() {
    var visible = entries.filter(function (e) {
      return (filter === "all" || e.category === filter) && entryMatches(e, query);
    });
    var frag = document.createDocumentFragment();
    visible.forEach(function (e) { frag.appendChild(renderEntry(e)); });
    $("entries").replaceChildren(frag);

    if (entries.length === 0) setEmpty("Aucune écoute pour l’instant", "Appuie sur « Ajouter » après ton prochain podcast.");
    else if (query) setEmpty("Aucun résultat", "Rien ne correspond à « " + $("search").value.trim() + " ».");
    else setEmpty("Rien dans cette catégorie", filter === "all" ? "Tes écoutes apparaîtront ici." : "Tes écoutes " + CATEGORIES[filter].toLowerCase() + " apparaîtront ici.");
    $("empty").hidden = visible.length > 0;
  }

  /* ——————————————————— Vue « Mes notes » ——————————————————— */

  function allNotes() {
    var out = [];
    entries.forEach(function (e) {
      e.notes.forEach(function (n) { out.push({ note: n, entry: e }); });
    });
    return out;
  }

  function renderTypeFilters(items) {
    var counts = { all: items.length };
    TYPE_ORDER.forEach(function (t) { counts[t] = 0; });
    items.forEach(function (it) { counts[it.note.type]++; });
    var wrap = $("filters-notes");
    var frag = document.createDocumentFragment();
    ["all"].concat(TYPE_ORDER).forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "type-filter" + (typeFilter === t ? " is-active" : "");
      b.setAttribute("aria-pressed", typeFilter === t ? "true" : "false");
      if (t !== "all") {
        var ic = document.createElement("span");
        ic.className = "type-filter-icon";
        ic.innerHTML = NOTE_TYPES[t].icon;
        b.appendChild(ic);
      }
      b.appendChild(document.createTextNode(t === "all" ? "Toutes" : NOTE_TYPES[t].plural));
      var c = document.createElement("span");
      c.className = "type-filter-count";
      c.textContent = counts[t];
      b.appendChild(c);
      b.addEventListener("click", function () { typeFilter = t; renderNotes(); });
      frag.appendChild(b);
    });
    wrap.replaceChildren(frag);
  }

  function renderNotes() {
    var items = allNotes();
    renderTypeFilters(items);
    var visible = items.filter(function (it) {
      if (typeFilter !== "all" && it.note.type !== typeFilter) return false;
      if (!query) return true;
      return fold(it.note.text + " " + it.entry.title).indexOf(query) !== -1;
    });
    // Les pistes « À creuser » déjà traitées passent en fin de liste.
    visible.sort(function (a, b) { return (a.note.done ? 1 : 0) - (b.note.done ? 1 : 0); });

    var frag = document.createDocumentFragment();
    visible.forEach(function (it) {
      var n = it.note, e = it.entry;
      var li = document.createElement("li");
      li.className = "note-card note-" + n.type + (n.done ? " is-done" : "");

      var head = document.createElement("div");
      head.className = "note-card-head";
      head.appendChild(noteMarker(n, function () { toggleDone(e.id, n.id); }));
      var type = document.createElement("span");
      type.className = "note-card-type";
      type.textContent = NOTE_TYPES[n.type].label + (n.type === "creuser" && n.done ? " · traité" : "");
      head.appendChild(type);
      li.appendChild(head);

      li.appendChild(noteBody(n));

      var src = document.createElement("button");
      src.type = "button";
      src.className = "note-source cat-" + e.category;
      var dot = document.createElement("span");
      dot.className = "dot";
      var srcText = document.createElement("span");
      srcText.className = "note-source-text";
      srcText.textContent = e.title;
      var srcDate = document.createElement("span");
      srcDate.className = "note-source-date";
      srcDate.textContent = formatDay(e.createdAt);
      src.appendChild(dot);
      src.appendChild(srcText);
      src.appendChild(srcDate);
      src.setAttribute("aria-label", "Voir l’écoute « " + e.title + " »");
      src.addEventListener("click", function () { openSheet(e.id); });
      li.appendChild(src);

      frag.appendChild(li);
    });
    $("notes-list").replaceChildren(frag);

    if (items.length === 0) setEmpty("Aucune note pour l’instant", "Les notes que tu ajoutes à tes écoutes apparaîtront ici, classées par type.");
    else if (query) setEmpty("Aucun résultat", "Aucune note ne correspond à « " + $("search").value.trim() + " ».");
    else setEmpty("Rien ici pour l’instant", typeFilter === "all" ? "Tes notes apparaîtront ici." : "Tes notes « " + NOTE_TYPES[typeFilter].label + " » apparaîtront ici.");
    $("empty").hidden = visible.length > 0;
  }

  function setEmpty(title, text) {
    $("empty-title").textContent = title;
    $("empty-text").textContent = text;
  }

  function render() {
    renderStats();
    var isNotes = view === "notes";
    $("entries").hidden = isNotes;
    $("filters-entries").hidden = isNotes;
    $("notes-list").hidden = !isNotes;
    $("filters-notes").hidden = !isNotes;
    $("search").placeholder = isNotes ? "Rechercher dans mes notes" : "Rechercher une écoute";
    if (isNotes) renderNotes(); else renderEntries();
    lastChangedId = null;
  }

  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      view = tab.dataset.view;
      document.querySelectorAll(".tab").forEach(function (t) {
        t.classList.toggle("is-active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      render();
    });
  });

  $("search").addEventListener("input", function () {
    query = fold($("search").value.trim());
    if (view === "notes") renderNotes(); else renderEntries();
  });

  function setFilter(value) {
    filter = value;
    document.querySelectorAll(".filter").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.filter === value);
      b.setAttribute("aria-pressed", b.dataset.filter === value ? "true" : "false");
    });
  }

  document.querySelectorAll(".filter").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setFilter(btn.dataset.filter);
      renderEntries();
    });
  });

  /* ——————————————————— Toast ——————————————————— */

  var toastEl = $("toast");
  var toastTimer = null;
  function toast(message, actionLabel, onAction) {
    clearTimeout(toastTimer);
    toastEl.replaceChildren();
    var span = document.createElement("span");
    span.textContent = message;
    toastEl.appendChild(span);
    if (actionLabel) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = actionLabel;
      btn.addEventListener("click", function () {
        toastEl.classList.remove("is-visible");
        onAction();
      });
      toastEl.appendChild(btn);
    }
    toastEl.classList.add("is-visible");
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-visible"); }, actionLabel ? 6000 : 2200);
  }

  /* ——————————————————— Rédaction des notes (dans la feuille) ——————————————————— */

  var draftNotes = [];
  var composerType = "idee";

  function renderTypePicker() {
    var frag = document.createDocumentFragment();
    TYPE_ORDER.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "type-option" + (composerType === t ? " is-active" : "");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", composerType === t ? "true" : "false");
      var ic = document.createElement("span");
      ic.className = "type-option-icon";
      ic.innerHTML = NOTE_TYPES[t].icon;
      b.appendChild(ic);
      b.appendChild(document.createTextNode(NOTE_TYPES[t].label));
      b.addEventListener("click", function () {
        composerType = t;
        renderTypePicker();
        $("note-text").focus();
      });
      frag.appendChild(b);
    });
    $("type-picker").replaceChildren(frag);
    $("note-text").placeholder = NOTE_TYPES[composerType].placeholder;
  }

  function renderDraftNotes() {
    var frag = document.createDocumentFragment();
    draftNotes.forEach(function (n, i) {
      var li = document.createElement("li");
      li.className = "draft-note note-" + n.type;
      li.appendChild(noteMarker(n, null));
      var body = noteBody(n);
      body.setAttribute("role", "button");
      body.setAttribute("tabindex", "0");
      body.setAttribute("aria-label", "Modifier cette note");
      // Toucher une note la renvoie dans la zone de saisie pour la modifier
      body.addEventListener("click", function (ev) {
        if (ev.target.closest("a")) return;
        commitComposer();
        var current = draftNotes.indexOf(n);
        if (current === -1) return;
        draftNotes.splice(current, 1);
        composerType = n.type;
        $("note-text").value = n.text;
        composerKeep = n;
        renderTypePicker();
        renderDraftNotes();
        $("note-text").focus();
      });
      li.appendChild(body);
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "draft-remove";
      rm.setAttribute("aria-label", "Retirer cette note");
      rm.innerHTML = ICON_X;
      rm.addEventListener("click", function () { draftNotes.splice(i, 1); renderDraftNotes(); });
      li.appendChild(rm);
      frag.appendChild(li);
    });
    $("draft-notes").replaceChildren(frag);
  }

  var composerKeep = null; // note en cours de modification (garde son id et son état)

  // Ajoute à la liste ce qui est écrit dans la zone de saisie, s'il y a du texte.
  function commitComposer() {
    var text = $("note-text").value.trim();
    if (!text) { composerKeep = null; return false; }
    var note = { id: composerKeep ? composerKeep.id : uid(), type: composerType, text: text };
    if (composerKeep && composerKeep.done && composerType === "creuser") note.done = true;
    draftNotes.push(note);
    $("note-text").value = "";
    composerKeep = null;
    return true;
  }

  $("add-note-btn").addEventListener("click", function () {
    if (commitComposer()) {
      renderDraftNotes();
      $("note-text").focus();
    } else {
      $("note-text").focus();
    }
  });

  /* ——————————————————— Feuille ajout / modification ——————————————————— */

  var sheet = $("sheet");
  var backdrop = $("sheet-backdrop");
  var closeTimer = null;
  var pendingReload = false;

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = !msg;
  }

  function openSheet(id) {
    clearTimeout(closeTimer);
    var entry = id ? entries.find(function (e) { return e.id === id; }) : null;
    editingId = entry ? entry.id : null;
    form.reset();
    showError("");
    $("sheet-title").textContent = entry ? "Modifier l’écoute" : "Nouvelle écoute";
    $("submit-btn").textContent = entry ? "Enregistrer les modifications" : "Enregistrer";
    draftNotes = entry ? JSON.parse(JSON.stringify(entry.notes)) : [];
    composerType = "idee";
    composerKeep = null;
    $("note-text").value = "";
    if (entry) {
      $("title").value = entry.title;
      $("url").value = entry.url || "";
      var radio = form.querySelector('input[name="category"][value="' + entry.category + '"]');
      if (radio) radio.checked = true;
    }
    renderTypePicker();
    renderDraftNotes();
    sheet.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        sheet.classList.add("is-open");
        backdrop.classList.add("is-open");
      });
    });
    sheet.scrollTop = 0;
    if (!entry) setTimeout(function () { $("title").focus(); }, 320);
  }

  function closeSheet() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    sheet.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    document.body.classList.remove("sheet-open");
    closeTimer = setTimeout(function () {
      sheet.hidden = true;
      backdrop.hidden = true;
    }, 320);
    editingId = null;
    if (pendingReload) setTimeout(function () { window.location.reload(); }, 350);
  }

  $("add-btn").addEventListener("click", function () { openSheet(null); });
  $("sheet-close").addEventListener("click", closeSheet);
  backdrop.addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !sheet.hidden) closeSheet();
  });

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var title = $("title").value.trim();
    var checked = form.querySelector('input[name="category"]:checked');
    var rawUrl = $("url").value.trim();
    var url = normalizeUrl(rawUrl);

    if (!title) { showError("Indique le titre du podcast ou de l’épisode."); $("title").focus(); return; }
    if (!checked) { showError("Choisis une catégorie."); return; }
    if (rawUrl && !url) { showError("Ce lien ne semble pas valide (ex. : https://youtu.be/…)."); $("url").focus(); return; }
    showError("");

    // Une note écrite mais pas encore ajoutée est enregistrée quand même.
    commitComposer();

    var existing = editingId ? entries.find(function (e) { return e.id === editingId; }) : null;
    var entry = {
      id: existing ? existing.id : uid(),
      title: title,
      category: checked.value,
      notes: draftNotes.map(function (n, i) { return cleanNote(n, uid() + i); }).filter(Boolean),
      url: url,
      createdAt: existing ? existing.createdAt : new Date().toISOString()
    };
    if (existing) entry.updatedAt = new Date().toISOString();

    saveEntry(entry).then(function () {
      lastChangedId = entry.id;
      if (filter !== "all" && filter !== entry.category) setFilter("all");
      closeSheet();
      render();
      toast(existing ? "Modifications enregistrées" : "Écoute enregistrée");
    }).catch(function (err) {
      showError("Impossible d’enregistrer : " + (err && err.message ? err.message : "erreur de stockage"));
    });
  });

  function deleteEntry(id) {
    var entry = entries.find(function (e) { return e.id === id; });
    if (!entry) return;
    store.remove(id).then(function () {
      entries = entries.filter(function (e) { return e.id !== id; });
      render();
      toast("Écoute supprimée", "Annuler", function () {
        saveEntry(entry).then(render);
      });
    });
  }

  /* ——————————————————— Export / import ——————————————————— */

  $("export-btn").addEventListener("click", function () {
    var data = JSON.stringify({ app: "carnet-ecoute", version: 2, exportedAt: new Date().toISOString(), entries: entries }, null, 2);
    var blob = new Blob([data], { type: "application/json" });
    var name = "carnet-ecoute-" + new Date().toISOString().slice(0, 10) + ".json";
    var file;
    try { file = new File([blob], name, { type: "application/json" }); } catch (e) { file = null; }

    // Sur iPhone, la feuille de partage permet d'enregistrer dans Fichiers.
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch(function () {});
      return;
    }
    var href = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
  });

  $("import-file").addEventListener("change", function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var items = Array.isArray(parsed) ? parsed : parsed.entries;
        if (!Array.isArray(items)) throw new Error("format");
        var valid = items.filter(function (e) {
          return e && typeof e.id === "string" && typeof e.title === "string" &&
            CATEGORIES.hasOwnProperty(e.category) && typeof e.createdAt === "string";
        }).map(normalizeEntry);
        store.putMany(valid).then(function () { return store.all(); }).then(function (all) {
          entries = (all || []).map(normalizeEntry); sortEntries(); render();
          toast(valid.length + " écoute" + (valid.length > 1 ? "s importées" : " importée"));
        });
      } catch (e) {
        toast("Fichier non reconnu");
      }
      ev.target.value = "";
    };
    reader.readAsText(f);
  });

  /* ——————————————————— Démarrage ——————————————————— */

  var todayText = todayFmt.format(new Date());
  $("today").textContent = todayText.charAt(0).toUpperCase() + todayText.slice(1);

  openStorage().then(function (s) {
    store = s;
    return store.all();
  }).then(function (all) {
    entries = (all || []).map(normalizeEntry);
    sortEntries();
    render();
    $("storage-info").textContent = "Stockage : " + store.kind + ".";
    // Demande un stockage persistant (évite l'effacement automatique par le navigateur)
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(function (granted) {
        $("storage-info").textContent = "Stockage : " + store.kind + (granted ? " · persistant" : "") + ".";
      }).catch(function () {});
    }
  }).catch(function (err) {
    toast("Stockage local indisponible : " + (err && err.message ? err.message : ""));
  });

  if ("serviceWorker" in navigator) {
    // Quand une nouvelle version de l'app est installée, recharge une fois pour l'afficher.
    var hadController = !!navigator.serviceWorker.controller;
    var reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadController || reloaded) return;
      reloaded = true;
      // Ne recharge pas pendant une saisie : attend la fermeture de la feuille.
      if (!sheet.hidden) { pendingReload = true; return; }
      window.location.reload();
    });
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        // Vérifie les mises à jour à chaque retour dans l'app
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible") reg.update().catch(function () {});
        });
      }).catch(function () {});
    });
  }
})();
