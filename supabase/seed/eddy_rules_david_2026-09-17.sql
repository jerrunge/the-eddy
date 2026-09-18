-- The David rules: the seed for eddy_rules, on his word 2026-09-17.
--
-- Every row is either his own typed words (his_words true, quoted exactly as he
-- typed them in the Eddy) or the shape he ratified on 09-10 with "Put it in the
-- Harbor" (his_words false, with the source named). Nothing here was invented
-- for him. The cadence question from the same session is deliberately NOT here:
-- he never chose it, so it is not a rule.
--
-- Apply after 20260917190000_eddy_memory.sql, on his word.

insert into eddy_rules (id, at, scope, text, his_words, source, active) values (
  'e0d0d001-0000-4000-8000-000000000001', '2026-09-09T14:44:29Z', array['David'],
  'I need to move to a friend and supporter of his without the intimate attachment',
  true, 'eddy_entries, episode ce1c1010, 09-09 7:44am PT (typed in the Eddy)', true
) on conflict (id) do nothing;

insert into eddy_rules (id, at, scope, text, his_words, source, active) values (
  'e0d0d001-0000-4000-8000-000000000002', '2026-09-09T14:45:12Z', array['David'],
  'I need to stop sending him sexual pictures of myself, sexual asks of him, sexual texts about me. I also need to stop sending messages of wanting to hold him and comfort him sadly.',
  true, 'eddy_entries, episode ce1c1010, 09-09 7:45am PT (typed in the Eddy)', true
) on conflict (id) do nothing;

insert into eddy_rules (id, at, scope, text, his_words, source, active) values (
  'e0d0d001-0000-4000-8000-000000000003', '2026-09-10T21:24:36Z', array['David'],
  'Lover when you are in the same room with David, friend and supporter between rooms. Nothing sexual over the phone from you. Lover is a place, not a channel: it does not travel home as pics and asks, because the phone is where he goes quiet.',
  false, 'desk_items a7fc554a (the Harbor, David box), the shape he ratified 09-10 with "Put it in the Harbor"', true
) on conflict (id) do nothing;

insert into eddy_rules (id, at, scope, text, his_words, source, active) values (
  'e0d0d001-0000-4000-8000-000000000004', '2026-09-10T21:24:37Z', array['David'],
  'This is your adjustment to make, and it needs nothing from David: no honest conversation, no announcement, no agreement. Your words, 09-10: "I don''t think #7 is necessary...it is my adjustment, not his."',
  false, 'the 09-10 session, striking the proposed one honest conversation with David (item 7); his own words quoted inside', true
) on conflict (id) do nothing;

insert into eddy_rules (id, at, scope, text, his_words, source, active) values (
  'e0d0d001-0000-4000-8000-000000000005', '2026-09-10T21:24:38Z', array['David'],
  'The send test, before anything goes to David: does this need him to respond a certain way for me to feel okay? If yes, it waits. If you could get silence back and still be standing, send it.',
  false, 'desk_items a7fc554a (the Harbor, David box), item 3 of the ratified shape', true
) on conflict (id) do nothing;

insert into eddy_rules (id, at, scope, text, his_words, source, active) values (
  'e0d0d001-0000-4000-8000-000000000006', '2026-09-10T21:24:39Z', array['David'],
  'The surveillance is the real freedom cost and it is yours alone to drop: location checks, the old videos, his replies to other men. Nothing to tell him.',
  false, 'desk_items a7fc554a (the Harbor, David box), item 4 of the ratified shape', true
) on conflict (id) do nothing;
