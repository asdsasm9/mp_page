-- Migration: Instagram profile avatar as its own uploaded file (WP-16, T-369). Follows 20261117090000_ig_profile.sql,
-- which is live and must never be edited.
--   * avatar_key text (null = no picture, initials show) replaces avatar_photo_id. The key names an R2 object
--     ig/avatar/<lowercase uuid>.webp outside photos/; check ig_profile_avatar_key_format equals the regex
--     IG_AVATAR_KEY_RE in packages/shared/src/keys.ts (isValidIgAvatarKey), so no path tricks and no photo keys.
--   * avatar_photo_id is dropped (its foreign key and index go with it). The live row's avatar choice is lost:
--     initials show until a picture is uploaded. No function references the column (delete_photos never did; the
--     old on delete set null foreign key did the clearing), so no function needs replacing.
--   * Grants: update is revoked and granted again for the seven editable columns (avatar_key instead of
--     avatar_photo_id); select grant and RLS policies are unchanged. anon still has nothing.
--   * Still NO bump_pending and NO log_change trigger; only set_updated_at from the earlier migration.
--   * Not applied live by the builder (H-1): the human applies it. Deploy order: Worker (additive), then this
--     migration, then admin.

alter table public.ig_profile add column avatar_key text;

alter table public.ig_profile add constraint ig_profile_avatar_key_format check (
  avatar_key is null
  or avatar_key ~ '^ig/avatar/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
);

alter table public.ig_profile drop column avatar_photo_id;

revoke update on table public.ig_profile from authenticated;
grant update (username, display_name, bio, link, followers_count, following_count, avatar_key)
  on table public.ig_profile to authenticated;
