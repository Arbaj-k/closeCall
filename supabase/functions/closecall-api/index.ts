import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const randomHex = (n = 32) => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, "0")).join("");
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const randomRoomCode = () => [...crypto.getRandomValues(new Uint8Array(5))]
  .map(x => CODE_ALPHABET[x & 31]).join("");
const hash = async (value: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
};
const nick = () => {
  const a = ["Blue","Quiet","Swift","Lucky","Silver","Brave","Calm","Bright","Cosmic","Hidden"];
  const b = ["Falcon","Comet","Panda","Tiger","Otter","Fox","Raven","Koala","Wolf","Dolphin"];
  return a[crypto.getRandomValues(new Uint8Array(1))[0] % a.length] +
    b[crypto.getRandomValues(new Uint8Array(1))[0] % b.length] +
    String(10 + (crypto.getRandomValues(new Uint8Array(1))[0] % 90));
};
const valid = (s: unknown, max = 128): s is string => typeof s === "string" && s.length > 0 && s.length <= max;
const getIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown";

async function authenticate(roomId: unknown, token: unknown) {
  if (!valid(roomId, 64) || !valid(token, 128)) return null;
  const tokenHash = await hash(token);
  const { data: participant, error } = await db.from("closecall_participants")
    .select("id,room_id,slot,nickname,left_at,last_seen_at")
    .eq("room_id", roomId).eq("participant_token_hash", tokenHash)
    .is("left_at", null).maybeSingle();
  if (error || !participant) return null;
  const { data: room } = await db.from("closecall_rooms")
    .select("id,status,expires_at,last_activity_at")
    .eq("id", roomId).maybeSingle();
  if (!room || ["ended","expired"].includes(room.status) ||
      new Date(room.expires_at).getTime() <= Date.now() ||
      new Date(room.last_activity_at).getTime() <= Date.now() - 30 * 60 * 1000) return null;
  return { participant, room };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "create") {
      const ipHash = await hash(getIp(req));
      const { data: allowed, error: limitError } = await db.rpc("closecall_allow_create", { p_ip_hash: ipHash });
      if (limitError) throw limitError;
      if (!allowed) return reply({ error: "RATE_LIMITED" }, 429);
      const inviteToken = randomHex(32);
      const participantToken = randomHex(32);
      const nickname = nick();
      const now = new Date();
      const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      let room: { id: string; room_code: string } | null = null;
      let roomError: { code?: string; message?: string } | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const roomCode = randomRoomCode();
        const created = await db.from("closecall_rooms").insert({
          room_code: roomCode, invite_token_hash: await hash(inviteToken),
          status: "waiting", last_activity_at: now.toISOString(), expires_at: expires,
        }).select("id,room_code").single();
        if (!created.error) { room = created.data; roomError = null; break; }
        roomError = created.error;
        if (created.error.code !== "23505") break;
      }
      if (roomError || !room) throw roomError || new Error("ROOM_CREATE_FAILED");
      const { error: participantError } = await db.from("closecall_participants").insert({
        room_id: room.id, slot: 1, participant_token_hash: await hash(participantToken), nickname,
      });
      if (participantError) {
        await db.from("closecall_rooms").delete().eq("id", room.id);
        throw participantError;
      }
      return reply({ ok: true, room_code: room.room_code, room_id: room.id,
        invite_token: inviteToken, participant_token: participantToken,
        nickname, status: "waiting", expires_at: expires }, 201);
    }

    if (action === "join") {
      const ipHash = await hash(getIp(req));
      const { data: joinAllowed, error: joinLimitError } = await db.rpc("closecall_allow_join", { p_ip_hash: ipHash });
      if (joinLimitError) throw joinLimitError;
      if (!joinAllowed) return reply({ error: "JOIN_RATE_LIMITED" }, 429);
      if (!valid(body.room_code, 32)) return reply({ error: "INVALID_INVITE" }, 400);
      const roomCode = body.room_code.trim().toUpperCase();
      let inviteHash: string;
      if (valid(body.invite_token, 128)) inviteHash = await hash(body.invite_token);
      else if (/^([A-Z0-9]{5}|[A-Z0-9]{8}|[A-F0-9]{32})$/.test(roomCode)) {
        const { data: roomRecord, error: roomLookupError } = await db.from("closecall_rooms")
          .select("invite_token_hash").eq("room_code", roomCode).maybeSingle();
        if (roomLookupError || !roomRecord) return reply({ error: "INVALID_INVITE" }, 404);
        inviteHash = roomRecord.invite_token_hash;
      } else return reply({ error: "INVALID_INVITE" }, 400);

      const participantToken = randomHex(32);
      const nickname = nick();
      const { data, error } = await db.rpc("closecall_join_room", {
        p_room_code: roomCode, p_invite_hash: inviteHash,
        p_participant_hash: await hash(participantToken), p_nickname: nickname,
      });
      if (error) {
        const message = error.message || "";
        if (message.includes("ROOM_FULL")) return reply({ error: "ROOM_FULL" }, 409);
        if (message.includes("ROOM_EXPIRED")) return reply({ error: "ROOM_EXPIRED" }, 410);
        if (message.includes("INVALID_INVITE") || message.includes("ROOM_NOT_FOUND")) return reply({ error: "INVALID_INVITE" }, 404);
        return reply({ error: "JOIN_FAILED" }, 400);
      }
      return reply({ ok: true, ...data, invite_token: body.invite_token, participant_token });
    }

    if (action === "heartbeat" || action === "leave" || action === "status" ||
        action === "signal_send" || action === "signal_poll") {
      const auth = await authenticate(body.room_id, body.participant_token);
      if (!auth) return reply({ error: "ROOM_EXPIRED_OR_INVALID_SESSION" }, 401);
      const { participant, room } = auth;

      if (action === "heartbeat") {
        const now = new Date().toISOString();
        await db.from("closecall_participants").update({ last_seen_at: now }).eq("id", participant.id);
        await db.from("closecall_rooms").update({ last_activity_at: now, status: "active" }).eq("id", room.id);
        return reply({ ok: true, last_seen_at: now });
      }

      if (action === "leave") {
        const now = new Date().toISOString();
        await db.from("closecall_participants").update({ left_at: now, last_seen_at: now }).eq("id", participant.id);
        await db.from("closecall_rooms").update({ status: "ended", ended_at: now, last_activity_at: now }).eq("id", room.id);
        return reply({ ok: true, status: "ended" });
      }

      if (action === "status") {
        const { data: peers, error } = await db.from("closecall_participants")
          .select("slot,nickname,last_seen_at,left_at").eq("room_id", room.id).neq("id", participant.id);
        if (error) throw error;
        const peer = peers?.find(p => !p.left_at && p.last_seen_at &&
          new Date(p.last_seen_at).getTime() > Date.now() - 90000);
        return reply({ ok: true, slot: participant.slot, peer_online: !!peer,
          peer_nickname: peer?.nickname || null, room_status: room.status });
      }

      if (action === "signal_send") {
        const kind = body.signal_type;
        if (!["offer","answer","ice","hangup"].includes(kind)) return reply({ error: "INVALID_SIGNAL" }, 400);
        const payload = body.payload ?? {};
        const encoded = JSON.stringify(payload);
        if (encoded.length > 70000) return reply({ error: "SIGNAL_TOO_LARGE" }, 413);
        const { data: peer, error: peerError } = await db.from("closecall_participants")
          .select("id").eq("room_id", room.id).neq("id", participant.id)
          .is("left_at", null).maybeSingle();
        if (peerError || !peer) return reply({ error: "PEER_NOT_JOINED" }, 409);
        const { error } = await db.from("closecall_signals").insert({
          room_id: room.id, from_participant_id: participant.id,
          to_participant_id: peer.id, signal_type: kind, payload,
        });
        if (error) throw error;
        return reply({ ok: true });
      }

      if (action === "signal_poll") {
        const { data: signals, error } = await db.from("closecall_signals")
          .select("id,signal_type,payload,created_at,from_participant_id")
          .eq("room_id", room.id).eq("to_participant_id", participant.id)
          .is("consumed_at", null)
          .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
          .order("created_at", { ascending: true }).limit(40);
        if (error) throw error;
        if (signals?.length) {
          const ids = signals.map(s => s.id);
          await db.from("closecall_signals").update({ consumed_at: new Date().toISOString() }).in("id", ids);
        }
        return reply({ ok: true, signals: signals || [] });
      }
    }

    return reply({ error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error("closecall-api error", error);
    return reply({ error: "INTERNAL_ERROR" }, 500);
  }
});