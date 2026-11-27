window.renderOfflineReceipt = function (root, receipt, site) {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const o = receipt.operation || {};
  const p = receipt.payment || {};
  root.hidden = false;
  root.innerHTML = `<div class="status"><strong>Reçu disponible hors connexion</strong><br>Il est enregistré sur cet appareil et sera synchronisé automatiquement.</div><div class="receipt" id="offline-receipt"><div class="receipt-header"><div class="receipt-institution">REPUBLIQUE DEMOCRATIQUE DU CONGO<br><strong>Gouvernement Provincial du Nord-Kivu</strong><br><strong>PROJET DE DEVELOPPEMENT</strong><br>PROVINCE-FEC-ACCAD</div></div><div class="receipt-content"><p class="eyebrow">REÇU ACCAD TRACE · ${esc(site)}</p><h3>${esc(receipt.reference)}</h3><p><strong>${esc(p.MONTANT_PAYE || o.MONTANT)} ${esc(p.DEVISE || o.DEVISE || 'USD')}</strong> · HORS CONNEXION</p><p>Plaque : ${esc(o.NUMERO_PLAQUE)}</p><p>Agence : ${esc(o.NOM_AGENCE || site)}</p><p>Agent : <strong>${esc(o.NOM_AGENT_SNAPSHOT)}</strong></p><p>Numéro : ${esc(o.REFERENCE_OPERATION || o.ID_OPERATION)}</p><p>Date : ${esc(p.DATE_PAIEMENT || o.DATE_PAIEMENT)} ${esc(p.HEURE_PAIEMENT || o.HEURE_PAIEMENT)}</p></div><div id="offline-receipt-qr"></div></div><button type="button" id="offline-print-receipt">Imprimer le reçu</button>`;
  const qr = document.querySelector('#offline-receipt-qr');
  if (window.QRCode && qr) new QRCode(qr, { text: receipt.receipt?.payload || JSON.stringify({ r: receipt.reference }), width: 148, height: 148 });
  document.querySelector('#offline-print-receipt')?.addEventListener('click', () => window.print());
};
