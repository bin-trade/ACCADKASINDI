/* ACCAD Trace — socle commun (PWA Beni et PWA Kasindi) */
(function (root) {
  'use strict';
  const CFG = root.ACCAD_CONFIG || {};
  const A = root.ACCAD = root.ACCAD || {};
  A.cfg = CFG;
  const DAY = 86400000;
  A.TTL = { identity: 72 * 3600000, config: 72 * 3600000, idle: 15 * 60000 };

  /* ---------- Textes et identifiants ---------- */
  A.up = (v) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().toUpperCase();
  A.esc = (v) => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  A.pad = (n, l = 2) => String(n).padStart(l, '0');
  A.dateText = (d) => `${A.pad(d.getDate())}-${A.pad(d.getMonth() + 1)}-${d.getFullYear()}`;
  A.timeText = (d) => `${A.pad(d.getHours())}:${A.pad(d.getMinutes())}:${A.pad(d.getSeconds())}`;
  A.randomCode = (len = 6) => { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const bytes = new Uint8Array(len); (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(bytes) : bytes.forEach((_, i) => bytes[i] = Math.random() * 256); return Array.from(bytes, (b) => chars[b % chars.length]).join(''); };
  /** AGENT-AAAAMMJJ-HHMMSS-ALEA, généré sur l'appareil. */
  A.newId = (agentId, d = new Date()) => `${String(agentId).toUpperCase().replace(/[^A-Z0-9]/g, '')}-${d.getFullYear()}${A.pad(d.getMonth() + 1)}${A.pad(d.getDate())}-${A.pad(d.getHours())}${A.pad(d.getMinutes())}${A.pad(d.getSeconds())}-${A.randomCode(6)}`;
  A.qrPayload = (id, plaque, agentId, dateText) => ['ACCAD', id, plaque, agentId, dateText].join('|');
  A.parseQr = (text) => {
    const t = String(text || '').trim();
    if (!t) return null;
    if (t.indexOf('ACCAD|') === 0) { const p = t.split('|'); return { id: A.up(p[1]), plaque: A.up(p[2]), agent: A.up(p[3]), date: A.up(p[4]), raw: t }; }
    try { const j = JSON.parse(t); if (j && j.r) return { id: A.up(j.r), plaque: A.up(j.p), agent: A.up(j.g), date: A.up(String(j.d || '').split(' ')[0]), raw: t }; } catch (e) { /* format inconnu */ }
    return { id: A.up(t), plaque: '', agent: '', date: '', raw: t, foreign: true };
  };
  A.money = (v, devise) => `${Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${devise || 'USD'}`;
  A.deviceId = () => { try { let v = localStorage.getItem('accadDeviceId'); if (!v) { v = 'APP-' + A.randomCode(8); localStorage.setItem('accadDeviceId', v); } return v; } catch (e) { return 'APP-INCONNU'; } };

  /* ---------- Appels au service central ---------- */
  A.api = async function (action, payload, opts) {
    const body = Object.assign({ action, deviceId: A.deviceId() }, payload || {});
    if (!('sessionToken' in body) && A.session.token) body.sessionToken = A.session.token;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (opts && opts.timeout) || 25000);
    let response;
    try { response = await fetch(CFG.apiUrl, { method: 'POST', body: JSON.stringify(body), signal: controller.signal, redirect: 'follow' }); }
    catch (error) { const e = new Error('Pas de connexion au service central.'); e.network = true; throw e; }
    finally { clearTimeout(timer); }
    let result;
    try { result = await response.json(); } catch (error) { const e = new Error('Service temporairement indisponible.'); e.network = true; throw e; }
    if (!result.ok) { const e = new Error(result.error || 'Opération refusée.'); e.server = true; e.sessionLost = /session|reconnecter/i.test(e.message); throw e; }
    return result.data;
  };

  /* ---------- Stockage local (IndexedDB) ---------- */
  const DB_VERSION = 4; const dbName = () => 'ACCAD_TRACE_' + ((A.app && A.app.site) || 'APP');
  let dbPromise;
  function openDb() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName(), DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('receipts')) db.createObjectStore('receipts', { keyPath: 'reference' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('identities')) db.createObjectStore('identities', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  const tx = async (store, mode, fn) => { const db = await openDb(); return new Promise((resolve, reject) => { const t = db.transaction(store, mode); const s = t.objectStore(store); let out; try { out = fn(s); } catch (e) { reject(e); return; } t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); }); };
  A.db = {
    put: (store, value) => tx(store, 'readwrite', (s) => { s.put(value); }),
    putMany: (store, values) => tx(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); }),
    get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
    all: (store) => tx(store, 'readonly', (s) => s.getAll()),
    remove: (store, key) => tx(store, 'readwrite', (s) => { s.delete(key); }), // réservé aux données de cache (identités), jamais aux opérations
    kvGet: async (key) => { const r = await A.db.get('kv', key); return r ? r.value : null; },
    kvSet: (key, value) => A.db.put('kv', { key, value })
  };

  /* ---------- Session (15 min d'inactivité) ---------- */
  const SS = root.sessionStorage;
  A.session = {
    token: null, profile: null, offline: false, unlock: null, timer: null, onExpire: null,
    start(profile, token, offline, unlock) {
      this.profile = profile; this.token = token; this.offline = !!offline; this.unlock = unlock || this.unlock;
      try { SS.setItem('accadProfile', JSON.stringify(profile)); SS.setItem('accadToken', token || ''); SS.setItem('accadOffline', offline ? '1' : '0'); SS.setItem('accadLast', String(Date.now())); } catch (e) { /* stockage de session indisponible */ }
      this.touch();
    },
    restore() {
      try {
        const p = SS.getItem('accadProfile'); const last = Number(SS.getItem('accadLast') || 0);
        if (!p || Date.now() - last > A.TTL.idle) { this.clear(); return false; }
        this.profile = JSON.parse(p); this.token = SS.getItem('accadToken') || null; this.offline = SS.getItem('accadOffline') === '1'; this.touch(); return true;
      } catch (e) { return false; }
    },
    touch() {
      try { SS.setItem('accadLast', String(Date.now())); } catch (e) { /* ignoré */ }
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.expire(), A.TTL.idle);
    },
    expire() { const cb = this.onExpire; this.clear(); if (cb) cb('Session expirée après 15 minutes d’inactivité. Veuillez saisir de nouveau votre code.'); },
    clear() { clearTimeout(this.timer); this.token = null; this.profile = null; this.unlock = null; this.offline = false; try { SS.clear(); } catch (e) { /* ignoré */ } },
    logout(message) { const cb = this.onExpire; this.clear(); if (cb) cb(message || 'Session fermée. Un autre agent peut se connecter.'); }
  };
  ['click', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { if (A.session.profile) A.session.touch(); }, { passive: true }));

  /* ---------- Retour visuel et accessibilité ---------- */
  A.ui = {
    live(message) { const el = document.getElementById('live'); if (el) { el.textContent = ''; setTimeout(() => { el.textContent = message; }, 30); } },
    notify(message, kind) {
      const box = document.getElementById('toasts'); if (!box) return;
      const n = document.createElement('div'); n.className = `toast toast-${kind || 'info'}`; n.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      n.innerHTML = `<span class="sym" aria-hidden="true">${kind === 'error' ? '✖' : kind === 'success' ? '✔' : 'ℹ'}</span><span>${A.esc(message)}</span>`;
      box.appendChild(n); A.ui.live(message); setTimeout(() => n.remove(), kind === 'error' ? 9000 : 5000);
    },
    /** Désactive le bouton, affiche le texte d'attente, rend le résultat visible près de l'action. */
    async run(button, busyLabel, task, zone) {
      if (button && button.disabled) return undefined;
      const original = button ? button.textContent : '';
      if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = busyLabel; }
      A.ui.live(busyLabel);
      if (zone) zone.innerHTML = '';
      try { return await task(); }
      catch (error) { const msg = error && error.message ? error.message : 'Une erreur est survenue.'; if (zone) A.ui.inline(zone, msg, 'error'); A.ui.notify(msg, 'error'); return undefined; }
      finally { if (button) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = original; } }
    },
    inline(zone, message, kind) { if (zone) zone.innerHTML = `<div class="alert alert-${kind}" role="${kind === 'error' ? 'alert' : 'status'}"><span class="sym" aria-hidden="true">${kind === 'error' ? '✖' : kind === 'success' ? '✔' : 'ℹ'}</span><span>${A.esc(message)}</span></div>`; }
  };

  /* ---------- État réseau ---------- */
  A.net = { get online() { return navigator.onLine; } };
  A.onNetworkChange = (cb) => { root.addEventListener('online', cb); root.addEventListener('offline', cb); };
})(window);
