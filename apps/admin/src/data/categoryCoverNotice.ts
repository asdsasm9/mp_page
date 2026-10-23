/**
 * "Výběr byl zrušen, protože fotka už není v kategorii": the database clears categories.cover_photo_id when the photo
 * is deleted or leaves the category. The screen that causes it (the album screen) is not the one that explains it, so
 * the cause is remembered here, per category, until the category screen has shown it once.
 */
const cleared = new Set<string>();

export function markCategoryCoverCleared(categoryId: string): void {
  cleared.add(categoryId);
}

/** True once for a category that was marked; the mark is consumed. */
export function takeCategoryCoverCleared(categoryId: string): boolean {
  return cleared.delete(categoryId);
}

/** Tests only. */
export function resetCategoryCoverNotices(): void {
  cleared.clear();
}
