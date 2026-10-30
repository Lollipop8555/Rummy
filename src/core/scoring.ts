/**
 * 计分与段位。
 *
 * 核心口径（README「积分 / 一轮结算」）：
 *   某方本轮得分 = 该方阵营桌面牌分值合计 − 该方手牌分值合计
 * 分值按「阵营」归属：给对手的组合接牌，那张牌的分算给对手。
 */

import { handTotal, type Card } from './cards';
import { meldValue, type Meld } from './meld';

export const TARGET_SCORE = 500;
export const WIN_POINTS = 5;
export const LOSE_POINTS = -3;
export const JOKER_LOCK_PENALTY_NOTE = 'joker-lock';

export type MeldOwner = {
  readonly owner: 'player' | 'ai';
  readonly meld: Meld;
};

/** 某方阵营桌面分：只看该方名下的组合 */
export function tableScoreOf(
  melds: readonly MeldOwner[],
  owner: 'player' | 'ai',
): number {
  return melds
    .filter((item) => item.owner === owner)
    .reduce((sum, item) => sum + meldValue(item.meld), 0);
}

/**
 * 一轮结算。
 * 出完手牌一方手牌为 0，故其得分等于阵营桌面分，无额外奖励。
 */
export function roundScore(
  tableScore: number,
  hand: readonly Card[],
): number {
  return tableScore - handTotal(hand);
}

/** 本局是否结束：任一方达到目标分 */
export function isMatchOver(
  playerTotal: number,
  aiTotal: number,
): boolean {
  return playerTotal >= TARGET_SCORE || aiTotal >= TARGET_SCORE;
}

export type MatchOutcome = 'win' | 'lose' | 'draw';

export function matchOutcome(
  playerTotal: number,
  aiTotal: number,
): MatchOutcome {
  if (playerTotal > aiTotal) {
    return 'win';
  }
  if (playerTotal < aiTotal) {
    return 'lose';
  }
  return 'draw';
}

/** 用户积分变化。平局按加赛处理，故此处只接受 win/lose */
export function ratingDelta(outcome: 'win' | 'lose'): number {
  return outcome === 'win' ? WIN_POINTS : LOSE_POINTS;
}

// ---------------------------------------------------------------- 段位

export const TIER_STEP = 50;
export const DIAMOND_BASE = 500;

export type Tier = {
  /** i18n key，UI 侧负责翻译 */
  readonly key: string;
  /** 星级，仅钻石段位 > 0 */
  readonly stars: number;
  /** 该段位积分下限 */
  readonly min: number;
  /** 下一档位积分下限，null 表示钻石无限 */
  readonly next: number | null;
};

const NAMED_TIERS: readonly { key: string; min: number }[] = [
  { key: 'tier.bronze3', min: 0 },
  { key: 'tier.bronze2', min: 50 },
  { key: 'tier.bronze1', min: 100 },
  { key: 'tier.silver3', min: 150 },
  { key: 'tier.silver2', min: 200 },
  { key: 'tier.silver1', min: 250 },
  { key: 'tier.gold3', min: 300 },
  { key: 'tier.gold2', min: 350 },
  { key: 'tier.gold1', min: 400 },
  { key: 'tier.platinum', min: 450 },
  { key: 'tier.diamond', min: DIAMOND_BASE },
];

export function tierOf(rating: number): Tier {
  if (rating < 0) {
    return { key: 'tier.iron', stars: 0, min: 0, next: 0 };
  }
  if (rating < DIAMOND_BASE) {
    const index = Math.floor(rating / TIER_STEP);
    const entry = NAMED_TIERS[Math.min(index, NAMED_TIERS.length - 2)];
    const current = entry ?? NAMED_TIERS[0];
    if (current === undefined) {
      return { key: 'tier.bronze3', stars: 0, min: 0, next: 50 };
    }
    return {
      key: current.key,
      stars: 0,
      min: current.min,
      next: current.min + TIER_STEP,
    };
  }
  // 钻石：每 50 分 +1 星（向下取整），500 起为 0 星
  const stars = Math.floor(rating / TIER_STEP) - DIAMOND_BASE / TIER_STEP;
  const min = DIAMOND_BASE + stars * TIER_STEP;
  return {
    key: 'tier.diamond',
    stars,
    min,
    next: min + TIER_STEP,
  };
}

/** 距下一段位还差多少分，用于进度展示 */
export function pointsToNextTier(rating: number): number {
  const tier = tierOf(rating);
  if (tier.next === null) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, tier.next - rating);
}
