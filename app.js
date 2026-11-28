/* PWA Kasindi — vérification des reçus et enregistrement Bulongo */
(function (root) {
  'use strict';
  const A = root.ACCAD, $ = (s) => document.querySelector(s);
  A.app = { site: 'KASINDI', role: 'VERIFICATION' };
  const lookup = async (id) => { const direct = await A.db.get('receipts', id); if (direct) return direct; return (await A.db.all('receipts')).find((r) => A.up(r.idOperation) === id || A.up(r.reference) === id) || null; };

  function openScanner() {
    A.view.workspace('Scanner un QR Code', `<div class="scanner"><video id="qr-video" muted playsinline></video><div class="frame" aria-hidden="true"></div></div>
      <p id="scan-status" class="muted" role="status">Ouverture de la caméra…</p><div class="row"><button id="scan-retry" class="secondary" hidden>Réessayer</button><button id="scan-close" class="secondary">Fermer le scanner</button></div>`);
    const status = $('#scan-status'), retry = $('#scan-retry');
    const begin = () => { retry.hidden = true; status.textContent = 'Placez le QR du reçu dans le cadre. La lecture est automatique.';
      A.scanner.start($('#qr-video'), onText, (msg) => { A.ui.inline(status, msg, 'error'); retry.hidden = false; }); };
    retry.addEventListener('click', begin);
    $('#scan-close').addEventListener('click', () => { A.scanner.stop(); A.view.home(); });
    begin();
  }

  async function onText(text) {
    if (navigator.vibrate) try { navigator.vibrate(120); } catch (e) { /* ignoré */ }
    const res = await A.verify(text, lookup); showVerdict(res);
    const p = A.session.profile, id = A.newId(p.idAgent);
    await A.outbox.add({ id, type: 'verification', agentId: p.idAgent, payload: { idVerification: id, reference: (res.qr && res.qr.id) || A.up(text).slice(0, 100) || 'ILLISIBLE', qr: String(text).slice(0, 300), mode: 'QR', createdAt: new Date().toISOString(), observation: res.ok ? '' : res.reason }, localResult: res.ok ? 'CONFORME' : 'NON_CONFORME' });
    A.common.refreshHome(); if (navigator.onLine) A.sync.run({ site: A.app.site, role: A.app.role }).then(() => A.common.refreshHome());
  }

  function showVerdict(res) {
    const r = res.receipt, ok = res.ok;
    A.view.workspace('Résultat', `<div class="verdict ${ok ? 'ok' : 'bad'}" role="${ok ? 'status' : 'alert'}"><span class="big" aria-hidden="true">${ok ? '✔' : '✖'}</span>${ok ? 'REÇU CONFORME' : 'REÇU NON CONFORME'}<small>${A.esc(res.reason)}</small></div>
      ${r ? `<dl class="details"><dt>Référence</dt><dd>${A.esc(r.reference)}</dd><dt>Montant</dt><dd>${A.esc(A.money(r.montant, r.devise))}</dd><dt>Plaque</dt><dd>${A.esc(r.plaque)}</dd><dt>Type</dt><dd>${A.esc(r.typeCamion)}</dd><dt>Agence</dt><dd>${A.esc(r.agence)}</dd><dt>Exportateur</dt><dd>${A.esc(r.exportateur)}</dd><dt>Produit</dt><dd>${A.esc(r.produit)}</dd><dt>Agent</dt><dd>${A.esc(r.agentName)}</dd><dt>Date et heure</dt><dd>${A.esc(r.date)} ${A.esc(String(r.time).slice(0, 5))}</dd></dl>` : ''}
      <p class="muted">Vérification enregistrée sur ce téléphone${navigator.onLine ? ' et envoyée au service central.' : ' — synchronisation en attente.'}</p>
      <div class="row"><button id="again">Scanner un autre reçu</button>${r ? '<button id="see" class="secondary">Voir le reçu</button>' : ''}<button id="home" class="secondary">Accueil</button></div><div id="receipt-slot"></div>`);
    $('#again').addEventListener('click', openScanner); $('#home').addEventListener('click', () => A.view.home());
    if (r) $('#see').addEventListener('click', async (e) => { e.currentTarget.disabled = true; const box = document.createElement('div'); box.className = 'receipt-wrap'; $('#receipt-slot').appendChild(box); await A.receipt.show(A.receipt.fromCache(r), box); box.scrollIntoView({ behavior: 'smooth' }); });
  }

  async function openHistory() {
    const p = A.session.profile; A.view.workspace('Historique', '<p class="muted">Chargement…</p>');
    const local = (await A.outbox.mine(p.idAgent)).filter((i) => i.type === 'verification');
    const seen = {}, rows = [];
    local.forEach((i) => { seen[i.id] = 1; rows.push({ ref: i.payload.reference, at: i.payload.createdAt.replace('T', ' ').slice(0, 16), res: (i.result && i.result.verification && i.result.verification.RESULTAT_VERIFICATION) || i.localResult, st: i.status }); });
    if (navigator.onLine && A.session.token) { try { (await A.api('verifications.list', {})).forEach((v) => { if (!seen[v.ID_VERIFICATION]) rows.push({ ref: v.REFERENCE_RECU, at: v.DATE_VERIFICATION + ' ' + String(v.HEURE_VERIFICATION).slice(0, 5), res: v.RESULTAT_VERIFICATION || (v.RESULTAT_SIGNATURE === 'VALIDE' ? 'CONFORME' : 'NON_CONFORME'), st: 'SYNCED' }); }); } catch (e) { /* hors connexion */ } }
    $('#workspace-content').innerHTML = (rows.length ? `<ul class="list">${rows.reverse().map((r) => { const ok = r.res === 'CONFORME'; const [cls, label] = A.common.statusLabel(r.st); return `<li><div class="card" style="margin:0"><b class="${ok ? '' : ''}">${ok ? '✔ CONFORME' : '✖ NON CONFORME'}</b> <span class="chip ${cls}">${label}</span><small class="muted" style="display:block;overflow-wrap:anywhere">${A.esc(r.ref)} · ${A.esc(r.at)}</small></div></li>`; }).join('')}</ul>` : '<p class="muted">Aucune vérification pour le moment.</p>') + '<div class="row"><button id="ops-bulongo" class="secondary">Opérations Bulongo</button></div>';
    $('#ops-bulongo').addEventListener('click', () => A.common.openOperations());
  }

  A.kasindi = { onText };
  document.addEventListener('DOMContentLoaded', () => {
    A.common.init();
    $('#scan').addEventListener('click', openScanner);
    $('#bulongo').addEventListener('click', () => A.common.openOperationForm('BULONGO'));
    $('#reversements').addEventListener('click', () => A.common.openReversement());
    $('#history').addEventListener('click', openHistory);
    window.addEventListener('pagehide', () => A.scanner.stop());
  });
})(window);
