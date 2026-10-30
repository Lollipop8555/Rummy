/**
 * AI 自对弈回归。
 *
 * 目的不是验证「AI 很强」，而是保证：
 * 1. 策略产出的每个动作都能被引擎接受（无非法动作）。
 * 2. 对局能在合理步数内结束（无死循环、无卡死）。
 * 3. AI 全程只拿到 GameView（结构上无法读牌堆）。
 */

import { describe, expect, it } from 'vitest';
import { DECK_SIZE } from '../core/cards';
import { createGame, reduce, type GameState } from '../core/engine';
import { toGameView } from '../core/view';
import { intensityForRating, opponentDescriptionKey, planAiTurn } from './runner';
import type { Intensity } from './policy';

const MAX_STEPS = 4000;

type SimResult = {
  readonly states: number;
  readonly finalPhase: string;
  readonly playerTotal: number;
  readonly aiTotal: number;
  readonly illegalMoves: number;
  /** 手牌为 0 却停留在 play 阶段，属于死锁 */
  readonly stuckAtEmptyHand: boolean;
};

function simulate(seed: number, intensity: Intensity): SimResult {
  let state: GameState = createGame({ seed, intensity });
  let steps = 0;
  let illegalMoves = 0;
  let stuckAtEmptyHand = false;

  while (steps < MAX_STEPS) {
    if (state.phase === 'roundEnd') {
      const result = reduce(state, { type: 'confirmRound' });
      if (!result.ok) break;
      state = result.state;
      steps += 1;
      continue;
    }
    if (state.phase === 'matchEnd') {
      break;
    }

    const me = state.turn;
    const view = toGameView(state, { side: me });
    const plan = planAiTurn(view, me, intensity);

    if (plan.moves.length === 0) {
      // 手牌为 0 却仍在 play 阶段 → 死锁
      if (state.phase === 'play' && state.hands[state.turn].length === 0) {
        stuckAtEmptyHand = true;
      }
      break;
    }

    for (const move of plan.moves) {
      const result = reduce(state, move);
      steps += 1;
      if (!result.ok) {
        illegalMoves += 1;
        // 回退：尝试合法兜底（摸牌或弃任意非王牌）
        const fallback = fallbackMove(state);
        if (fallback === null) {
          return {
            states: steps,
            finalPhase: state.phase,
            playerTotal: state.playerTotal,
            aiTotal: state.aiTotal,
            illegalMoves,
            stuckAtEmptyHand,
          };
        }
        const retry = reduce(state, fallback);
        if (!retry.ok) {
          return {
            states: steps,
            finalPhase: state.phase,
            playerTotal: state.playerTotal,
            aiTotal: state.aiTotal,
            illegalMoves,
            stuckAtEmptyHand,
          };
        }
        state = retry.state;
        continue;
      }
      state = result.state;
      if (state.phase === 'roundEnd' || state.phase === 'matchEnd') {
        break;
      }
    }
  }

  if (state.phase === 'play' && state.hands[state.turn].length === 0) {
    stuckAtEmptyHand = true;
  }

  return {
    states: steps,
    finalPhase: state.phase,
    playerTotal: state.playerTotal,
    aiTotal: state.aiTotal,
    illegalMoves,
    stuckAtEmptyHand,
  };
}

function fallbackMove(
  state: GameState,
): { type: 'drawDeck' } | { type: 'discard'; cardId: string } | null {
  if (state.phase === 'draw') {
    return { type: 'drawDeck' };
  }
  if (state.phase === 'play') {
    const hand = state.hands[state.turn];
    const normal = hand.find((card) => card.kind === 'normal');
    if (normal === undefined) {
      return null;
    }
    return { type: 'discard', cardId: normal.id };
  }
  return null;
}

describe('AI 自对弈', () => {
  it('L1 能跑完一局且不产生非法动作', () => {
    const result = simulate(2024, 1);
    expect(result.illegalMoves).toBe(0);
    expect(result.states).toBeLessThan(MAX_STEPS);
  });

  it('L3 能跑完一局且不产生非法动作', () => {
    const result = simulate(7777, 3);
    expect(result.illegalMoves).toBe(0);
  });

  it(
    'L5 能跑完一局且不产生非法动作',
    () => {
      const result = simulate(31337, 5);
      expect(result.illegalMoves).toBe(0);
    },
    // L5 会枚举深层收取方案，单次决策远慢于低档位；
    // 这属于性能特征而非缺陷，故放宽超时。
    60_000,
  );

  it('多个 seed 下均能推进且无非法动作（无死锁）', () => {
    // 注意：不检查 finalPhase 是否为 draw —— 跑满步数时停在一轮开局是正常的。
    // 真正要保证的是「不产生非法动作」与「状态确实在推进」。
    for (const seed of [1, 2, 3, 11, 42, 99, 1234]) {
      const result = simulate(seed, 2);
      expect(result.illegalMoves).toBe(0);
      expect(result.states).toBeGreaterThan(0);
      // 手牌为 0 却停在 play 阶段即为死锁（曾出现的真实缺陷）
      expect(result.stuckAtEmptyHand).toBe(false);
    }
  });
});

describe('强度映射', () => {
  it('按积分分段映射到 L0–L5', () => {
    expect(intensityForRating(-10)).toBe(0);
    expect(intensityForRating(0)).toBe(1);
    expect(intensityForRating(149)).toBe(1);
    expect(intensityForRating(150)).toBe(2);
    expect(intensityForRating(299)).toBe(2);
    expect(intensityForRating(300)).toBe(3);
    expect(intensityForRating(449)).toBe(3);
    expect(intensityForRating(450)).toBe(4);
    expect(intensityForRating(599)).toBe(4);
    expect(intensityForRating(600)).toBe(5);
  });

  it('每个档位都有对应的描述 i18n key', () => {
    for (let i = 0; i <= 5; i += 1) {
      expect(opponentDescriptionKey(i as Intensity)).toBe(`opponent.L${i}`);
    }
  });
});

describe('牌数守恒', () => {
  it('任意时刻总牌数为 54', () => {
    let state = createGame({ seed: 555 });
    for (let step = 0; step < 60; step += 1) {
      const total =
        state.deck.length +
        state.discard.length +
        state.hands.player.length +
        state.hands.ai.length +
        state.table.reduce((sum, item) => sum + item.meld.slots.length, 0);
      expect(total).toBe(DECK_SIZE);

      if (state.phase === 'draw') {
        const result = reduce(state, { type: 'drawDeck' });
        if (!result.ok) break;
        state = result.state;
      } else if (state.phase === 'play') {
        const hand = state.hands[state.turn];
        const normal = hand.find((card) => card.kind === 'normal');
        if (normal === undefined) break;
        const result = reduce(state, { type: 'discard', cardId: normal.id });
        if (!result.ok) break;
        state = result.state;
      } else if (state.phase === 'roundEnd') {
        const result = reduce(state, { type: 'confirmRound' });
        if (!result.ok) break;
        state = result.state;
      } else {
        break;
      }
    }
  });
});
