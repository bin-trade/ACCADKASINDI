/* ACCAD Trace — saisie d'une opération, reçu à l'écran, liste des opérations */
(function (root) {
  'use strict';
  const A = root.ACCAD, $ = (s) => document.querySelector(s);

  // MAJUSCULES immédiates sur tous les champs textuels métier
  document.addEventListener('input', (e) => { const t = e.target; if (t && t.matches && t.matches('input[data-upper]')) { const s = t.selectionStart, en = t.selectionEnd; const u = t.value.toUpperCase(); if (u !== t.value) { t.value = u; try { t.setSelectionRange(s, en); } catch (x) { /* ignoré */ } } } });

  Object.assign(A.common, {
    statusLabel(s) { return s === 'SYNCED' ? ['ok', '✔ Synchronisé'] : s === 'SYNC_ERROR' ? ['bad', '✖ Refusé'] : ['warn', '⏳ En attente']; },

    async createOperation(mode, v, opId) {
      const p = A.session.profile, cfg = await A.sync.config();
      const tariff = cfg && cfg.tarifs && cfg.tarifs[0];
      if (!tariff) throw new Error('Tarif non disponible. Connectez-vous une fois avec le réseau pour charger les données.');
      const now = new Date();
      const data = { operationId: opId, createdAt: now.toISOString(), plaque: v.plaque, typeCamion: v.typeCamion, agence: v.agence, exportateur: v.exportateur, produit: v.produit, tariffId: tariff.id };
      const local = { id: opId, reference: opId, montant: tariff.montant, devise: tariff.devise, plaque: v.plaque, typeCamion: v.typeCamion, agence: v.agence, exportateur: v.exportateur, produit: v.produit, agentName: p.nomComplet, agentId: p.idAgent, agentPhone: p.telephone, date: A.dateText(now), time: A.timeText(now), site: mode === 'BULONGO' ? 'BULONGO' : 'BENI' };
      local.qr = A.qrPayload(local.reference, local.plaque, local.agentId, local.date);
      const payload = { mode, data };
      if (navigator.onLine && A.session.token) {
        try {
          const d = await A.api('operation.create', payload);
          const receipt = A.receipt.fromServer(d.operation, d.payment);
          await A.outbox.add({ id: opId, type: 'operation', agentId: p.idAgent, payload, receipt, status: 'SYNCED', result: d, syncedAt: Date.now() });
          await A.db.put('receipts', A.receiptCacheEntry(receipt)); await A.sync.pull().catch(() => {});
          return { receipt, queued: false };
        } catch (e) { if (!e.network) throw e; }
      }
      await A.outbox.add({ id: opId, type: 'operation', agentId: p.idAgent, payload, receipt: local });
      await A.db.put('receipts', A.receiptCacheEntry(local));
      return { receipt: local, queued: true };
    },

    openOperationForm(mode) {
      const bulongo = mode === 'BULONGO', p = A.session.profile;
      A.sync.config().then((cfg) => { const dl = $('#types-list'); if (dl && cfg && cfg.typesCamions) dl.innerHTML = cfg.typesCamions.map((t) => `<option value="${A.esc(t)}">`).join(''); });
      A.view.workspace(bulongo ? 'Enregistrer Bulongo' : 'Nouveau voyage', `<form id="op-form" novalidate>
        <label for="f-plaque">Plaque du camion</label><input id="f-plaque" data-upper autocomplete="off" required>
        <label for="f-type">Type de camion</label><input id="f-type" data-upper list="types-list" autocomplete="off" required><datalist id="types-list"></datalist>
        <label for="f-agence">Agence en douane</label><input id="f-agence" data-upper autocomplete="off" required ${bulongo ? 'value="BULONGO" readonly' : ''}>
        <label for="f-exp">Exportateur</label><input id="f-exp" data-upper autocomplete="off" required>
        <label for="f-prod">Produit</label><input id="f-prod" data-upper autocomplete="off" required>
        <div class="row"><button type="submit">Enregistrer</button></div></form><div id="op-result" aria-live="polite"></div>`);
      const form = $('#op-form'), zone = $('#op-result'); let opId = A.newId(p.idAgent); // le même identifiant sert à tous les essais : jamais de doublon
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await A.ui.run(e.submitter, 'Enregistrement en cours…', async () => {
          const v = { plaque: A.up($('#f-plaque').value), typeCamion: A.up($('#f-type').value), agence: A.up($('#f-agence').value), exportateur: A.up($('#f-exp').value), produit: A.up($('#f-prod').value) };
          const labels = { plaque: 'la plaque', typeCamion: 'le type de camion', agence: 'l’agence en douane', exportateur: 'l’exportateur', produit: 'le produit' };
          for (const k of Object.keys(v)) if (!v[k]) { $('#f-' + ({ plaque: 'plaque', typeCamion: 'type', agence: 'agence', exportateur: 'exp', produit: 'prod' })[k]).focus(); throw new Error('Renseignez ' + labels[k] + '.'); }
          const r = await A.common.createOperation(mode, v, opId);
          opId = A.newId(p.idAgent); A.common.refreshHome(); await A.common.showReceipt(r.receipt, r.queued, () => A.common.openOperationForm(mode));
        }, zone);
      });
      $('#f-plaque').focus();
    },

    async showReceipt(r, queued, again) {
      A.view.workspace('Reçu', `<div id="rc-banner"></div><div class="receipt-wrap" id="rc-box"><p class="muted">Préparation du reçu…</p></div>
        <div class="row"><button id="rc-pdf">Télécharger le reçu PDF</button><button id="rc-print" class="secondary">Imprimer sur imprimante thermique</button></div>
        <div class="row">${again ? '<button id="rc-again" class="secondary">Nouveau voyage</button>' : ''}<button id="rc-close" class="secondary">Retour à l’accueil</button></div><div id="rc-msg" aria-live="polite"></div>`);
      const banner = $('#rc-banner');
      if (queued) A.ui.inline(banner, 'Enregistré hors connexion — synchronisation en attente', 'warn'); else A.ui.inline(banner, 'Opération enregistrée et reçu confirmé.', 'success');
      try { await A.receipt.show(r, $('#rc-box')); } catch (e) { A.ui.inline($('#rc-box'), 'Impossible d’afficher le reçu.', 'error'); }
      $('#rc-pdf').addEventListener('click', (e) => A.ui.run(e.currentTarget, 'Préparation du PDF…', async () => { await A.receipt.downloadPdf(r); A.ui.notify('Reçu PDF prêt : ' + A.receipt.fileName(r), 'success'); }, $('#rc-msg')));
      $('#rc-print').addEventListener('click', (e) => A.ui.run(e.currentTarget, 'Préparation de l’impression…', async () => { await A.receipt.printThermal(r); }, $('#rc-msg')));
      if (again) $('#rc-again').addEventListener('click', again);
      $('#rc-close').addEventListener('click', () => A.view.home());
    },

    async openOperations() {
      const p = A.session.profile;
      A.view.workspace(A.app.role === 'PERCEPTION' ? 'Mes opérations' : 'Opérations Bulongo', '<p class="muted">Chargement…</p><div id="ops-msg"></div>');
      const local = (await A.outbox.mine(p.idAgent)).filter((i) => i.type === 'operation');
      const byId = {}; local.forEach((i) => { byId[i.id] = { receipt: i.receipt, status: i.status, err: i.lastError, at: i.createdAt }; });
      if (navigator.onLine && A.session.token) { try { (await A.api('operations.list', {})).forEach((o) => { if (!byId[o.ID_OPERATION]) byId[o.ID_OPERATION] = { receipt: A.receipt.fromServer(o, null), status: 'SYNCED', at: o.DATE_CREATION }; else if (byId[o.ID_OPERATION].status !== 'SYNCED') { /* garde l'état local */ } }); } catch (e) { A.ui.inline($('#ops-msg'), 'Liste centrale indisponible : affichage des opérations de ce téléphone.', 'warn'); } }
      const rows = Object.values(byId).sort((a, b) => String(b.receipt.date + b.receipt.time) < String(a.receipt.date + a.receipt.time) ? -1 : 1);
      const html = rows.length ? `<ul class="list">${rows.map((o, i) => { const [cls, label] = A.common.statusLabel(o.status); return `<li><button class="item" data-i="${i}"><b>${A.esc(o.receipt.plaque)}</b> · ${A.esc(A.money(o.receipt.montant, o.receipt.devise))} <span class="chip ${cls}">${label}</span><small>${A.esc(o.receipt.exportateur)} · ${A.esc(o.receipt.date)} ${A.esc(String(o.receipt.time).slice(0, 5))}${o.err ? ' · ' + A.esc(o.err) : ''}</small></button></li>`; }).join('')}</ul>` : '<p class="muted">Aucune opération pour le moment.</p>';
      $('#workspace-content').innerHTML = '<div id="ops-msg"></div>' + html;
      $('#workspace-content').querySelectorAll('button.item').forEach((b) => b.addEventListener('click', () => { const o = rows[Number(b.dataset.i)]; A.common.showReceipt(o.receipt, o.status !== 'SYNCED'); }));
    }
  });
})(window);
