(() => {
  const active = new WeakSet();
  let feedback;
  const getFeedback = () => {
    if (feedback) return feedback;
    feedback = document.createElement('div');
    feedback.id = 'global-action-feedback';
    feedback.className = 'global-action-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    feedback.hidden = true;
    document.body.appendChild(feedback);
    return feedback;
  };
  const setBusy = (button, message = 'Traitement en cours…') => {
    if (!button || active.has(button)) return;
    active.add(button);
    button.dataset.feedbackLabel = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.classList.add('is-loading');
    const box = getFeedback();
    box.hidden = false;
    box.className = 'global-action-feedback is-pending';
    box.textContent = message;
  };
  const finish = (button, message, error = false) => {
    if (!button || !active.has(button)) return;
    active.delete(button);
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.classList.remove('is-loading');
    if (button.dataset.feedbackLabel) button.textContent = button.dataset.feedbackLabel;
    const box = getFeedback();
    box.hidden = false;
    box.className = `global-action-feedback ${error ? 'is-error' : 'is-success'}`;
    box.textContent = message;
    window.setTimeout(() => { if (box.classList.contains(error ? 'is-error' : 'is-success')) box.hidden = true; }, 3500);
  };
  window.finishActionFeedback = (message, error = false) => document.querySelectorAll('button.is-loading').forEach((button) => finish(button, message, error));
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.type === 'submit' || button.id === 'toggle-code' || button.id === 'close-modal') return;
    setBusy(button, 'Ouverture en cours…');
    window.setTimeout(() => finish(button, 'Action effectuée.'), ['sync', 'refresh', 'history'].includes(button.id) ? 30000 : 1200);
  }, true);
  document.addEventListener('submit', (event) => {
    const button = event.target.querySelector('button[type="submit"]');
    if (button) setBusy(button, 'Enregistrement en cours…');
  }, true);
  const observer = new MutationObserver(() => {
    const statuses = [...document.querySelectorAll('.status')].filter((node) => !node.hidden && node.textContent.trim());
    const latest = statuses[statuses.length - 1];
    const text = latest?.textContent.trim() || '';
    const pending = /en cours|traitement|chargement|recherche|vérification en cours|enregistrement en cours|synchronisation en cours/i.test(text);
    const completedReceipt = document.querySelector('.receipt');
    if (pending && !completedReceipt) return;
    if (!text && !completedReceipt) return;
    const error = /erreur|impossible|refus|invalide|introuvable|échoué|échec|supérieur au disponible/i.test(text);
    const message = error ? `Échec : ${text}` : (completedReceipt && !text ? 'Opération terminée. Reçu disponible.' : text);
    document.querySelectorAll('button.is-loading').forEach((button) => finish(button, message, error));
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] });})();
