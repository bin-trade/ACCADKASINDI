/* ACCAD Trace — connexion en ligne et hors connexion */
(function (root) {
  'use strict';
  const A = root.ACCAD;
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

  /** Dérivation PBKDF2-SHA256 (identique côté central pour la validation des receveurs). */
  A.derive = async function (secret, salt, iterations) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' }, key, 256));
  };
  const phoneKey = (v) => String(v || '').replace(/[^0-9]/g, '').replace(/^(00)?243/, '').replace(/^0/, '');
  A.phoneKey = phoneKey;
  const keysFor = (site, idOrPhone) => { const k = A.up(idOrPhone); const keys = [`${site}:${k}`]; const p = phoneKey(idOrPhone); if (p.length >= 8) keys.push(`${site}:TEL:${p}`); return keys; };

  A.auth = {
    allowed(profile, site, role) { return profile && A.up(profile.site) === A.up(site) && A.up(profile.role) === A.up(role); },
    async storeIdentity(site, profile, code) {
      const salt = `ACCAD-LOCAL:${profile.idAgent}:${profile.profileVersion || 'v1'}`;
      const verifier = await A.derive(code, salt, 120000);
      const record = { idAgent: profile.idAgent, salt, verifier, profile, expiresAt: Date.now() + A.TTL.identity };
      await A.db.putMany('identities', keysFor(site, profile.idAgent).concat(keysFor(site, profile.telephone)).map((key) => Object.assign({ key }, record)));
    },
    async purgeIdentity(site, identifier) { for (const key of keysFor(site, identifier)) await A.db.remove('identities', key); },
    /** Connexion : le service central décide quand il répond ; le cache local ne sert que sans réseau. */
    async login(identifier, code, site, role) {
      const id = A.up(identifier);
      if (!id || !code) throw new Error('Saisissez votre identifiant et votre code.');
      let networkDown = !navigator.onLine;
      if (!networkDown) {
        try {
          const data = await A.api('auth.login', { identifier: id, code, sessionToken: '' }, { timeout: 15000 });
          if (!A.auth.allowed(data.profile, site, role)) throw Object.assign(new Error('Ce profil n’a pas accès à cette application.'), { server: true });
          await A.auth.storeIdentity(site, data.profile, code);
          A.session.start(data.profile, data.sessionToken, false, { identifier: id, code });
          return { offline: false, profile: data.profile };
        } catch (error) {
          if (!error.network) { await A.auth.purgeIdentity(site, id); throw error; } // refus du service : jamais de repli hors connexion
          networkDown = true;
        }
      }
      const cached = (await Promise.all(keysFor(site, id).map((k) => A.db.get('identities', k)))).find(Boolean);
      if (!cached) throw new Error('Pas de connexion. Une première connexion avec le réseau est nécessaire sur ce téléphone.');
      if (cached.expiresAt < Date.now()) throw new Error('Accès hors connexion expiré. Connectez-vous une fois avec le réseau pour le renouveler.');
      if (!A.auth.allowed(cached.profile, site, role) || (await A.derive(code, cached.salt, 120000)) !== cached.verifier) throw new Error('Identifiant ou code incorrect.');
      A.session.start(cached.profile, null, true, { identifier: id, code });
      return { offline: true, profile: cached.profile };
    },
    /** Rétablit une session centrale à partir des identifiants gardés en mémoire (jamais écrits sur disque). */
    async relogin(site, role) {
      const u = A.session.unlock; if (!u) return false;
      try {
        const data = await A.api('auth.login', { identifier: u.identifier, code: u.code, sessionToken: '' }, { timeout: 15000 });
        if (!A.auth.allowed(data.profile, site, role)) return false;
        await A.auth.storeIdentity(site, data.profile, u.code);
        A.session.start(data.profile, data.sessionToken, false, u);
        return true;
      } catch (error) {
        if (error.server) { await A.auth.purgeIdentity(site, u.identifier); A.session.logout('Votre accès a changé. Veuillez vous reconnecter.'); }
        return false;
      }
    }
  };
})(window);
