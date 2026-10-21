-- Migration E6: T-205 server-side bounds for register_photo() inputs, so a direct RPC call cannot skip
-- what the Worker's zod schema checks. photos.alt (<= 300 chars) and photos.dominant_color
-- (^#[0-9a-f]{6}$) are already constrained in the catalog migration (photos_alt_length,
-- photos_dominant_color_format); legacy_key had no bound. Real keys look like
-- weddings/sedlakovi/44.jpg (at most about 50 characters), so 200 is generous.
alter table public.photos
  add constraint photos_legacy_key_format
  check (legacy_key is null or (char_length(legacy_key) between 1 and 200 and legacy_key ~ '^[A-Za-z0-9_./-]+$'));
