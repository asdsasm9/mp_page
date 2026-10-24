/**
 * "Výběr byl zrušen, protože fotka byla smazána": the database clears site_settings.hero_photo_id when the photo is
 * deleted. The screen that causes it (album, photo detail) is not the one that explains it, so the cause is remembered
 * here until the "Úvodní stránka" screen has shown it once.
 */
let cleared = false;

export function markHeroPhotoCleared(): void {
  cleared = true;
}

/** True once after a mark; the mark is consumed. */
export function takeHeroPhotoCleared(): boolean {
  const was = cleared;
  cleared = false;
  return was;
}

/** Tests only. */
export function resetHeroPhotoNotice(): void {
  cleared = false;
}
