/**
 * 对局存档：落盘 / 读档 / 版本兼容 / 损坏降级。
 *
 * 关键约束（docs/技术方案.md 7.5）：
 * - 存完整 GameState（含 RNG 状态、AI 强度快照），保证读档后序列一致。
 * - 写入时机为「动作之后」，不做节流，否则会丢失最后一个动作。
 * - 带版本号，不兼容时直接丢弃并提示，宁可少一次续玩也不要读到错乱牌局。
 * - 读档校验牌数守恒（54 张），损坏即丢弃。
 */

import { DECK_SIZE } from '../core/cards';
import { ENGINE_VERSION, type GameState } from '../core/engine';
import { readJson, removeRaw, writeJson } from './storage';

const SAVE_KEY = 'rummy.save.v1';

export type SaveEnvelope = {
  readonly version: number;
  readonly savedAt: number;
  readonly state: GameState;
};

export type LoadResult =
  | { readonly kind: 'ok'; readonly state: GameState }
  | { readonly kind: 'empty' }
  | { readonly kind: 'incompatible'; readonly reason: string }
  | { readonly kind: 'corrupt'; readonly reason: string };

/** 牌数守恒校验：牌堆 + 弃牌堆 + 双方手牌 + 桌面组合中的牌 = 54 */
export function countAllCards(state: GameState): number {
  const onTable = state.table.reduce(
    (sum, item) => sum + item.meld.slots.length,
    0,
  );
  return (
    state.deck.length +
    state.discard.length +
    state.hands.player.length +
    state.hands.ai.length +
    onTable
  );
}

export function saveGame(state: GameState): void {
  const envelope: SaveEnvelope = {
    version: ENGINE_VERSION,
    savedAt: Date.now(),
    state,
  };
  writeJson(SAVE_KEY, envelope);
}

export function clearSave(): void {
  removeRaw(SAVE_KEY);
}

/** 首页用于决定是否显示「继续对局」 */
export function hasSaveGame(): boolean {
  return readGameEnvelope() !== null;
}

function readGameEnvelope(): SaveEnvelope | null {
  const envelope = readJson<SaveEnvelope>(SAVE_KEY);
  if (envelope === null || typeof envelope.version !== 'number') {
    return null;
  }
  return envelope.version === ENGINE_VERSION ? envelope : null;
}

export function loadGame(): LoadResult {
  const envelope = readJson<SaveEnvelope>(SAVE_KEY);
  if (envelope === null) {
    return { kind: 'empty' };
  }
  if (typeof envelope.version !== 'number') {
    return { kind: 'corrupt', reason: '缺少版本号' };
  }
  if (envelope.version !== ENGINE_VERSION) {
    return {
      kind: 'incompatible',
      reason: `存档版本 ${envelope.version} 与当前 ${ENGINE_VERSION} 不兼容`,
    };
  }
  const state = envelope.state;
  if (state === undefined || state === null) {
    return { kind: 'corrupt', reason: '缺少对局状态' };
  }
  const total = countAllCards(state);
  if (total !== DECK_SIZE) {
    return { kind: 'corrupt', reason: `牌数不守恒（${total}/${DECK_SIZE}）` };
  }
  return { kind: 'ok', state };
}
