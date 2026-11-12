/* Carnet d'écoute — stockage local (IndexedDB, repli localStorage), aucun service externe. */
(function () {
  "use strict";

  var CATEGORIES = {
    culture: "Culture générale",
    anglais: "Anglais",
    mission: "Projet mission"
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
          var store = t.objectStore(STORE);
          var result = fn(store);
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

  /* ——————————————————— État & rendu ——————————————————— */

  var store = null;
  var entries = [];
  var filter = "all";
  var lastAddedId = null;

  var $ = function (id) { return document.getElementById(id); };
  var form = $("entry-form");
  var list = $("entries");
  var emptyMsg = $("empty");
  var errorMsg = $("form-error");

  var dateFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  var timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
  var todayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  function formatDate(iso) {
    var d = new Date(iso);
    return dateFmt.format(d) + " · " + timeFmt.format(d);
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function sortEntries() {
    entries.sort(function (a, b) { return b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0; });
  }

  function renderStats() {
    var counts = { culture: 0, anglais: 0, mission: 0 };
    entries.forEach(function (e) { if (counts.hasOwnProperty(e.category)) counts[e.category]++; });
    $("stat-total").textContent = entries.length;
    $("stat-total-label").textContent = entries.length > 1 ? "écoutes" : "écoute";
    $("stat-culture").textContent = counts.culture;
    $("stat-anglais").textContent = counts.anglais;
    $("stat-mission").textContent = counts.mission;
  }

  var TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

  function renderEntry(e) {
    var li = document.createElement("li");
    li.className = "entry cat-" + e.category + (e.id === lastAddedId ? " is-new" : "");
    li.dataset.id = e.id;

    var meta = document.createElement("div");
    meta.className = "entry-meta";
    var badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = CATEGORIES[e.category] || e.category;
    var date = document.createElement("time");
    date.className = "entry-date";
    date.dateTime = e.createdAt;
    date.textContent = formatDate(e.createdAt);
    meta.appendChild(badge);
    meta.appendChild(date);

    var title = document.createElement("h3");
    title.className = "entry-title";
    title.textContent = e.title;

    li.appendChild(meta);
    li.appendChild(title);

    if (e.note) {
      var note = document.createElement("p");
      note.className = "entry-note";
      note.textContent = e.note;
      li.appendChild(note);
    }

    var del = document.createElement("button");
    del.type = "button";
    del.className = "entry-delete";
    del.setAttribute("aria-label", "Supprimer « " + e.title + " »");
    del.innerHTML = TRASH_SVG;
    del.addEventListener("click", function () { deleteEntry(e.id); });
    li.appendChild(del);

    return li;
  }

  function renderList() {
    var visible = filter === "all" ? entries : entries.filter(function (e) { return e.category === filter; });
    var frag = document.createDocumentFragment();
    visible.forEach(function (e) { frag.appendChild(renderEntry(e)); });
    list.replaceChildren(frag);
    emptyMsg.hidden = visible.length > 0;
    emptyMsg.textContent = entries.length === 0
      ? "Aucune écoute pour l’instant. La première page attend."
      : "Aucune écoute dans cette catégorie.";
  }

  function render() {
    renderStats();
    renderList();
    lastAddedId = null;
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
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-visible"); }, actionLabel ? 6000 : 2500);
  }

  /* ——————————————————— Actions ——————————————————— */

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = !msg;
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var title = $("title").value.trim();
    var checked = form.querySelector('input[name="category"]:checked');
    var note = $("note").value.trim();

    if (!title) { showError("Indique le titre du podcast ou de l’épisode."); $("title").focus(); return; }
    if (!checked) { showError("Choisis une catégorie."); return; }
    showError("");

    var entry = {
      id: uid(),
      title: title,
      category: checked.value,
      note: note,
      createdAt: new Date().toISOString()
    };

    form.reset();
    store.put(entry).then(function () {
      entries.push(entry);
      sortEntries();
      lastAddedId = entry.id;
      if (filter !== "all" && filter !== entry.category) setFilter("all");
      render();
      document.activeElement && document.activeElement.blur();
      toast("Écoute consignée.");
    }).catch(function (err) {
      $("title").value = title;
      $("note").value = note;
      checked.checked = true;
      showError("Impossible d’enregistrer : " + (err && err.message ? err.message : "erreur de stockage"));
    });
  });

  function deleteEntry(id) {
    var entry = entries.find(function (e) { return e.id === id; });
    if (!entry) return;
    store.remove(id).then(function () {
      entries = entries.filter(function (e) { return e.id !== id; });
      render();
      toast("Écoute supprimée.", "Annuler", function () {
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
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
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
          return { id: e.id, title: e.title, category: e.category, note: typeof e.note === "string" ? e.note : "", createdAt: e.createdAt };
        });
        store.putMany(valid).then(function () { return store.all(); }).then(function (all) {
          entries = all; sortEntries(); render();
          toast(valid.length + " écoute" + (valid.length > 1 ? "s" : "") + " importée" + (valid.length > 1 ? "s" : "") + ".");
        });
      } catch (e) {
        toast("Fichier non reconnu.");
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
    showError("Le stockage local est indisponible : " + (err && err.message ? err.message : ""));
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
