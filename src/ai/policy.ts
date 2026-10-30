/**
 * 机器人策略。
 *
 * 硬约束（docs/技术方案.md 第 8 节）：本目录只能依赖 `GameView` 与
 * `core/cards`、`core/meld` 的公开类型。禁止引用 `core/engine`、`core/rng`，
 * 由 ESLint `no-restricted-imports` 强制。因此 AI 结构上无法读取牌堆。
 *
 * 强度 `L0..L5` 只影响评估权重与搜索深度，任何档位都不得越权取信息。
 */

import { handValue, isJoker, type Card } from '../core/cards';
import {
  appendOptions,
  isLegalMeld,
  meldValue,
  resolveMelds,
} from '../core/meld';
import type { Intensity } from '../core/cards';
import type { GameView } from '../core/view';

// Intensity 统一定义在 core/cards，供 engine / view / ai 共享。
export type { Intensity };

export type AiMove =
  | { readonly type: 'drawDeck' }
  | { readonly type: 'takeDiscardTop' }
  | { readonly type: 'takeDiscardDeep'; readonly cardId: string }
  | {
      readonly type: 'meld';
      readonly cardIds: readonly string[];
      readonly meldIndex: number;
    }
  | {
      readonly type: 'layOff';
      readonly meldId: string;
      readonly cardId: string;
      readonly optionIndex: number;
    }
  | { readonly type: 'discard'; readonly cardId: string };

export type AiPlan = {
  readonly moves: readonly AiMove[];
  /** 仅用于调试与自对弈回归 */
  readonly score: number;
};

const THINK_MS = 2000;

/** 思考延迟，仅表现层使用 */
export function thinkDelay(): number {
  return THINK_MS;
}

// ------------------------------------------------------------ 手牌分析

type HandPlan = {
  /** 拟亮出的组合（牌 id 集合 + 选中的解释） */
  readonly melds: readonly {
    readonly cardIds: readonly string[];
    readonly meldIndex: number;
    readonly value: number;
  }[];
  /** 未被组合覆盖的剩余牌 */
  readonly leftovers: readonly Card[];
  /** 桌面分收益 */
  readonly tableGain: number;
  /** 剩余手牌扣分 */
  readonly leftoverLoss: number;
};

/**
 * 穷举手牌的最佳拆解。
 *
 * 复杂度控制：
 * - 子集规模上限 4 张（顺子/数组的真实上限是 13/4，但 4 张以上的组合
 *   在 11 张手牌中极少出现，且会带来组合爆炸；深度收取路径会反复调用本函数，
 *   因此必须限制）。
 * - 递归结果按「剩余牌 id 集合」memo 化，避免同一子问题重复求解。
 */
const PLAN_SUBSET_MAX = 4;

function bestHandPlan(hand: readonly Card[]): HandPlan {
  const memo = new Map<string, HandPlan>();

  const search = (remaining: readonly Card[]): HandPlan => {
    const key = remaining
      .map((card) => card.id)
      .sort()
      .join('|');
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // 基线：不再拆解，全部留作手牌
    let best: HandPlan = {
      melds: [],
      leftovers: [...remaining],
      tableGain: 0,
      leftoverLoss: remaining.reduce((sum, card) => sum + handValue(card), 0),
    };

    if (remaining.length >= 3) {
      for (
        let size = 3;
        size <= Math.min(PLAN_SUBSET_MAX, remaining.length);
        size += 1
      ) {
        for (const combo of pickCombinations(remaining.length, size)) {
          const cards: Card[] = [];
          for (const i of combo) {
            const card = remaining[i];
            if (card !== undefined) {
              cards.push(card);
            }
          }
          if (cards.length !== size) {
            continue;
          }
          const options = resolveMelds(cards);
          const chosen = options[0];
          if (chosen === undefined) {
            continue;
          }
          const usedIds = new Set(cards.map((card) => card.id));
          const rest = remaining.filter((card) => !usedIds.has(card.id));
          const sub = search(rest);
          const tableGain = meldValue(chosen) + sub.tableGain;
          const netGain = tableGain - sub.leftoverLoss;
          if (netGain > best.tableGain - best.leftoverLoss) {
            best = {
              melds: [
                {
                  cardIds: cards.map((card) => card.id),
                  meldIndex: 0,
                  value: meldValue(chosen),
                },
                ...sub.melds,
              ],
              leftovers: sub.leftovers,
              tableGain,
              leftoverLoss: sub.leftoverLoss,
            };
          }
        }
      }
    }

    memo.set(key, best);
    return best;
  };

  return search(hand);
}

