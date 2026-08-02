import { beforeEach, expect, test } from "vitest";

import {
  FAVORITES_STORAGE_KEY,
  isFavoriteId,
  loadFavoriteIds,
  toggleFavoriteId,
} from "./favorites";

beforeEach(() => {
  localStorage.clear();
});

test("默认无收藏", () => {
  expect(loadFavoriteIds()).toEqual([]);
});

test("切换收藏会写入 localStorage", () => {
  const next = toggleFavoriteId(3);
  expect(next).toEqual([3]);
  expect(JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY)!)).toEqual([3]);
  expect(isFavoriteId(3, next)).toBe(true);
  const removed = toggleFavoriteId(3);
  expect(removed).toEqual([]);
});

test("损坏的 JSON 时回退为空数组", () => {
  localStorage.setItem(FAVORITES_STORAGE_KEY, "{not-json");
  expect(loadFavoriteIds()).toEqual([]);
});
