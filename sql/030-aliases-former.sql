-- Former players, coaches and staff who appear in Shorts titles but are not on the current
-- roster. Full-name (tier 1) only: surname-only matching is reserved for the active roster.
-- Candidates came from a bigram scan of 36 months of Shorts titles. APPROVE BEFORE RUNNING.
-- Approved by Adam 31 Oct 2026 with Jimmie Ward struck (added to excluded_players instead).
-- The feed_reject_excluded trigger refuses anyone on excluded_players, so Joe Mixon et al.
-- fail loudly if someone adds them here by mistake.

insert into public.feed_entity_aliases (entity_type, entity_slug, alias, tier, source) values
('coach',  'demeco-ryans',   'demeco ryans',    1, 'former'),
('coach',  'demeco-ryans',   'coach ryans',     3, 'former'),
('staff',  'nick-caserio',   'nick caserio',    1, 'former'),
('staff',  'shelby-coppedge','shelby coppedge', 1, 'former'),
('player', 'j-j-watt',       'j.j. watt',       1, 'former'),
('player', 'j-j-watt',       'jj watt',         1, 'former'),
('player', 'andre-johnson',  'andre johnson',   1, 'former'),
('player', 'davis-mills',    'money mills',     3, 'former')
on conflict do nothing;