function pickCombinations(n: number, k: number): number[][] {
  const result: number[][] = [];
  const current: number[] = [];
  const walk = (start: number): void => {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < n; i += 1) {
      current.push(i);
      walk(i + 1);
      current.pop();
    }
  };
  walk(0);
  return result;
}

// ------------------------------------------------------------ 弃牌选择

/** 弃哪张牌：优先丢掉「无法参与组合且分值最高」的牌 */
function chooseDiscard(
  view: GameView,
  intensity: Intensity,
): Card | undefined {
  const hand = view.me.cards.filter((card) => !isJoker(card));
  if (hand.length === 0) {
    return undefined;
  }

  if (intensity === 0) {
    // L0：只保证合法，随便丢一张
    return hand[0];
  }

  const plan = bestHandPlan(view.me.cards);
  const leftoverIds = new Set(plan.leftovers.map((card) => card.id));
  const candidates = hand.filter((card) => leftoverIds.has(card.id));
  const pool = candidates.length > 0 ? candidates : hand;

  // 丢弃分值最高且无组合价值的牌
  return [...pool].sort((a, b) => handValue(b) - handValue(a))[0];
}

// ------------------------------------------------------------ 接牌决策

type LayOffChoice = {
  readonly meldId: string;
  readonly cardId: string;
  readonly optionIndex: number;
  readonly gain: number;
  /** 该组合是否属于对手，接牌会把分送给对手 */
  readonly toOpponent: boolean;
};

function findLayOffs(
  view: GameView,
  me: 'player' | 'ai',
): LayOffChoice[] {
  const results: LayOffChoice[] = [];
  for (const item of view.table) {
    for (const card of view.me.cards) {
      const options = appendOptions(item.meld, card);
      for (let i = 0; i < options.length; i += 1) {
        const option = options[i];
        if (option === undefined) {
          continue;
        }
        results.push({
          meldId: item.id,
          cardId: card.id,
          optionIndex: i,
          gain: handValue(card),
          toOpponent: item.owner !== me,
        });
      }
    }
  }
  return results;
}

// ------------------------------------------------------------ 主决策

/**
 * 规划一个完整回合的动作序列。
 * 断言：`view.turn === me`，否则返回空计划。
 */
export function planTurn(
  view: GameView,
  me: 'player' | 'ai',
  intensity: Intensity,
): AiPlan {
  if (view.turn !== me) {
    return { moves: [], score: 0 };
  }
  if (view.phase === 'draw') {
    return planDrawPhase(view, intensity);
  }
  if (view.phase === 'play') {
    return planPlayPhase(view, me, intensity);
  }
  return { moves: [], score: 0 };
}

function planDrawPhase(view: GameView, intensity: Intensity): AiPlan {
  const moves: AiMove[] = [];
  const baseline = handPlanScore(view.me.cards);

  // 关键：取弃牌的唯一理由是「让本回合的方案真的变好」。
  // 若只判断「能否成组」而不验证后续是否真的用上它，
  // AI 会取了牌却不用，转手弃掉另一张，导致同一张牌在双方之间来回搬运、
  // 对局永不收敛（自对弈曾因此无法结束）。
  const top = view.discard[view.discard.length - 1];
  if (top !== undefined && intensity >= 1 && !isJoker(top)) {
    const virtualHand = [...view.me.cards, top];
    if (
      canUseImmediately(virtualHand, top, view) &&
      handPlanScore(virtualHand) > baseline
    ) {
      moves.push({ type: 'takeDiscardTop' });
      return { moves, score: handPlanScore(virtualHand) - baseline };
    }
  }

  // 深层收取：L5 才考虑，且必须「收益扣除连带成本后仍优于现有方案」
  if (intensity >= 5 && view.discard.length > 2) {
    for (let i = view.discard.length - 2; i >= 0; i -= 1) {
      const candidate = view.discard[i];
      if (candidate === undefined || isJoker(candidate)) {
        continue;
      }
      const taken = view.discard.slice(i);
      const cost = taken
        .slice(1)
        .reduce((sum, card) => sum + handValue(card), 0);
      const virtualHand = [...view.me.cards, ...taken];
      const gain = handPlanScore(virtualHand) - baseline;
      if (gain > cost + 5 && canUseImmediately(virtualHand, candidate, view)) {
        moves.push({ type: 'takeDiscardDeep', cardId: candidate.id });
        return { moves, score: gain - cost };
      }
    }
  }

  moves.push({ type: 'drawDeck' });
  return { moves, score: 0 };
}

