# CloseCall — private 1:1 video calling

Mobile-first private 1:1 calling website using HTML, CSS, Vanilla JavaScript, WebRTC and Supabase Edge Functions.

## Implemented
- Create a private room and join with the 32-character room code or secure invitation URL.
- Server-generated temporary nicknames; maximum two participants per room.
- Participant tokens are kept in tab-scoped `sessionStorage`, never in the URL.
- Heartbeat, room status, expiry and leave-room handling.
- Camera and microphone permission flow using `getUserMedia()`.
- Peer-to-peer WebRTC using `RTCPeerConnection`, STUN-assisted ICE, SDP offer/answer and ICE candidate exchange.
- Local and remote video tiles, camera toggle, microphone mute and leave controls.
- Signaling messages are stored in a private database table and accessed only through the Edge Function after participant-token validation. The browser has no direct table access.
- Signal types are allow-listed and payloads are size-limited.

## Supabase
Project: `rpfnlkhcglewunflrarb`

Edge Function:
`https://rpfnlkhcglewunflrarb.supabase.co/functions/v1/closecall-api`

Supported actions: `create`, `join`, `heartbeat`, `leave`, `status`, `signal_send`, `signal_poll`.

The function uses the service-role key only in its server-side environment. Never add the service-role key to frontend code. The signaling table has RLS enabled and no anon/authenticated table grants; all signaling access is mediated by the function.

Migration source: `supabase/migrations/202611070001_closecall_webrtc_signaling.sql`.

## Run and test
Serve the site over HTTPS (or localhost for development). Camera/microphone access requires a secure context and user permission.

1. Open the site in two separate browsers/devices.
2. In the first browser, create a room and copy the 32-character room code.
3. In the second browser, enter that code and join.
4. In both browsers, click **Enable camera & microphone** and grant permissions.
5. Confirm local video appears in each browser and the other participant appears remotely.
6. Toggle camera and microphone, then leave the room and confirm the session ends.

## Network limitations
The current peer connection uses Google's public STUN service and does not include a TURN relay. STUN is enough for many home/mobile networks, but symmetric NATs, restrictive firewalls, VPNs and some carrier networks require TURN. In those cases, ICE may fail and a TURN service/credentials must be configured. Do not assume every network can connect until tested from two genuinely separate networks.

The frontend polls the private signaling endpoint rather than using Supabase Realtime. This avoids exposing an unauthenticated public signaling channel, at the cost of slightly higher signaling latency and database requests.

## Production hardening still recommended
- Replace wildcard Edge Function CORS with the final production website origin.
- Add a TURN relay and rotate its short-lived credentials.
- Add signaling cleanup for consumed/old rows (room cleanup cascades when rooms are deleted).
- Verify two-device calls on mobile Safari, Chrome Android, desktop Chrome/Firefox, restrictive NAT and mobile data.
- Consider a call reconnect/renegotiation flow for network changes and device switching.
