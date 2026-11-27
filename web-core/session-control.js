(() => {
  const SESSION_LIMIT = 15 * 60 * 1000;
  let timer;
  const expireSession = () => {
    sessionStorage.clear();
    document.querySelector('#workspace')?.setAttribute('hidden', '');
    document.querySelector('#home-card')?.setAttribute('hidden', '');
    const login = document.querySelector('#login-card');
    if (login) login.hidden = false;
    const form = document.querySelector('#login-form');
    form?.reset();
    const status = document.querySelector('#login-status');
    if (status) { status.hidden = false; status.textContent = 'Session expirée après 15 minutes. Veuillez saisir de nouveau votre code.'; }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const startTimer = () => {
    window.clearTimeout(timer);
    const startedAt = Number(sessionStorage.getItem('accadSessionStartedAt') || Date.now());
    sessionStorage.setItem('accadSessionStartedAt', String(startedAt));
    timer = window.setTimeout(expireSession, Math.max(1000, SESSION_LIMIT - (Date.now() - startedAt)));
  };
  window.addEventListener('accad-auth-ready', startTimer);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#logout')) return;
    event.preventDefault();
    sessionStorage.clear();
    window.clearTimeout(timer);
    document.querySelector('#workspace')?.setAttribute('hidden', '');
    document.querySelector('#home-card')?.setAttribute('hidden', '');
    const login = document.querySelector('#login-card');
    if (login) login.hidden = false;
    const form = document.querySelector('#login-form');
    form?.reset();
    const status = document.querySelector('#login-status');
    if (status) { status.hidden = false; status.textContent = 'Session fermée. Vous pouvez connecter un autre agent.'; }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, true);
})();
