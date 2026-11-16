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

  function formatDate(iso) {
    var d = new Date(iso);
    var diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
    var day = diffDays === 0 ? "Aujourd’hui" : diffDays === 1 ? "Hier" : dateFmt.format(d);
    return day + " · " + timeFmt.format(d);
  }

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

  function svg(paths, opts) {
    return '<svg viewBox="0 0 24 24" fill="' + (opts && opts.fill ? "currentColor" : "none") +
      '" stroke="' + (opts && opts.fill ? "none" : "currentColor") +
      '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  }
  var ICON_EDIT = svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>');
  var ICON_TRASH = svg('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>');
  var ICON_PLAY = svg('<path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.5-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z"/>', { fill: true });

  /* ——————————————————— État & rendu ——————————————————— */

  var store = null;
  var entries = [];
  var filter = "all";
  var lastChangedId = null;
  var editingId = null;

  var form = $("entry-form");
  var list = $("entries");
  var errorMsg = $("form-error");

  function sortEntries() {
    entries.sort(function (a, b) { return b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0; });
  }

  function renderStats() {
    var counts = { culture: 0, anglais: 0, mission: 0 };
    entries.forEach(function (e) { if (counts.hasOwnProperty(e.category)) counts[e.category]++; });
    var total = entries.length;
    $("stat-total").textContent = total;
    $("stat-total-label").textContent = total > 1 ? "écoutes au total" : "écoute au total";
    Object.keys(counts).forEach(function (k) {
      $("stat-" + k).textContent = counts[k];
      var seg = $("bar-" + k);
      seg.style.width = total ? "calc(" + (counts[k] / total * 100) + "% - 2px)" : "0";
      seg.style.display = counts[k] ? "block" : "none";
    });
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

    if (e.note) {
      var note = document.createElement("p");
      note.className = "entry-note";
      note.textContent = e.note;
      li.appendChild(note);
    }

    var safeUrl = normalizeUrl(e.url);
    if (safeUrl) {
      var link = document.createElement("a");
      link.className = "entry-link";
      link.href = safeUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      var icon = document.createElement("span");
      icon.className = "entry-link-icon";
      icon.innerHTML = ICON_PLAY;
      var label = document.createElement("span");
      label.textContent = "Réécouter";
      var host = document.createElement("span");
      host.className = "entry-link-host";
      try { host.textContent = new URL(safeUrl).hostname.replace(/^(www|open|m)\./, ""); } catch (err) { host.textContent = ""; }
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

  function renderList() {
    var visible = filter === "all" ? entries : entries.filter(function (e) { return e.category === filter; });
    var frag = document.createDocumentFragment();
    visible.forEach(function (e) { frag.appendChild(renderEntry(e)); });
    list.replaceChildren(frag);
    $("empty").hidden = visible.length > 0;
    if (entries.length === 0) {
      $("empty-title").textContent = "Aucune écoute pour l’instant";
      $("empty-text").textContent = "Appuie sur « Ajouter » après ton prochain podcast.";
    } else {
      $("empty-title").textContent = "Rien dans cette catégorie";
      $("empty-text").textContent = "Tes écoutes " + CATEGORIES[filter].toLowerCase() + " apparaîtront ici.";
    }
  }

  function render() {
    renderStats();
    renderList();
    lastChangedId = null;
  }

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
    if (entry) {
      $("title").value = entry.title;
      $("note").value = entry.note || "";
      $("url").value = entry.url || "";
      var radio = form.querySelector('input[name="category"][value="' + entry.category + '"]');
      if (radio) radio.checked = true;
    }
    sheet.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add("sheet-open");
    // laisse le navigateur appliquer l'état initial avant l'animation
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
    var note = $("note").value.trim();
    var rawUrl = $("url").value.trim();
    var url = normalizeUrl(rawUrl);

    if (!title) { showError("Indique le titre du podcast ou de l’épisode."); $("title").focus(); return; }
    if (!checked) { showError("Choisis une catégorie."); return; }
    if (rawUrl && !url) { showError("Ce lien ne semble pas valide (ex. : https://youtu.be/…)."); $("url").focus(); return; }
    showError("");

    var existing = editingId ? entries.find(function (e) { return e.id === editingId; }) : null;
    var entry = {
      id: existing ? existing.id : uid(),
      title: title,
      category: checked.value,
      note: note,
      url: url,
      createdAt: existing ? existing.createdAt : new Date().toISOString()
    };
    if (existing) entry.updatedAt = new Date().toISOString();

    store.put(entry).then(function () {
      entries = entries.filter(function (e) { return e.id !== entry.id; });
      entries.push(entry);
      sortEntries();
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
        store.put(entry).then(function () {
          entries.push(entry);
          sortEntries();
          render();
        });
      });
    });
  }

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
      renderList();
    });
  });

  /* ——————————————————— Export / import ——————————————————— */

  $("export-btn").addEventListener("click", function () {
    var data = JSON.stringify({ app: "carnet-ecoute", version: 1, exportedAt: new Date().toISOString(), entries: entries }, null, 2);
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
        }).map(function (e) {
          var clean = { id: e.id, title: e.title, category: e.category, note: typeof e.note === "string" ? e.note : "", url: normalizeUrl(e.url), createdAt: e.createdAt };
          if (typeof e.updatedAt === "string") clean.updatedAt = e.updatedAt;
          return clean;
        });
        store.putMany(valid).then(function () { return store.all(); }).then(function (all) {
          entries = all; sortEntries(); render();
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
    entries = all || [];
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
