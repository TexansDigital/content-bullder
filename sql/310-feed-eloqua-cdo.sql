-- 310: the writeback lands in an Eloqua custom data object (CDO), not on contact fields.
-- Decided by Adam, 4 Nov 2026: "We shouldn't use contact fields but use a CDO instead."
--
-- One CDO record per Eloqua contact, keyed by the contact id, linked to the contact. Two GUIDs
-- (two devices) that resolve to the same contact write one record: one view of the fan.
-- feed_eloqua_cdo_records remembers which CDO record belongs to which contact, so the nightly
-- pass updates that record instead of creating a second one.

create table if not exists public.feed_eloqua_cdo_records (
  contact_id   text        primary key,
  cdo_id       text        not null,
  instance_id  text        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.feed_eloqua_cdo_records enable row level security;
-- No anon policy: only the service key (the sync Worker) reads or writes this table.

alter table public.feed_eloqua_writes
  add column if not exists cdo_id text,
  add column if not exists instance_id text;

comment on table public.feed_eloqua_cdo_records is 'Which Eloqua CDO record holds the feed picks for which contact. Service key only.';
