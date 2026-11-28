/* ACCAD Trace — file locale, synchronisation idempotente, données de référence */
(function (root) {
  'use strict';
  const A = root.ACCAD;
  const ORDER = { operation: 1, reversement: 2, verification: 3 };
  const ACTION = { operation: 'operation.create', reversement: 'reversement.create', verification: 'verification.create' };
  let running = false;

  A.outbox = {
    async add(item) { const rec = Object.assign({ status: 'LOCAL_PENDING', attempts: 0, lastError: '', createdAt: new Date().toISOString() }, item); await A.db.put('outbox', rec); return rec; },
    async all() { return (await A.db.all('outbox')).sort((a, b) => a.createdAt < b.createdAt ? -1 : 1); },
    async mine(agentId) { return (await A.outbox.all()).filter((i) => i.agentId === agentId); },
    async pending(agentId) { return (await A.outbox.mine(agentId)).filter((i) => i.status !== 'SYNCED'); },
    async othersPending(agentId) { return (await A.outbox.all()).filter((i) => i.agentId !== agentId && i.status !== 'SYNCED').length; }
  };

  A.sync = {
    get running() { return running; },
    async state() { return (await A.db.kvGet('syncState')) || { lastSuccess: null, lastError: '' }; },
    /** Solde local = dernier solde central + opérations et reversements encore en attente. */
    async localBalance() {
      const p = A.session.profile; if (!p) return null;
      const base = (await A.db.kvGet('balance:' + p.idAgent)) || { disponible: 0, devise: 'USD', pulledAt: null };
      const pend = await A.outbox.pending(p.idAgent);
      let value = Number(base.disponible) || 0;
      pend.forEach((i) => { if (i.type === 'operation') value += Number(i.receipt && i.receipt.montant) || 0; if (i.type === 'reversement') value -= Number(i.payload.data.montant) || 0; });
      return { disponible: Math.round(value * 100) / 100, devise: base.devise, pendingCount: pend.length, known: Boolean(base.pulledAt), pulledAt: base.pulledAt };
    },
    async config() { return A.db.kvGet('config'); },
    async pull() {
      const p = A.session.profile; if (!p || !A.session.token) return false;
      const d = await A.api('sync.pull', {});
      if (d.balance) await A.db.kvSet('balance:' + p.idAgent, Object.assign({}, d.balance, { pulledAt: Date.now() }));
      if (d.tarifs) await A.db.kvSet('config', { tarifs: d.tarifs, typesCamions: d.typesCamions || [], receivers: d.receivers || [], configVersion: d.configVersion, pulledAt: Date.now(), site: p.site });
      if (d.receipts) await A.db.putMany('receipts', d.receipts.map((r) => Object.assign({}, r, { syncedAt: Date.now() })));
      return true;
    },
    /** Envoie la file puis rafraîchit les données de référence. Une seule synchronisation à la fois. */
    async run(opts) {
      opts = opts || {};
      const emit = (msg, done, total, kind) => { if (opts.progress) opts.progress(msg, done, total, kind); root.dispatchEvent(new CustomEvent('accad-sync', { detail: { msg, done, total, kind } })); };
      if (running) return { skipped: 'busy' };
      const p = A.session.profile; if (!p) return { skipped: 'nosession' };
      if (!navigator.onLine) { emit('Pas de réseau : la synchronisation reprendra automatiquement.', 0, 0, 'warn'); return { skipped: 'offline' }; }
      running = true; emit('Synchronisation en cours…', 0, 0, 'info');
      const summary = { sent: 0, failed: 0, remaining: 0 };
      try {
        if (!A.session.token && !(await A.auth.relogin(opts.site, opts.role))) { emit('Reconnectez-vous pour envoyer les données en attente.', 0, 0, 'warn'); return { skipped: 'needlogin' }; }
        const queue = (await A.outbox.pending(p.idAgent)).filter((i) => opts.manual || i.attempts < 6).sort((a, b) => ORDER[a.type] - ORDER[b.type] || (a.createdAt < b.createdAt ? -1 : 1));
        let done = 0;
        for (const item of queue) {
          emit(`Envoi ${done + 1} sur ${queue.length}…`, done, queue.length, 'info');
          try {
            let data;
            try { data = await A.api(ACTION[item.type], item.payload); }
            catch (e) { if (e.sessionLost && (await A.auth.relogin(opts.site, opts.role))) data = await A.api(ACTION[item.type], item.payload); else throw e; }
            item.status = 'SYNCED'; item.lastError = ''; item.result = data; item.syncedAt = Date.now();
            if (item.type === 'operation' && data.operation) {
              item.receipt = Object.assign({}, item.receipt, { montant: data.operation.MONTANT, devise: data.operation.DEVISE, date: data.operation.DATE_PAIEMENT, time: data.operation.HEURE_PAIEMENT });
              await A.db.put('receipts', receiptCacheEntry(item.receipt));
            }
            summary.sent++;
          } catch (e) {
            if (e.network) { item.attempts++; await A.db.put('outbox', item); throw e; }
            item.status = 'SYNC_ERROR'; item.attempts++; item.lastError = e.message; summary.failed++;
          }
          await A.db.put('outbox', item); done++;
        }
        try { await A.sync.pull(); } catch (e) { if (e.network) throw e; /* référence non rafraîchie : on garde la copie locale */ }
        summary.remaining = (await A.outbox.pending(p.idAgent)).length;
        await A.db.kvSet('syncState', { lastSuccess: Date.now(), lastError: '' });
        emit(summary.failed ? `Synchronisation terminée avec ${summary.failed} élément(s) refusé(s).` : summary.sent ? `Synchronisation réussie : ${summary.sent} élément(s) envoyé(s).` : 'Tout est à jour.', summary.sent, summary.sent, summary.failed ? 'error' : 'success');
        return summary;
      } catch (e) {
        await A.db.kvSet('syncState', Object.assign(await A.sync.state(), { lastError: e.message }));
        emit(e.network ? 'Connexion perdue pendant l’envoi. Les données restent enregistrées et seront renvoyées.' : e.message, 0, 0, 'error');
        return { error: e.message };
      } finally { running = false; }
    }
  };

  function receiptCacheEntry(r) { return { reference: r.reference, idOperation: r.id, plaque: r.plaque, agentId: r.agentId, agentName: r.agentName, agentPhone: r.agentPhone, date: r.date, time: r.time, montant: r.montant, devise: r.devise, typeCamion: r.typeCamion, agence: r.agence, exportateur: r.exportateur, produit: r.produit, statut: 'CONFIRMED', site: r.site || '' }; }
  A.receiptCacheEntry = receiptCacheEntry;
})(window);
