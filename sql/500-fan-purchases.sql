-- 500: fan_purchases. Which recognised fans bought a ticket, joined from Cloudflare D1
-- ht-attribution (clicks x purchases) by the ticket-join Worker (workers/ticket-join), nightly.
--
-- The join, measured 4 Nov 2026 (docs/ticket-join.md):
--   purchases carry no session, GUID or device id. They carry the same ip_hash + ua_hash the
--   site's link tracking writes on every ticket click. A purchase joins to the latest click from
--   the same ip_hash + ua_hash in the 30 days before it; the click carries the Eloqua GUID and,
--   since 31 Oct, the pocket session id.
--
-- Holds no name, no email, no Ticketmaster order number. The D1 purchase id is the key back.
-- Retention: 90 days from purchase, the same rule as every other row that holds the GUID.

create table if not exists public.fan_purchases (
  purchase_id     bigint primary key,           -- D1 purchases.id
  eloqua_guid     text not null,                -- upper case, 32 hex
  session_id      text,                         -- pocket session id on the joined click, if any
  event_id        text,                         -- Ticketmaster event id
  inventory_type  text,                         -- primary | resale
  num_tickets     integer,
  order_total     numeric(10,2),
  purchased_at    timestamptz not null,
  clicked_at      timestamptz not null,         -- the joined click
  gap_minutes     integer not null,             -- purchased_at - clicked_at
  source_page     text,                         -- the page the ticket click came from
  matched_by      text not null default 'device_30d', -- ip_hash + ua_hash, click within 30 days
  confidence      text not null,                -- high: gap <= 60 min; medium: <= 24 h; low: longer
  loaded_at       timestamptz not null default now(),
  constraint fan_purchases_guid_shape check (eloqua_guid ~ '^[0-9A-F]{32}$')
);

create index if not exists fan_purchases_guid on public.fan_purchases (eloqua_guid, purchased_at desc);
create index if not exists fan_purchases_session on public.fan_purchases (session_id) where session_id is not null;

alter table public.fan_purchases enable row level security;
-- No policies: service key only. The Worker writes, the review and the fan record read.

-- Every purchase joined to one fan, newest first.
create or replace function public.fan_purchases(guid text)
returns table (
  purchase_id bigint, event_id text, inventory_type text, num_tickets integer,
  order_total numeric, purchased_at timestamptz, gap_minutes integer,
  source_page text, confidence text, session_id text
)
language sql stable security definer set search_path = public as $$
  select purchase_id, event_id, inventory_type, num_tickets, order_total, purchased_at,
         gap_minutes, source_page, confidence, session_id
  from public.fan_purchases
  where eloqua_guid = upper(guid)
  order by purchased_at desc;
$$;

revoke all on function public.fan_purchases(text) from public, anon, authenticated;
grant execute on function public.fan_purchases(text) to service_role;

-- 90-day prune, with the other feed prunes.
create or replace function public.fan_purchases_prune()
returns integer language sql security definer set search_path = public as $$
  with d as (delete from public.fan_purchases where purchased_at < now() - interval '90 days' returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.fan_purchases_prune() from public, anon, authenticated;

select cron.schedule('fan-purchases-prune', '50 8 * * *', $$select public.fan_purchases_prune()$$)
where exists (select 1 from pg_extension where extname = 'pg_cron')
  and not exists (select 1 from cron.job where jobname = 'fan-purchases-prune');
