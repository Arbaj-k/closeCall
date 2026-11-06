/* Phase 1 frontend only. No room creation or video connection is active yet. */
(() => {
  const createButton = document.querySelector('#create-room');
  const joinForm = document.querySelector('#join-form');
  const inviteInput = document.querySelector('#invite-link');
  const dialog = document.querySelector('#nickname-dialog');
  const nicknameInput = document.querySelector('#nickname');
  const continueButton = document.querySelector('#continue-room');
  const error = document.querySelector('#modal-error');
  const toast = document.querySelector('#toast');
  let intent = 'create';

  document.querySelector('#year').textContent = new Date().getFullYear();

  function notify(message) {
    toast.textContent = message;
    toast.classList.add('show');
    window.setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function openNickname(nextIntent, invite = '') {
    intent = nextIntent;
    dialog.dataset.invite = invite;
    error.textContent = '';
    nicknameInput.value = '';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else notify('Please use a modern browser to continue.');
    window.setTimeout(() => nicknameInput.focus(), 50);
  }

  createButton.addEventListener('click', () => openNickname('create'));

  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = inviteInput.value.trim();
    if (!value) {
      inviteInput.focus();
      notify('Paste an invitation link or room code first.');
      return;
    }
    openNickname('join', value);
  });

  continueButton.addEventListener('click', (event) => {
    event.preventDefault();
    const nickname = nicknameInput.value.trim().replace(/\s+/g, ' ');
    if (!nickname || nickname.length > 24 || /[<>]/.test(nickname)) {
      error.textContent = 'Enter a nickname between 1 and 24 characters.';
      nicknameInput.focus();
      return;
    }

    // Intentionally stop here: Phase 1 has no backend room service yet.
    // Do not create fake room IDs or pretend a call is connected.
    dialog.close();
    notify(intent === 'create'
      ? 'Frontend ready. Room creation will be enabled in Phase 2.'
      : 'Frontend ready. Secure room joining will be enabled in Phase 2.');
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
})();