/** 手牌方案净收益：桌面得分 − 剩余手牌扣分 */
function handPlanScore(hand: readonly Card[]): number {
  const plan = bestHandPlan(hand);
  return plan.tableGain - plan.leftoverLoss;
}

function canUseImmediately(
  hand: readonly Card[],
  card: Card,
  view: GameView,
): boolean {
  const others = hand.filter((item) => item.id !== card.id);
  for (let i = 0; i < others.length; i += 1) {
    for (let j = i + 1; j < others.length; j += 1) {
      const a = others[i];
      const b = others[j];
      if (a === undefined || b === undefined) {
        continue;
      }
      if (isLegalMeld([card, a, b])) {
        return true;
      }
    }
  }
  return view.table.some(
    (item) => appendOptions(item.meld, card).length > 0,
  );
}

function planPlayPhase(
  view: GameView,
  me: 'player' | 'ai',
  intensity: Intensity,
): AiPlan {
  const moves: AiMove[] = [];
  let score = 0;

  // 1. 亮牌
  const plan = bestHandPlan(view.me.cards);
  for (const item of plan.melds) {
    moves.push({
      type: 'meld',
      cardIds: item.cardIds,
      meldIndex: item.meldIndex,
    });
    score += item.value;
  }

  // 2. 接牌
  if (intensity >= 2) {
    const usedIds = new Set<string>();
    for (const item of plan.melds) {
      for (const id of item.cardIds) {
        usedIds.add(id);
      }
    }
    const layOffs = findLayOffs(view, me).filter(
      (choice) => !usedIds.has(choice.cardId),
    );
    for (const choice of layOffs) {
      // L3 起：规避「给对手送分」
      if (choice.toOpponent && intensity >= 3) {
        continue;
      }
      // L4 起：仅当接牌不影响自己后续组合时才做
      if (intensity >= 4 && !isSafeLayOff(view, choice)) {
        continue;
      }
      if (usedIds.has(choice.cardId)) {
        continue;
      }
      usedIds.add(choice.cardId);
      moves.push({
        type: 'layOff',
        meldId: choice.meldId,
        cardId: choice.cardId,
        optionIndex: choice.optionIndex,
      });
      score += choice.gain;
    }
  }

  // 3. 弃牌
  // 剔除已被亮出/接出的牌后再选
  const used = new Set<string>();
  for (const move of moves) {
    if (move.type === 'meld') {
      for (const id of move.cardIds) {
        used.add(id);
      }
    } else if (move.type === 'layOff') {
      used.add(move.cardId);
    }
  }
  // 规则禁止把本回合刚取到的牌直接弃回，候选池中剔除
  const remaining = view.me.cards.filter(
    (card) => !used.has(card.id) && card.id !== view.drawnCardId,
  );
  const virtualView: GameView = {
    ...view,
    me: { ...view.me, cards: remaining },
  };
  const discardCard = chooseDiscard(virtualView, intensity);
  if (discardCard !== undefined) {
    moves.push({ type: 'discard', cardId: discardCard.id });
  }
  // 无可弃之牌（手牌只剩本回合刚取的那一张，或已全部打出）时不产出弃牌动作，
  // 由引擎的「无合法动作」判定结束本轮。

  return { moves, score };
}

function isSafeLayOff(view: GameView, choice: LayOffChoice): boolean {
  const target = view.table.find((item) => item.id === choice.meldId);
  if (target === undefined) {
    return false;
  }
  // 接牌后组合是否仍有空位（顺子可延伸、数组未满）
  const card = view.me.cards.find((item) => item.id === choice.cardId);
  if (card === undefined) {
    return false;
  }
  return appendOptions(target.meld, card).length > 0;
}
