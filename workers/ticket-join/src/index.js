// ticket-join Worker. One job: every night, join the last LOOKBACK_DAYS of D1 purchases to the
// latest ticket click from the same ip_hash + ua_hash in the 30 days before, keep the ones whose
// click carries an Eloqua GUID, and upsert them into Supabase fan_purchases.
//
// Never reads or writes a name, an email or a Ticketmaster order number.
// Secret: SUPABASE_SERVICE_KEY (npx wrangler secret put SUPABASE_SERVICE_KEY --name ticket-join).

const ADAM_SESSION = 'sess_1786805317298_00hak59zn';
const TEST_SESSION = /smoketest|armcheck|test/i;
const GUID = /^[0-9A-F]{32}$/;

export const JOIN_SQL = `
WITH p AS (
  SELECT id, event_id, inventory_type, num_tickets, order_total, ip_hash, ua_hash, created_at
  FROM purchases WHERE created_at >= datetime('now', ?1)
),
c AS (
  SELECT p.id pid, k.eloqua_guid, k.session_id, k.source_page, k.created_at clicked_at,
         ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY k.created_at DESC) rn
  FROM p JOIN clicks k
    ON k.ip_hash = p.ip_hash AND k.ua_hash = p.ua_hash
   AND k.created_at <= p.created_at AND k.created_at >= datetime(p.created_at, '-30 days')
   AND coalesce(k.eloqua_guid, '') <> ''
)
SELECT p.id purchase_id, upper(c.eloqua_guid) eloqua_guid, c.session_id, p.event_id,
       lower(p.inventory_type) inventory_type, p.num_tickets, p.order_total,
       p.created_at purchased_at, c.clicked_at, c.source_page,
       CAST(round((julianday(p.created_at) - julianday(c.clicked_at)) * 1440) AS INTEGER) gap_minutes
FROM p JOIN c ON c.pid = p.id AND c.rn = 1`;

export function confidence(gap) {
  if (gap <= 60) return 'high';
  if (gap <= 1440) return 'medium';
  return 'low';
}

export function toRows(results) {
  const out = [];
  for (const r of results) {
    const sid = r.session_id || null;
    if (sid && (sid === ADAM_SESSION || TEST_SESSION.test(sid))) continue;
    if (!GUID.test(r.eloqua_guid || '')) continue;
    out.push({
      purchase_id: r.purchase_id,
      eloqua_guid: r.eloqua_guid,
      session_id: sid,
      event_id: r.event_id || null,
      inventory_type: r.inventory_type || null,
      num_tickets: r.num_tickets ?? null,
      order_total: r.order_total ?? null,
      purchased_at: r.purchased_at.replace(' ', 'T') + 'Z',
      clicked_at: r.clicked_at.replace(' ', 'T') + 'Z',
      gap_minutes: r.gap_minutes,
      source_page: r.source_page || null,
      matched_by: 'device_30d',
      confidence: confidence(r.gap_minutes),
    });
  }
  return out;
}

export async function run(env) {
  const days = Number(env.LOOKBACK_DAYS || 3);
  const { results } = await env.DB.prepare(JOIN_SQL).bind(`-${days} days`).all();
  const rows = toRows(results);
  const total = await env.DB.prepare(
    "SELECT count(*) n FROM purchases WHERE created_at >= datetime('now', ?1)"
  ).bind(`-${days} days`).first('n');
  if (rows.length) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/fan_purchases?on_conflict=purchase_id`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`fan_purchases upsert ${res.status}: ${await res.text()}`);
  }
  return { purchases: total, joined: rows.length };
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env).then((r) => console.log('ticket-join', JSON.stringify(r))));
  },
};
