/* CloseCall: authenticated room lifecycle + peer-to-peer WebRTC media. */
(() => {
  'use strict';
  const API_URL = 'https://rpfnlkhcglewunflrarb.supabase.co/functions/v1/closecall-api';
  const API_KEY = 'sb_publishable_AETE-41nmBUUSrYBEfjzoQ_GUFSaM3M';
  const SESSION_KEY = 'closecall.session.v1';
  const HEARTBEAT_MS = 45000, SIGNAL_POLL_MS = 900, STATUS_POLL_MS = 2500;
  const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ];
  let ICE_SERVERS = STUN_SERVERS;
  let iceConfigPromise = null;
  async function loadIceServers() {
    if (iceConfigPromise) return iceConfigPromise;
    iceConfigPromise = (async () => {
      try {
        const data = await api('turn_credentials');
        const servers = data.iceServers;
        if (!Array.isArray(servers) || !servers.length ||
            !servers.some(server => {
              const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
              return urls.some(url => typeof url === 'string' && /^turns?:/i.test(url));
            })) throw new Error('TURN credential response did not include a TURN server.');
        ICE_SERVERS = [...servers, ...STUN_SERVERS];
        console.info('CloseCall: TURN relay configuration loaded securely.');
        return ICE_SERVERS;
      } catch (err) {
        console.error('CloseCall TURN setup unavailable; using STUN fallback:', err);
        notify('TURN relay could not be loaded. Trying a direct connection instead.', true);
        return STUN_SERVERS;
      }
    })();
    return iceConfigPromise;
  }
  const $ = s => document.querySelector(s);
  const createButton = $('#create-room'), joinForm = $('#join-form'), inviteInput = $('#invite-link');
  const dialog = $('#nickname-dialog'), continueButton = $('#continue-room'), error = $('#modal-error');
  const toast = $('#toast'), home = $('#home-view'), roomScreen = $('#room-screen'), year = $('#year');
  let intent = 'create', busy = false, currentSession = null;
  let heartbeatTimer = null, signalTimer = null, statusTimer = null;
  let localStream = null, peerConnection = null, remoteStream = null;
  let offerStarted = false, makingOffer = false, signalBusy = false, statusBusy = false;
  let queuedIce = [], pendingOffer = null;

  if (year) year.textContent = new Date().getFullYear();
  function notify(message, isError = false) {
    toast.textContent = message; toast.classList.toggle('toast-error', isError); toast.classList.add('show');
    clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove('show'), 3600);
  }
  function setBusy(value) {
    busy = value; createButton.disabled = value; continueButton.disabled = value;
    joinForm.querySelector('button').disabled = value;
    continueButton.textContent = value ? 'Please wait…' : 'Continue →';
  }
  function openNickname(nextIntent, invite = '') {
    intent = nextIntent; dialog.dataset.invite = invite; error.textContent = '';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else notify('Please use an updated browser.', true);
  }
  function parseInvite(value) {
    const raw = value.trim();
    if (!raw) throw new Error('Enter your 5-character room code or paste the invitation link.');
    const directCode = raw.replace(/[\s-]/g, '').toUpperCase();
    if (/^[A-Z0-9]{5}$/.test(directCode) || /^[A-F0-9]{32}$/.test(directCode) || /^[A-Z0-9]{8}$/.test(directCode)) return { room_code: directCode };
    let url;
    try { url = new URL(raw, window.location.href); } catch { throw new Error('That invitation link is not valid.'); }
    const roomCode = (url.searchParams.get('room') || '').trim().toUpperCase();
    const inviteToken = (url.searchParams.get('token') || '').trim();
    if ((/^[A-Z0-9]{5}$/.test(roomCode) || /^[A-F0-9]{32}$/.test(roomCode) || /^[A-Z0-9]{8}$/.test(roomCode)) && !inviteToken) return { room_code: roomCode };
    if ((/^[A-Z0-9]{5}$/.test(roomCode) || /^[A-Z0-9]{8}$/.test(roomCode)) && /^[a-f0-9]{64}$/i.test(inviteToken)) return { room_code: roomCode, invite_token: inviteToken };
    throw new Error('That code or invitation link is not valid.');
  }
  async function api(action, payload = {}) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: API_KEY },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const messages = {
        RATE_LIMITED: 'Too many rooms created from this network. Try again later.',
        JOIN_RATE_LIMITED: 'Too many join attempts from this network. Wait 15 minutes and try again.',
        INVALID_INVITE: 'This room code or invitation is invalid.',
        ROOM_FULL: 'This room already has two participants.',
        ROOM_EXPIRED: 'This room has expired or ended.',
        INVALID_SESSION: 'Your room session is no longer valid. Please rejoin.',
        ROOM_EXPIRED_OR_INVALID_SESSION: 'This room has expired or your session is invalid. Please rejoin.',
        PEER_NOT_JOINED: 'The other participant has not joined yet.',
        SIGNAL_TOO_LARGE: 'The call signaling message was too large.'
      };
      const e = new Error(messages[data.error] || data.message || ('Room service error: ' + (data.error || response.status)));
      e.code = data.error; e.status = response.status; throw e;
    }
    return data;
  }
  function buildInviteLink(session) {
    const url = new URL(window.location.href); url.search = ''; url.hash = '';
    url.searchParams.set('room', session.room_code);
    if (session.invite_token) url.searchParams.set('token', session.invite_token);
    return url.toString();
  }
  function saveSession(session) { currentSession = session; sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
  function stopTimers() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (signalTimer) clearInterval(signalTimer);
    if (statusTimer) clearInterval(statusTimer);
    heartbeatTimer = signalTimer = statusTimer = null;
  }
  function stopMedia() {
    if (peerConnection) { peerConnection.ontrack = null; peerConnection.onicecandidate = null; peerConnection.close(); }
    peerConnection = null;
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    localStream = null; remoteStream = null; queuedIce = []; pendingOffer = null; offerStarted = false; makingOffer = false;
    const localVideo = $('#local-video'), remoteVideo = $('#remote-video');
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    $('#local-placeholder').hidden = false;
    $('#remote-placeholder').hidden = false;
    $('#camera-toggle').textContent = '▣'; $('#camera-toggle').title = 'Turn camera off';
    $('#mic-toggle').textContent = '♩'; $('#mic-toggle').title = 'Mute microphone';
    $('#start-call').disabled = false;
    $('#start-call').textContent = 'Enable camera & microphone';
    $('#camera-toggle').disabled = true; $('#mic-toggle').disabled = true; $('#switch-camera').disabled = true; document.body.classList.remove('call-active');
  }
  function clearSession() {
    stopTimers(); stopMedia(); currentSession = null; sessionStorage.removeItem(SESSION_KEY);
  }
  function showHome() { roomScreen.hidden = true; home.hidden = false; document.body.classList.remove('in-room','call-active'); }
  function setCallStatus(message) { $('#call-status').textContent = message; }
  function showRoom(session) {
    saveSession(session); home.hidden = true; roomScreen.hidden = false; document.body.classList.add('in-room'); document.body.classList.remove('call-active');
    $('#room-code-display').textContent = session.room_code;
    $('#room-nickname').textContent = session.nickname || 'Guest';
    $('#room-role-label').textContent = session.slot === 1 ? 'Room host' : 'Invited guest';
    $('#room-invite-link').value = session.invite_token ? buildInviteLink(session) : 'Only the host can share the invitation link.';
    $('#room-invite-link').disabled = !session.invite_token;
    $('#room-connection-status').textContent = 'Room session active';
    $('#room-expiry').textContent = session.expires_at ? 'Room expires ' + new Date(session.expires_at).toLocaleString() : 'Temporary private room';
    setCallStatus('Waiting for the other person to join');
    startRoomLoops();
  }
  async function createRoom() {
    const d = await api('create');
    showRoom({ room_id:d.room_id, room_code:d.room_code, invite_token:d.invite_token,
      participant_token:d.participant_token, nickname:d.nickname, status:d.status, expires_at:d.expires_at, slot:1 });
    notify('Room created. Share the code or secure invite link.');
  }
  async function joinRoom(value) {
    const invite = parseInvite(value), d = await api('join', invite);
    const session = { room_id:d.room_id, room_code:d.room_code || invite.room_code,
      invite_token:invite.invite_token || d.invite_token || null, participant_token:d.participant_token,
      nickname:d.nickname, status:d.status || 'active', expires_at:d.expires_at || null, slot:d.slot || 2 };
    showRoom(session);
    const clean = new URL(window.location.href); clean.searchParams.delete('token'); clean.searchParams.delete('room');
    history.replaceState({}, '', clean.pathname + clean.search + clean.hash);
    notify('Joined the private room. Enable camera and microphone to start.');
  }
  function sessionPayload() { return { room_id:currentSession.room_id, participant_token:currentSession.participant_token }; }
  async function heartbeat() {
    if (!currentSession || document.visibilityState === 'hidden') return;
    try { await api('heartbeat', sessionPayload()); $('#room-connection-status').textContent = 'Room session active'; }
    catch (e) { clearSession(); showHome(); notify(e.message, true); }
  }
  async function checkPeer() {
    if (!currentSession || statusBusy) return;
    statusBusy = true;
    try {
      const d = await api('status', sessionPayload());
      if (d.peer_online) {
        $('#peer-name').textContent = d.peer_nickname || 'Guest';
        $('#peer-state').textContent = 'Participant connected';
        if (localStream && currentSession.slot === 1 && !offerStarted && !makingOffer) await createOffer();
        if (localStream && currentSession.slot === 2 && !peerConnection) await createPeerConnection();
        if (!localStream) setCallStatus('The other person is here. Enable camera and microphone to begin.');
      } else {
        $('#peer-name').textContent = 'Waiting for guest';
        $('#peer-state').textContent = 'Waiting for the other participant';
        if (!localStream) setCallStatus('Share your room code and wait for the other person.');
      }
    } catch (e) {
      if (e.code === 'ROOM_EXPIRED_OR_INVALID_SESSION') { clearSession(); showHome(); notify(e.message, true); }
    } finally { statusBusy = false; }
  }
  async function sendSignal(type, payload) {
    if (!currentSession) return;
    await api('signal_send', { ...sessionPayload(), signal_type:type, payload });
  }
  async function createPeerConnection() {
    if (peerConnection) return peerConnection;
    const iceServers = await loadIceServers();
    peerConnection = new RTCPeerConnection({ iceServers, iceTransportPolicy:'all' });
    if (localStream) localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    peerConnection.onicecandidate = event => {
      if (event.candidate) sendSignal('ice', event.candidate.toJSON()).catch(e => notify('Network candidate could not be sent: ' + e.message, true));
    };
    peerConnection.ontrack = event => {
      if (!remoteStream) remoteStream = new MediaStream();
      if (!remoteStream.getTracks().some(t => t.id === event.track.id)) remoteStream.addTrack(event.track);
      $('#remote-video').srcObject = remoteStream;
      $('#remote-placeholder').hidden = true;
      document.body.classList.add('call-active');
      $('#remote-video').play().catch(() => {});
      setCallStatus('Live connection established');
    };
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection?.connectionState;
      if (state === 'connected') { setCallStatus('Connected securely peer-to-peer'); document.body.classList.add('call-active'); }
      else if (state === 'connecting') setCallStatus('Connecting video and audio…');
      else if (state === 'failed') setCallStatus('Direct connection failed. This network may require a TURN relay.');
      else if (state === 'disconnected') setCallStatus('Connection interrupted — trying to reconnect');
      else if (state === 'closed') setCallStatus('Call ended');
    };
    return peerConnection;
  }
  async function drainIce() {
    if (!peerConnection?.remoteDescription) return;
    const pending = queuedIce; queuedIce = [];
    for (const candidate of pending) {
      try { await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.warn('ICE candidate rejected', e); }
    }
  }
  async function createOffer() {
    if (!localStream || currentSession.slot !== 1 || offerStarted || makingOffer) return;
    makingOffer = true;
    try {
      const pc = await createPeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal('offer', { type:pc.localDescription.type, sdp:pc.localDescription.sdp });
      offerStarted = true; setCallStatus('Calling the other participant…');
    } catch (e) { notify('Could not start the call: ' + e.message, true); }
    finally { makingOffer = false; }
  }
  async function handleSignal(signal) {
    if (signal.signal_type === 'hangup') { stopMedia(); setCallStatus('The other participant ended the call.'); return; }
    if (signal.signal_type === 'ice') {
      if (!peerConnection?.remoteDescription) queuedIce.push(signal.payload);
      else {
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(signal.payload)); }
        catch (e) { console.warn('ICE candidate rejected', e); }
      }
      return;
    }
    if (signal.signal_type === 'offer' && currentSession.slot === 2) {
      // Do not answer an offer until local media exists; otherwise the answer
      // has no audio/video transceivers and the remote video can never arrive.
      if (!localStream) { pendingOffer = signal; setCallStatus('Offer received. Enable camera & microphone to connect.'); return; }
      const pc = await createPeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
      await drainIce();
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      await sendSignal('answer', { type:pc.localDescription.type, sdp:pc.localDescription.sdp });
      setCallStatus('Answer sent. Connecting…'); return;
    }
    if (signal.signal_type === 'answer' && currentSession.slot === 1 && peerConnection) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.payload));
      await drainIce(); setCallStatus('Answer received. Connecting…');
    }
  }
  async function pollSignals() {
    if (!currentSession || signalBusy) return;
    signalBusy = true;
    try {
      const d = await api('signal_poll', sessionPayload());
      for (const signal of d.signals || []) await handleSignal(signal);
    } catch (e) {
      if (e.code === 'ROOM_EXPIRED_OR_INVALID_SESSION') { clearSession(); showHome(); notify(e.message, true); }
      else console.warn('Signal polling failed', e);
    } finally { signalBusy = false; }
  }
  function startRoomLoops() {
    stopTimers(); heartbeat(); checkPeer(); pollSignals();
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
    statusTimer = setInterval(checkPeer, STATUS_POLL_MS);
    signalTimer = setInterval(pollSignals, SIGNAL_POLL_MS);
  }
  async function switchCamera() {
    if (!localStream) return;
    const currentTrack = localStream.getVideoTracks()[0];
    if (!currentTrack) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(device => device.kind === 'videoinput');
    if (cameras.length < 2) { notify('Only one camera is available on this device.', true); return; }
    const currentId = currentTrack.getSettings().deviceId;
    const currentIndex = cameras.findIndex(device => device.deviceId === currentId);
    const nextCamera = cameras[(currentIndex + 1 + cameras.length) % cameras.length];
    const nextStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: nextCamera.deviceId ? { deviceId: { exact: nextCamera.deviceId } } :
        { facingMode: currentTrack.getSettings().facingMode === 'environment' ? 'user' : 'environment' }
    });
    const nextTrack = nextStream.getVideoTracks()[0];
    try {
      const sender = peerConnection?.getSenders().find(item => item.track?.kind === 'video');
      if (sender) await sender.replaceTrack(nextTrack);
      const oldStream = localStream;
      oldStream.removeTrack(currentTrack);
      oldStream.addTrack(nextTrack);
      $('#local-video').srcObject = localStream;
      currentTrack.stop();
      nextStream.getTracks().filter(track => track !== nextTrack).forEach(track => track.stop());
      notify('Camera switched.');
    } catch (err) {
      nextStream.getTracks().forEach(track => track.stop());
      notify('Could not switch camera: ' + err.message, true);
    }
  }
  async function startCall() {
    if (!currentSession || localStream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      notify('Camera access requires HTTPS and a supported browser.', true); return;
    }
    $('#start-call').disabled = true; $('#start-call').textContent = 'Requesting permission…';
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:{ facingMode:'user', width:{ideal:1280}, height:{ideal:720} } });
      $('#local-video').srcObject = localStream;
      $('#local-placeholder').hidden = true;
      $('#camera-toggle').disabled = false; $('#mic-toggle').disabled = false; $('#switch-camera').disabled = false;
      $('#camera-toggle').textContent = 'Turn camera off';
      $('#mic-toggle').textContent = 'Mute microphone';
      if (currentSession.slot === 2) await createPeerConnection();
      if (currentSession.slot === 2 && pendingOffer) {
        const offer = pendingOffer; pendingOffer = null;
        await handleSignal(offer);
      }
      await checkPeer();
      setCallStatus('Camera and microphone ready. Waiting for peer connection…');
      notify('Camera and microphone enabled.');
    } catch (e) {
      localStream = null; $('#start-call').disabled = false; $('#start-call').textContent = 'Enable camera & microphone';
      const message = e.name === 'NotAllowedError' ? 'Camera or microphone permission was denied. Allow access in browser settings.' :
        e.name === 'NotFoundError' ? 'No camera or microphone was found on this device.' : e.message;
      notify(message, true);
    }
  }
  async function leaveRoom() {
    if (!currentSession || busy) return;
    setBusy(true);
    try {
      if (peerConnection?.connectionState === 'connected') await sendSignal('hangup', {});
      await api('leave', sessionPayload());
      clearSession(); showHome(); notify('Room ended for everyone.');
    } catch (e) {
      if (e.code === 'ROOM_EXPIRED_OR_INVALID_SESSION') { clearSession(); showHome(); }
      else { notify(e.message, true); startRoomLoops(); }
    } finally { setBusy(false); }
  }

  createButton.addEventListener('click', async () => {
    if (busy) return; setBusy(true);
    try { await createRoom(); } catch (e) { notify(e.message, true); } finally { setBusy(false); }
  });
  joinForm.addEventListener('submit', e => {
    e.preventDefault(); const v = inviteInput.value.trim();
    if (!v) { inviteInput.focus(); notify('Enter the room code or invitation link.', true); return; }
    openNickname('join', v);
  });
  continueButton.addEventListener('click', async e => {
    e.preventDefault(); if (busy) return; setBusy(true); error.textContent = '';
    try { dialog.close(); if (intent === 'join') await joinRoom(dialog.dataset.invite || ''); else await createRoom(); }
    catch (err) { if (!dialog.open) dialog.showModal(); error.textContent = err.message; }
    finally { setBusy(false); }
  });
  $('#start-call').addEventListener('click', startCall);
  $('#switch-camera').addEventListener('click', () => switchCamera().catch(e => notify('Camera switch failed: ' + e.message, true)));
  $('#camera-toggle').addEventListener('click', () => {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0]; if (!track) return;
    track.enabled = !track.enabled; $('#camera-toggle').textContent = '▣'; $('#camera-toggle').title = track.enabled ? 'Turn camera off' : 'Turn camera on'; $('#camera-toggle').setAttribute('aria-label', $('#camera-toggle').title);
  });
  $('#mic-toggle').addEventListener('click', () => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0]; if (!track) return;
    track.enabled = !track.enabled; $('#mic-toggle').textContent = '♩'; $('#mic-toggle').title = track.enabled ? 'Mute microphone' : 'Unmute microphone'; $('#mic-toggle').setAttribute('aria-label', $('#mic-toggle').title);
  });
  $('#copy-code').addEventListener('click', async () => {
    const code = $('#room-code-display').textContent.trim();
    try { await navigator.clipboard.writeText(code); notify('Room code copied.'); }
    catch { notify('Could not copy automatically. Select the code and copy it.', true); }
  });
  $('#copy-invite').addEventListener('click', async () => {
    const v = $('#room-invite-link').value; if (!v || v.startsWith('Only the host')) return;
    try { await navigator.clipboard.writeText(v); notify('Secure invitation link copied.'); }
    catch { $('#room-invite-link').focus(); $('#room-invite-link').select(); notify('Link selected — copy it manually.'); }
  });
  $('#leave-room').addEventListener('click', leaveRoom);
  $('#back-home').addEventListener('click', () => notify('Use Leave room to securely end this session.'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && currentSession) heartbeat(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (saved?.room_id && saved?.participant_token && saved?.room_code) showRoom(saved);
  } catch { sessionStorage.removeItem(SESSION_KEY); }
  const params = new URLSearchParams(location.search);
  if (params.has('room') || params.has('token')) { const invitation = location.href; showHome(); openNickname('join', invitation); }
})();