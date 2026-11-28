/* ACCAD Trace — contrôle d'un reçu à partir du QR et de la copie locale */
(function (root) {
  'use strict';
  const A = root.ACCAD;
  /** lookup(id) → reçu local ou null. Retourne { ok, title, reason, receipt, qr }. */
  A.verify = async function (qrText, lookup) {
    const qr = A.parseQr(qrText);
    if (!qr || !qr.id) return { ok: false, reason: 'Code illisible ou vide.', qr };
    if (qr.foreign && !/^[A-Z0-9][A-Z0-9\-_.]{5,}$/.test(qr.id)) return { ok: false, reason: 'Ce code n’est pas un reçu ACCAD.', qr };
    const rec = await lookup(qr.id);
    if (!rec) return { ok: false, reason: 'Reçu inconnu dans les données de ce téléphone.', qr, unknown: true };
    if (String(rec.statut || 'CONFIRMED').toUpperCase() !== 'CONFIRMED') return { ok: false, reason: 'Paiement non confirmé pour ce reçu.', qr, receipt: rec };
    const mismatches = [];
    if (qr.plaque && A.up(qr.plaque) !== A.up(rec.plaque)) mismatches.push('plaque');
    if (qr.agent && A.up(qr.agent) !== A.up(rec.agentId) && A.up(qr.agent) !== A.up(rec.agentName)) mismatches.push('agent');
    if (qr.date && A.up(qr.date) !== A.up(rec.date)) mismatches.push('date');
    if (mismatches.length) return { ok: false, reason: 'Le code ne correspond pas au reçu enregistré (' + mismatches.join(', ') + ').', qr, receipt: rec };
    return { ok: true, reason: 'Reçu reconnu et valide.', qr, receipt: rec };
  };
})(window);
