# CloseCall — Private 1:1 room foundation

Mobile-first private room frontend using HTML, CSS, Vanilla JavaScript and a Supabase Edge Function.

## Implemented
- Create a private room through `closecall-api`.
- Join with a full invitation URL containing the room code and high-entropy invite token.
- Copy the secure invite link.
- Store the participant token in tab-scoped `sessionStorage`, never in the URL.
- Heartbeat every 45 seconds while the room is open, and immediately when the tab becomes visible.
- Leave securely; the backend ends the room and invalidates further joins.
- Restore the current tab's room session after refresh.
- Clear invite query parameters after a guest exchanges the invite for a participant session.
- Keep the current dark responsive landing page design.

## Supabase backend
The frontend calls:
`https://rpfnlkhcglewunflrarb.supabase.co/functions/v1/closecall-api`

Supported actions: `create`, `join`, `heartbeat`, `leave`.

The Edge Function uses the server-side service-role key. No service-role key or Supabase secret is included in this repository or browser code. The function currently has wildcard CORS; before production, restrict it to the final CloseCall website origin.

## Run
Serve the repository as a static site over HTTPS (or localhost during development). No build step is required.

## Important current limits
- This phase implements room lifecycle and participant authorization only.
- The room page explicitly indicates that camera, microphone, peer presence and WebRTC media are not yet active.
- There is no signaling or WebRTC connection in this commit. Do not treat the room session as a connected video call.
- Room activity heartbeat keeps the room alive; the backend's expiry and 30-minute inactivity checks remain authoritative.
- The host's Leave action ends the entire room. Guest leave also ends the room according to the current backend behavior.
- The UI asks for a confirmation word/name before continuing, but the backend assigns a generated temporary nickname; the entered text is not sent or used.

## Test checklist
1. Create a room and copy the invitation URL.
2. Open the URL in a second browser/device and join.
3. Confirm a third participant receives ROOM_FULL.
4. Refresh each tab and confirm its session restores.
5. Leave from either participant and confirm the other tab's next heartbeat reports the room ended.
6. Test on HTTPS and on mobile browsers.
