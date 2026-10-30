/**
 * 把 AI 计划转换为主引擎动作。
 *
 * 本模块是 `ai` 与 `core` 的唯一边界：AI 只依赖 `GameView`，
 * 由外层（controller）调用 `reduce` 执行动作。runner 本身不 import engine。
 */

import type { AiMove, AiPlan, Intensity } from './policy';
import { planTurn, thinkDelay } from './policy';
import type { GameView } from '../core/view';

export type AiSide = 'player' | 'ai';

export type AiTurnPlan = {
  readonly moves: readonly AiMove[];
  readonly delayMs: number;
};

/** 为一个完整回合生成动作序列（含思考延迟） */
export function planAiTurn(
  view: GameView,
  me: AiSide,
  intensity: Intensity,
): AiTurnPlan {
  const plan: AiPlan = planTurn(view, me, intensity);
  return { moves: plan.moves, delayMs: thinkDelay() };
}

/**
 * 分数 → 强度档位。
 *
 * 注意：映射放在调用方而非 policy 内部，这样段位算法调整时
 * 不会牵连 AI 平衡（docs/技术方案.md 11.2）。
 */
export function intensityForRating(rating: number): Intensity {
  if (rating < 0) return 0;
  if (rating < 150) return 1;
  if (rating < 300) return 2;
  if (rating < 450) return 3;
  if (rating < 600) return 4;
  return 5;
}

/** 对手栏描述语的 i18n key，供 UI 使用（不回传给 AI） */
export function opponentDescriptionKey(intensity: Intensity): string {
  switch (intensity) {
    case 0:
      return 'opponent.L0';
    case 1:
      return 'opponent.L1';
    case 2:
      return 'opponent.L2';
    case 3:
      return 'opponent.L3';
    case 4:
      return 'opponent.L4';
    case 5:
      return 'opponent.L5';
  }
}
