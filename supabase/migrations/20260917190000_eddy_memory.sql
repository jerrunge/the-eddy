-- The Eddy remembers. Two tables, on his word 2026-09-17.
--
-- Until now the guide built every answer from the open episode and a few counts.
-- Nothing he said in an earlier episode reached it, and it could not see the
-- Harbor, so on 09-17 it steered him toward a conversation he had already struck
-- on 09-10. These two tables are the memory:
--
--   eddy_rules              what he holds, standing, in his own words where they
--                           exist. Scoped by name or topic so the guide quotes
--                           only what the moment touches.
--   eddy_episode_summaries  one row per closed loop: what it was, what he
--                           decided, what is still open, and the lines that read
--                           like a rule he stated, for his tap.
--
-- Laws that live in the shape: nothing here scores or assesses him (the 08-02
-- cut); the guide never invents a rule, so every row is his word or a shape he
-- ratified, and which one it is is recorded; retiring is a flag, never a delete,
-- because his own history is his.
--
-- RLS on with zero policies, matching every other eddy_ table: only the edge
-- functions' service role reaches them.

create table if not exists eddy_rules (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  scope       text[] not null default '{always}',
  text        text not null,
  his_words   boolean not null default false,
  source      text,
  active      boolean not null default true,
  retired_at  timestamptz
);

comment on table  eddy_rules is 'What Jeremy holds, standing. Read by eddy-guide on every ask whose words touch a scope.';
comment on column eddy_rules.scope is 'Names and topics this rule answers to, e.g. {David}. {always} rides on every ask.';
comment on column eddy_rules.his_words is 'true when the text is his own typed or spoken words; false when it is a shape he ratified in someone else words.';
comment on column eddy_rules.source is 'Where it came from: an eddy episode id, a desk_items id, a session, or "typed in the app".';

create index if not exists eddy_rules_active_idx on eddy_rules (active) where active;
create index if not exists eddy_rules_scope_idx on eddy_rules using gin (scope);

create table if not exists eddy_episode_summaries (
  episode_id       uuid primary key references eddy_episodes(id) on delete cascade,
  at               timestamptz not null default now(),
  summary          text not null,
  decisions        jsonb not null default '[]'::jsonb,
  open_threads     jsonb not null default '[]'::jsonb,
  rule_candidates  jsonb not null default '[]'::jsonb,
  model            text
);

comment on table  eddy_episode_summaries is 'One loop, remembered. Written by the eddy-guide summarize op when an episode closes.';
comment on column eddy_episode_summaries.rule_candidates is 'Lines that read as a rule he stated in the loop. Candidates only: nothing becomes a rule without his tap.';

alter table eddy_rules enable row level security;
alter table eddy_episode_summaries enable row level security;
