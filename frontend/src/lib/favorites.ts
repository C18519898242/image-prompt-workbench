export const FAVORITES_STORAGE_KEY = "ipw.favorites";

export function loadFavoriteIds(): number[] {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is number =>
        typeof value === "number" && Number.isInteger(value),
    );
  } catch {
    return [];
  }
}

export function saveFavoriteIds(ids: number[]): void {
  localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(ids));
}

export function isFavoriteId(
  id: number,
  ids: number[] = loadFavoriteIds(),
): boolean {
  return ids.includes(id);
}

export function toggleFavoriteId(id: number): number[] {
  const current = loadFavoriteIds();
  const next = current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id];
  saveFavoriteIds(next);
  return next;
}
