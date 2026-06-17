-- SP4 security fix: apply_feedback must only run inside submit_outcome.
--
-- submit_outcome is SECURITY DEFINER (runs as the owner), so it can call apply_feedback
-- regardless of the caller's privileges — the 0012 grant to `authenticated` was unnecessary.
-- Worse, combined with Postgres's default EXECUTE-to-PUBLIC on new functions, any authenticated
-- member could call apply_feedback directly (combo_id is readable from their own rounds) and
-- nudge a combo's coherence outside gameplay, violating "coherence is never client-writable".
-- Revoke both so only the owner (i.e. the submit_outcome definer path) can execute it.
revoke execute on function public.apply_feedback(bigint, text, text) from authenticated;
revoke execute on function public.apply_feedback(bigint, text, text) from public;
