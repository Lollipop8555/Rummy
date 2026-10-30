/**
 * 可复现的伪随机数发生器（mulberry32）。
 *
 * 设计要点：
 * - 状态是单个 uint32，可完整序列化进存档，从而保证读档后的摸牌序列与
 *   崩溃前完全一致（见 docs/技术方案.md 7.5）。
 * - 仅 `core` 内部可见；`ai` 被 ESLint 禁止引用本模块，避免 AI 反推牌序。
 */

export type RngState = number;

const UINT32 = 0x100000000;

export function createRng(seed: number): RngState {
  // 归一化到 uint32，并避免 0 种子退化
  const normalized = Math.floor(Math.abs(seed)) % UINT32;
  return normalized >>> 0;
}

/** 返回 [0, 1) 的浮点数，同时推进状态 */
export function nextFloat(state: RngState): [number, RngState] {
  let a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / UINT32;
  // 推进后若回到 0 会导致退化，映射为非 0
  if (a === 0) {
    a = 0x9e3779b9;
  }
  return [value, a];
}

/** Fisher-Yates 洗牌，返回新数组与推进后的状态 */
export function shuffle<T>(
  items: readonly T[],
  state: RngState,
): [T[], RngState] {
  const result = items.slice();
  let rng = state;
  for (let i = result.length - 1; i > 0; i -= 1) {
    const [rand, nextState] = nextFloat(rng);
    rng = nextState;
    const j = Math.floor(rand * (i + 1));
    const atI = result[i];
    const atJ = result[j];
    if (atI === undefined || atJ === undefined) {
      continue;
    }
    result[i] = atJ;
    result[j] = atI;
  }
  return [result, rng];
}

/** 从数组中等概率取一个索引，返回索引与推进后的状态 */
export function pickIndex(
  length: number,
  state: RngState,
): [number, RngState] {
  const [rand, nextState] = nextFloat(state);
  return [Math.min(length - 1, Math.floor(rand * length)), nextState];
}
