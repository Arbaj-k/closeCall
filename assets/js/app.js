/* CloseCall room lifecycle client. WebRTC is intentionally not implemented yet. */
(() => {
  'use strict';

  const API_URL = 'https://rpfnlkhcglewunflrarb.supabase.co/functions/v1/closecall-api';
  const SESSION_KEY = 'closecall.session.v1';
  const HEARTBEAT_MS = 45000;

  const $ = (selector) => document.querySelector(selector);
  const createButton = $('#create-room');
  const joinForm = $('#join-form');
  const inviteInput = $('#invite-link');
  const dialog = $('#nickname-dialog');
  const continueButton = $('#continue-room');
  const error = $('#modal-error');
  const toast = $('#toast');
  const home = $('#home-view');
  const roomScreen = $('#room-screen');
  const year = $('#year');

  let intent = 'create';
  let heartbeatTimer = null;
  let busy = false;
  let currentSession = null;

  if (year) year.textContent = new Date().getFullYear();

  function notify(message, isError = false) {
    toast.textContent = message;
    toast.classList.toggle('toast-error', isError);
    toast.classList.add('show');
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function setBusy(value) {
    busy = value;
    createButton.disabled = value;
    continueButton.disabled = value;
    joinForm.querySelector('button').disabled = value;
    continueButton.textContent = value ? 'Please wait…' : 'Continue →';
  }

  function openNickname(nextIntent, invite = '') {
    intent = nextIntent;
    dialog.dataset.invite = invite;
    error.textContent = '';
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      notify('Please use an updated browser.', true);
    }
  }

  function parseInvite(value) {
    const raw = value.trim();
    if (!raw) throw new Error('Enter your 32-character room code or paste the invitation link.');
    const directCode = raw.replace(/[\\s-]/g, '').toUpperCase();
    if (/^[A-F0-9]{32}$/.test(directCode)) return { room_code: directCode };
    let url;
    try {
      url = new URL(raw, window.location.href);
    } catch {
      throw new Error('That invitation link is not valid.');
    }
    const roomCode = (url.searchParams.get('room') || '').trim().toUpperCase();
    const inviteToken = (url.searchParams.get('token') || '').trim();
    if (/^[A-F0-9]{32}$/.test(roomCode) && !inviteToken) return { room_code: roomCode };
    if (/^[A-F0-9]{8}$/.test(roomCode) && /^[a-f0-9]{64}$/i.test(inviteToken)) return { room_code: roomCode, invite_token: inviteToken };
    throw new Error('That code or invitation link is not valid. Enter the complete 32-character room code.');
  }

  async function api(action, payload = {}, options = {}) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'sb_publishable_AETE-41nmBUUSrYBEfjzoQ_GUFSaM3M' },
      body: JSON.stringify({ action, ...payload }),
      signal: options.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const messages = {
        RATE_LIMITED: 'Too many rooms created from this network. Try again later.',
        INVALID_INVITE: 'This invitation link is invalid. Ask the host for a fresh link.',
        ROOM_FULL: 'This room already has two participants.',
        ROOM_EXPIRED: 'This room has expired or has been ended.',
        INVALID_SESSION: 'Your room session is no longer valid. Please rejoin.',
        JOIN_FAILED: 'Could not join this room. Please try again.'
      };
      const err = new Error(messages[data.error] || data.message || (data.error ? 'Room API error: ' + data.error : 'The room service returned HTTP ' + response.status + '.'));
      err.status = response.status;
      err.code = data.error;
      throw err;
    }
    return data;
  }

  function buildInviteLink(session) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', session.room_code);
    url.searchParams.set('token', session.invite_token);
    return url.toString();
  }

  function saveSession(session) {
    currentSession = session;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    currentSession = null;
    sessionStorage.removeItem(SESSION_KEY);
    stopHeartbeat();
  }

  function stopHeartbeat() {
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  async function sendHeartbeat() {
    if (!currentSession || document.visibilityState === 'hidden') return;
    try {
      await api('heartbeat', {
        room_id: currentSession.room_id,
        participant_token: currentSession.participant_token
      });
      $('#room-connection-status').textContent = 'Room session active';
    } catch (err) {
      if (err.code === 'ROOM_EXPIRED' || err.code === 'INVALID_SESSION') {
        clearSession();
        showHome();
        notify(err.message, true);
      } else {
        $('#room-connection-status').textContent = 'Connection interrupted — retrying';
      }
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    sendHeartbeat();
    heartbeatTimer = window.setInterval(sendHeartbeat, HEARTBEAT_MS);
  }

  function showHome() {
    roomScreen.hidden = true;
    home.hidden = false;
    document.body.classList.remove('in-room');
  }

  function showRoom(session) {
    saveSession(session);
    home.hidden = true;
    roomScreen.hidden = false;
    document.body.classList.add('in-room');
    $('#room-code-display').textContent = session.room_code;
    $('#room-nickname').textContent = session.nickname || 'Guest';
    $('#room-role-label').textContent = session.slot === 1 ? 'Room host' : 'Invited guest';
    $('#room-invite-link').value = session.invite_token ? buildInviteLink(session) : 'Only the host can share the invitation link.';
    $('#room-invite-link').disabled = !session.invite_token;
    $('#room-connection-status').textContent = 'Room session active';
    $('#room-expiry').textContent = session.expires_at
      ? 'Room expires ' + new Date(session.expires_at).toLocaleString()
      : 'Temporary private room';
    startHeartbeat();
  }

  async function createRoom() {
    const data = await api('create');
    const session = {
      room_id: data.room_id,
      room_code: data.room_code,
      invite_token: data.invite_token,
      participant_token: data.participant_token,
      nickname: data.nickname,
      status: data.status,
      expires_at: data.expires_at,
      slot: 1
    };
    showRoom(session);
    notify('Private room created. Copy the invitation link to invite one person.');
  }

  async function joinRoom(inviteValue) {
    const invite = parseInvite(inviteValue);
    const data = await api('join', invite);
    const session = {
      room_id: data.room_id,
      room_code: data.room_code || invite.room_code,
      invite_token: invite.invite_token || data.invite_token || null,
      participant_token: data.participant_token,
      nickname: data.nickname,
      status: data.status || 'active',
      expires_at: data.expires_at || null,
      slot: data.slot || 2
    };
    showRoom(session);
    // Remove the invitation secret from the address bar after it has been exchanged
    // for this browser's participant token. It remains in sessionStorage only as needed
    // to let the host re-copy the link during this tab session.
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('token');
    cleanUrl.searchParams.delete('room');
    history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    notify('You joined the private room. Video calling will be added in the WebRTC phase.');
  }

  createButton.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try { await createRoom(); }
    catch (err) { notify(err.message, true); }
    finally { setBusy(false); }
  });

  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = inviteInput.value.trim();
    if (!value) {
      inviteInput.focus();
      notify('Enter the room code or paste the secure invitation link.', true);
      return;
    }
    openNickname('join', value);
  });

  continueButton.addEventListener('click', async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    error.textContent = '';
    try {
      dialog.close();
      if (intent === 'join') await joinRoom(dialog.dataset.invite || '');
      else await createRoom();
    } catch (err) {
      if (!dialog.open) dialog.showModal();
      error.textContent = err.message;
    } finally {
      setBusy(false);
    }
  });

  $('#copy-invite').addEventListener('click', async () => {
    const value = $('#room-invite-link').value;
    if (!value || value.startsWith('Only the host')) return;
    try {
      await navigator.clipboard.writeText(value);
      notify('Secure invitation link copied.');
    } catch {
      $('#room-invite-link').focus();
      $('#room-invite-link').select();
      notify('Clipboard unavailable. The link is selected — copy it manually.');
    }
  });

  $('#leave-room').addEventListener('click', async () => {
    if (!currentSession || busy) return;
    setBusy(true);
    stopHeartbeat();
    try {
      await api('leave', {
        room_id: currentSession.room_id,
        participant_token: currentSession.participant_token
      });
      clearSession();
      showHome();
      notify('Room ended. The invitation can no longer be used.');
    } catch (err) {
      if (err.code === 'INVALID_SESSION' || err.code === 'ROOM_EXPIRED') {
        clearSession();
        showHome();
      } else {
        startHeartbeat();
      }
      notify(err.message, true);
    } finally {
      setBusy(false);
    }
  });

  $('#back-home').addEventListener('click', () => {
    if (currentSession) notify('Use Leave room to securely end this session.');
    else showHome();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentSession) sendHeartbeat();
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  // Restore a tab-local session after refresh. The participant token never enters the URL.
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      const session = JSON.parse(saved);
      if (session.room_id && session.participant_token && session.room_code) {
        currentSession = session;
        showRoom(session);
      } else {
        clearSession();
      }
    }
  } catch {
    clearSession();
  }

  // A shared invitation opened directly in a fresh browser goes through the join dialog.
  const params = new URLSearchParams(window.location.search);
  if (params.has('room') || params.has('token')) {
    const invitation = window.location.href;
    showHome();
    openNickname('join', invitation);
  }
})();