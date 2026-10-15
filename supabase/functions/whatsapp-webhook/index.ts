// Supabase Edge Function: WhatsApp Cloud API webhook (Warehouse plan).
// Stores each incoming message once (idempotent on the WhatsApp message id),
// then hands parsing to a queue so a burst of morning orders never blocks the webhook.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Meta's verification handshake
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.verify_token') === Deno.env.get('WA_VERIFY_TOKEN');
    return new Response(ok ? url.searchParams.get('hub.challenge') : 'forbidden', { status: ok ? 200 : 403 });
  }

  const payload = await req.json();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const phoneId: string = change.value?.metadata?.phone_number_id;
      const { data: biz } = await admin.from('businesses').select('id').eq('wa_phone_id', phoneId).maybeSingle();
      if (!biz) continue;
      for (const m of change.value?.messages ?? []) {
        const { data: party } = await admin.from('parties').select('id').eq('business_id', biz.id).eq('phone', `+${m.from}`).maybeSingle();
        const channel = m.type === 'audio' ? 'voice' : m.type === 'image' ? 'photo' : 'text';
        const { data: row } = await admin.from('messages').upsert({
          business_id: biz.id,
          party_id: party?.id ?? null,
          channel,
          body: m.text?.body ?? null,
          media_path: m.audio?.id ?? m.image?.id ?? null,  // fetched and transcribed by the worker
          wa_message_id: m.id,
        }, { onConflict: 'wa_message_id', ignoreDuplicates: true }).select('id').maybeSingle();
        // Queue the parse (pgmq); the worker transcribes voice/photo first, then calls parse-order.
        if (row) await admin.rpc('pgmq_send', { queue_name: 'parse', msg: { message_id: row.id } });
      }
    }
  }
  return new Response('ok');
});
