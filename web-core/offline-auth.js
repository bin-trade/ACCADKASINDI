(() => {
  const script = document.currentScript;
  const site = script?.dataset.site || 'ACCAD';
  const role = script?.dataset.role || '';
  const DB_NAME = 'ACCAD_OFFLINE_AUTH';
  const DB_VERSION = 1;
  const CACHE_TTL = 72 * 60 * 60 * 1000;

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('identities')) request.result.createObjectStore('identities', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function digest(identifier, code, salt) {
    const encoder = new TextEncoder();
    const material = await crypto.subtle.importKey('raw', encoder.encode(`${identifier}:${code}`), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 120000, hash: 'SHA-256' }, material, 256);
    return Array.from(new Uint8Array(bits), (value) => value.toString(16).padStart(2, '0')).join('');
  }

  function normalize(value) { return String(value || '').trim().toUpperCase(); }
  function cacheKey(identifier) { return `${site}:${normalize(identifier)}`; }
  function setSession(data, offline) {
    if (!offline) sessionStorage.setItem('accadSession', data.sessionToken);
    sessionStorage.setItem('accadAgentId', data.profile.idAgent);
    sessionStorage.setItem('accadAgentName', data.profile.nomComplet);
    sessionStorage.setItem('accadRole', data.profile.role);
    sessionStorage.setItem('accadOfflineMode', offline ? '1' : '0');
    document.querySelector('#agent-name').textContent = data.profile.nomComplet;
    document.querySelector('#login-card').hidden = true;
    document.querySelector('#home-card').hidden = false;
  }
  function allowed(profile) { return profile && normalize(profile.site) === normalize(site) && normalize(profile.role) === normalize(role); }
  async function store(identifier, code, data) {
    const salt = `${site}:${data.profile.idAgent}:${data.profile.DATE_MODIFICATION || 'v1'}`;
    const verifier = await digest(normalize(identifier), code, salt);
    const db = await openDb();
    const tx = db.transaction('identities', 'readwrite');
    tx.objectStore('identities').put({ key: cacheKey(identifier), identifier: normalize(identifier), salt, verifier, profile: data.profile, updatedAt: Date.now(), expiresAt: Date.now() + CACHE_TTL });
    return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }
  async function read(identifier) {
    const db = await openDb();
    return new Promise((resolve, reject) => { const request = db.transaction('identities', 'readonly').objectStore('identities').get(cacheKey(identifier)); request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error); });
  }
  async function onlineLogin(identifier, code) {
    const response = await fetch(window.ACCAD_CONFIG.apiUrl, { method: 'POST', body: JSON.stringify({ action: 'auth.login', identifier, code }) });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || 'Connexion refusée.');
    if (!allowed(result.data.profile)) throw new Error('Ce profil n’a pas accès à cette application.');
    await store(identifier, code, result.data);
    setSession(result.data, false);
  }
  async function offlineLogin(identifier, code) {
    const cached = await read(identifier);
    if (!cached || cached.expiresAt < Date.now()) throw new Error('Une connexion récente est nécessaire pour renouveler cet accès.');
    if (!allowed(cached.profile) || await digest(normalize(identifier), code, cached.salt) !== cached.verifier) throw new Error('Identifiant ou code incorrect.');
    setSession({ profile: cached.profile }, true);
    window.ACCAD_OFFLINE_UNLOCK = { identifier, code };
  }

  const form = document.querySelector('#login-form');
  if (!form) return;
  window.addEventListener('online', async () => {
    const unlock = window.ACCAD_OFFLINE_UNLOCK;
    if (!unlock || sessionStorage.getItem('accadOfflineMode') !== '1') return;
    try { await onlineLogin(unlock.identifier, unlock.code); window.dispatchEvent(new CustomEvent('accad-online-session-restored')); } catch (error) { /* La synchronisation attendra une connexion manuelle. */ }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); event.stopImmediatePropagation();
    const status = document.querySelector('#login-status');
    const identifier = document.querySelector('#identifier').value.trim();
    const code = document.querySelector('#code').value;
    status.hidden = false; status.textContent = 'Connexion en cours…';
    try {
      if (navigator.onLine) await onlineLogin(identifier, code);
      else await offlineLogin(identifier, code);
      status.textContent = navigator.onLine ? 'Connexion confirmée.' : 'Mode hors connexion activé.';
      window.dispatchEvent(new CustomEvent('accad-auth-ready'));
    } catch (error) {
      if (navigator.onLine) {
        try { await offlineLogin(identifier, code); status.textContent = 'Mode hors connexion activé.'; window.dispatchEvent(new CustomEvent('accad-auth-ready')); return; } catch (offlineError) {}
      }
      status.textContent = error.message;
    }
  }, true);
})();
