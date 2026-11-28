/* ACCAD Trace — éléments d'interface communs (connexion, accueil, reversement, synchronisation) */
(function (root) {
  'use strict';
  const A = root.ACCAD;
  const $ = (s) => document.querySelector(s);
  A.$ = $;
  const SITE_ROLE = () => ({ site: A.app.site, role: A.app.role });

  A.view = {
    show(name) { ['login-card', 'home-card', 'workspace'].forEach((id) => { $('#' + id).hidden = id !== name; }); window.scrollTo({ top: 0 }); },
    workspace(title, html, back) { $('#workspace-title').textContent = title; $('#workspace-content').innerHTML = html; A.view.show('workspace'); const h = $('#workspace-title'); h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); },
    home() { A.view.show('home-card'); A.common.refreshHome(); }
  };

  A.common = {
    async refreshHome() {
      const p = A.session.profile; if (!p) return;
      $('#agent-name').textContent = p.nomComplet; $('#agent-meta').textContent = `Site : ${p.site} · Rôle : ${p.role}`;
      const b = await A.sync.localBalance(); const box = $('#agent-balance');
      if (box) box.innerHTML = b && b.known ? `<span class="muted">Montant détenu</span><b>${A.esc(A.money(b.disponible, b.devise))}</b>${b.pendingCount ? `<span class="muted">dont ${b.pendingCount} opération(s) en attente d’envoi</span>` : ''}` : '<span class="muted">Montant détenu</span><b>—</b><span class="muted">Disponible après la première synchronisation.</span>';
      const st = await A.sync.state(); const sc = $('#sync-chip');
      const pend = (await A.outbox.pending(p.idAgent)).length; const others = await A.outbox.othersPending(p.idAgent);
      sc.hidden = false; sc.className = 'chip ' + (pend ? 'warn' : 'ok');
      sc.textContent = pend ? `⏳ ${pend} en attente` : '✔ Synchronisé';
      $('#last-sync').textContent = st.lastSuccess ? `Dernière synchronisation : ${new Date(st.lastSuccess).toLocaleString('fr-FR')}` : 'Aucune synchronisation réussie pour le moment.';
      const note = $('#others-note'); if (note) { note.hidden = !others; note.textContent = others ? `${others} élément(s) d’un autre agent attendent sa reconnexion sur ce téléphone.` : ''; }
    },
    refreshNet() { const c = $('#net-chip'); const on = navigator.onLine; c.className = 'chip ' + (on ? 'ok' : 'bad'); c.textContent = on ? '● En ligne' : '✖ Hors connexion'; },
    showLogin(message) { A.view.show('login-card'); const s = $('#login-status'); if (s) { s.innerHTML = ''; if (message) A.ui.inline(s, message, 'info'); } $('#login-form').reset(); $('#session-chip').hidden = true; $('#sync-chip').hidden = true; },
    async afterLogin(result) {
      $('#session-chip').hidden = false; $('#session-chip').textContent = result.offline ? 'Mode hors connexion' : 'Connecté';
      A.view.home();
      if (!result.offline) { try { await A.sync.run(Object.assign(SITE_ROLE(), { manual: false })); A.common.refreshHome(); } catch (e) { /* sera repris */ } }
    },
    init() {
      A.session.onExpire = (msg) => A.common.showLogin(msg);
      A.common.refreshNet(); A.onNetworkChange(() => { A.common.refreshNet(); if (navigator.onLine && A.session.profile) A.sync.run(SITE_ROLE()).then(A.common.refreshHome); });
      window.addEventListener('accad-sync', (e) => { const m = $('#sync-message'); if (m && !$('#home-card').hidden) A.ui.inline(m, e.detail.msg, e.detail.kind === 'error' ? 'error' : e.detail.kind === 'success' ? 'success' : e.detail.kind === 'warn' ? 'warn' : 'info'); });
      $('#toggle-code').addEventListener('click', (e) => { const i = $('#code'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; e.currentTarget.textContent = show ? 'Masquer' : 'Afficher'; e.currentTarget.setAttribute('aria-pressed', String(show)); });
      $('#login-form').addEventListener('submit', async (e) => {
        e.preventDefault(); const btn = e.submitter || e.target.querySelector('button[type=submit]'); const zone = $('#login-status');
        const result = await A.ui.run(btn, 'Connexion en cours…', () => A.auth.login($('#identifier').value, $('#code').value, A.app.site, A.app.role), zone);
        if (result) { A.ui.inline(zone, result.offline ? 'Mode hors connexion activé.' : 'Connexion confirmée.', 'success'); await A.common.afterLogin(result); }
      });
      $('#logout').addEventListener('click', () => A.session.logout());
      $('#sync').addEventListener('click', (e) => A.ui.run(e.currentTarget, 'Synchronisation en cours…', async () => { const r = await A.sync.run(Object.assign(SITE_ROLE(), { manual: true })); await A.common.refreshHome(); if (r && r.skipped === 'busy') A.ui.notify('Une synchronisation est déjà en cours.', 'info'); }, $('#sync-message')));
      $('#back-home').addEventListener('click', () => A.view.home());
      setInterval(() => { if (A.session.profile && navigator.onLine && !A.sync.running) A.sync.run(SITE_ROLE()).then(() => { if (!$('#home-card').hidden) A.common.refreshHome(); }); }, 60000);
      if (A.session.restore()) { $('#session-chip').hidden = false; $('#session-chip').textContent = A.session.offline ? 'Mode hors connexion' : 'Connecté'; A.view.home(); } else A.common.showLogin();
    },

    /* ----- Reversement : un formulaire, quatre champs, un bouton ----- */
    async validateReceiverLocally(identifier, code) {
      const cfg = await A.sync.config();
      if (!cfg || !cfg.receivers || Date.now() - cfg.pulledAt > A.TTL.config) throw new Error('Liste des agents de dépôt non disponible ou expirée. Synchronisez avec le réseau.');
      const key = A.up(identifier), ph = A.phoneKey(identifier);
      const r = cfg.receivers.find((x) => A.up(x.idAgent) === key || (ph.length >= 8 && A.phoneKey(x.telephone) === ph));
      if (!r || A.up(r.site) !== A.up(A.session.profile.site)) throw new Error('Identifiant ou code de l’agent receveur incorrect pour ce site.');
      if (r.idAgent === A.session.profile.idAgent) throw new Error('Le déposant et le receveur doivent être deux agents différents.');
      const proof = await A.derive(String(code).trim(), r.salt, r.iterations);
      if (proof !== r.verifier) throw new Error('Identifiant ou code de l’agent receveur incorrect pour ce site.');
      return { receiver: r, proof };
    },
    openReversement() {
      const p = A.session.profile;
      A.view.workspace('Reversement', `<form id="rev-form" novalidate>
        <label for="rev-montant">Montant remis</label><input id="rev-montant" inputmode="decimal" autocomplete="off" required>
        <label for="rev-details">Détails (facultatif)</label><input id="rev-details" data-upper autocomplete="off">
        <label for="rev-recv">Identifiant ou téléphone de l’agent receveur</label><input id="rev-recv" data-upper autocomplete="off" required>
        <label for="rev-code">Code de l’agent receveur</label><input id="rev-code" type="password" autocomplete="off" inputmode="numeric" required>
        <div class="row"><button type="submit">Enregistrer le reversement</button></div></form><div id="rev-result" aria-live="polite"></div><div id="rev-history"></div>`);
      const form = $('#rev-form'); const zone = $('#rev-result'); const rid = A.newId(p.idAgent);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await A.ui.run(e.submitter, 'Enregistrement en cours…', async () => {
          const montant = Number(String($('#rev-montant').value).replace(',', '.'));
          if (!isFinite(montant) || montant <= 0) throw new Error('Le montant remis doit être supérieur à zéro.');
          const recv = $('#rev-recv').value.trim(), code = $('#rev-code').value.trim();
          if (!recv || !code) throw new Error('Identifiant et code de l’agent receveur obligatoires.');
          const bal = await A.sync.localBalance();
          if (!bal || montant > bal.disponible + 0.0001) throw new Error(`Montant supérieur au disponible (${A.money(bal ? bal.disponible : 0, bal && bal.devise)}).`);
          const createdAt = new Date().toISOString(); const details = A.up($('#rev-details').value);
          let result = null, queued = false, receiver = null;
          if (navigator.onLine && A.session.token) {
            try { const d = await A.api('reversement.create', { data: { idReversement: rid, montant, details, receiverIdentifier: recv, receiverCode: code, createdAt } }); result = d.reversement; }
            catch (err) { if (!err.network) throw err; }
          }
          if (!result) { // hors connexion : validation locale puis file d'attente (sans le code en clair)
            const v = await A.common.validateReceiverLocally(recv, code); receiver = v.receiver; queued = true;
            await A.outbox.add({ id: rid, type: 'reversement', agentId: p.idAgent, payload: { data: { idReversement: rid, montant, details, receiverIdentifier: receiver.idAgent, receiverProof: v.proof, createdAt } }, receipt: null });
            result = { ID_REVERSEMENT: rid, MONTANT_REVERSE: montant, DEVISE: bal.devise, NOM_AGENT_RECEPTEUR: receiver.nom, ID_AGENT_RECEPTEUR: receiver.idAgent, OBSERVATION: details };
          } else { await A.sync.pull().catch(() => {}); }
          form.reset();
          zone.innerHTML = `<div class="alert alert-${queued ? 'warn' : 'success'}" role="status"><span class="sym" aria-hidden="true">${queued ? '⏳' : '✔'}</span><div><b>${queued ? 'Enregistré hors connexion — synchronisation en attente' : 'Reversement confirmé'}</b><br>Montant : ${A.esc(A.money(result.MONTANT_REVERSE, result.DEVISE))}<br>Déposant : ${A.esc(p.nomComplet)}<br>Receveur : ${A.esc(result.NOM_AGENT_RECEPTEUR)}<br>Statut : ${queued ? 'CONFIRMÉ LOCALEMENT, EN ATTENTE D’ENVOI' : 'CONFIRMÉ'}</div></div>`;
          A.ui.notify(queued ? 'Reversement enregistré hors connexion.' : 'Reversement confirmé.', 'success');
          A.common.refreshHome(); A.common.reversementHistory();
        }, zone);
      });
      A.common.reversementHistory();
    },
    async reversementHistory() {
      const box = $('#rev-history'); if (!box) return; const p = A.session.profile;
      const local = (await A.outbox.mine(p.idAgent)).filter((i) => i.type === 'reversement');
      let remote = []; if (navigator.onLine && A.session.token) { try { remote = (await A.api('reversements.list', {})).filter((r) => r.ID_AGENT === p.idAgent && r.FINALISE); } catch (e) { /* hors connexion */ } }
      const seen = {}; const rows = [];
      local.forEach((i) => { seen[i.id] = 1; rows.push({ id: i.id, date: i.createdAt, montant: i.payload.data.montant, st: i.status === 'SYNCED' ? 'Confirmé' : i.status === 'SYNC_ERROR' ? 'Refusé : ' + i.lastError : 'En attente d’envoi', bad: i.status === 'SYNC_ERROR' }); });
      remote.forEach((r) => { if (!seen[r.ID_REVERSEMENT]) rows.push({ id: r.ID_REVERSEMENT, date: r.DATE_REVERSEMENT + ' ' + (r.HEURE_REVERSEMENT || ''), montant: r.MONTANT_REVERSE, st: 'Confirmé' }); });
      box.innerHTML = rows.length ? `<h2 style="margin-top:18px">Mes reversements</h2><ul class="list">${rows.slice().reverse().map((r) => `<li><div class="card" style="margin:0"><b>${A.esc(A.money(r.montant))}</b> · ${A.esc(r.st)}<small class="muted" style="display:block">${A.esc(String(r.date).replace('T', ' ').slice(0, 19))}</small></div></li>`).join('')}</ul>` : '';
    }
  };
})(window);
