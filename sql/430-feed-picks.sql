-- 430: pick'em (approved by Adam 14 Nov 2026, "pick em approved").
--
-- One tap before each game: Texans or the opponent. The payoff is the split, on the spot
-- ("You and 78% of fans say Texans. Your pick is saved."). One row per fan per game, keyed by
-- the same pocket or device id as every other preference, latest call wins. No name, no email.
-- The Worker (workers/feed/src/app.js, POST /api/pick) is the only writer, with the service key;
-- qa loads are answered with the tally and never stored. The card shows from six days before
-- kickoff until kickoff, behind the pickem_position knob (-1 hides it; the pickem experiment
-- arm sets 2). Later, smallest widening: a "You called it" card after the final.

create table if not exists public.feed_picks (
  session_id text        not null,
  game_id    bigint      not null references public.texans_games(id),
  pick       text        not null check (pick in ('texans', 'opponent')),
  picked_at  timestamptz not null default now(),
  placement  text,
  primary key (session_id, game_id)
);
create index if not exists feed_picks_game_idx on public.feed_picks (game_id);
alter table public.feed_picks enable row level security;
-- No anon policy: only the service key (the Worker) reads or writes this table.
comment on table public.feed_picks is 'Pick''em: one call per fan per game (texans | opponent), keyed by pocket or device id. Service key only. No name, no email.';

-- How fans split on a game. Test and verification ids never count.
create or replace function public.feed_pick_tally(gid bigint)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'texans',   count(*) filter (where pick = 'texans'),
    'opponent', count(*) filter (where pick = 'opponent'))
  from public.feed_picks
  where game_id = gid and session_id !~* '(smoketest|armcheck|test)';
$$;
revoke execute on function public.feed_pick_tally(bigint) from anon, authenticated;
