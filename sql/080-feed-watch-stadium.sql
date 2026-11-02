-- The stadium is Reliant Stadium. The first "How do you watch?" answer was stored as 'nrg';
-- it is 'stadium' from here on, and any row that said 'nrg' says 'stadium'.
alter table public.feed_preferences drop constraint if exists feed_preferences_watch_check;
update public.feed_preferences set watch = 'stadium' where watch = 'nrg';
alter table public.feed_preferences add constraint feed_preferences_watch_check check (watch in ('stadium', 'home', 'go'));
update public.feed_boost_offers set blurb = 'Colts come to Reliant Stadium on Thursday night.', updated_at = now() where key = 'colts-week';
