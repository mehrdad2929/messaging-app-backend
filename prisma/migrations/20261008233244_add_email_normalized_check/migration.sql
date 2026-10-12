-- Enforce that emails are stored pre-normalized (trimmed + lowercased).
-- App layer uses normalizeEmail(); this is the defense-in-depth net.
ALTER TABLE "User"
  ADD CONSTRAINT email_normalized
  CHECK (email = lower(trim(email)));
