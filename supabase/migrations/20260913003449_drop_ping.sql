-- Stage 5: remove the walking skeleton's throwaway table.
--
-- Prohibition P8, "never leave a stub you replaced — deleted in the same commit as its
-- replacement". `ping` was created in Stage 2 carrying a `STUB (Stage 5)` comment, and
-- Stage 5 is now here: /portal and `profiles` replace it.
--
-- Dropping it rather than leaving it empty is the point. A disused table with RLS on it
-- is a thing every future audit has to look at and conclude is harmless, forever. Stage 6
-- audits every table in the schema; this is one fewer to explain.
--
-- The data is genuinely disposable: rows written by two hand-made test accounts saying
-- things like "hello". Nothing references it.

drop table if exists public.ping;
