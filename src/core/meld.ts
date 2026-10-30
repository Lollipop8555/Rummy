/**
 * 合法组合（Meld）的判定与王牌模拟推断。
 *
 * 本模块是整个规则引擎中最容易出错的部分，两条硬约束贯穿始终：
 * 1. 王牌不能单独成组，必须依附至少 2 张自然牌。
 * 2. A 有双重身份（低=1 / 高=14），必须在同一条顺子里择一，不能既当 1 又当 14。
 *
 * 所有函数均为纯函数，便于穷举测试。
 */

import {
  ACE_HIGH,
  ACE_LOW,
  KING,
  SUITS,
  isJoker,
  resolvedValue,
  type Card,
  type NormalCard,
  type ResolvedRank,
  type Suit,
} from './cards';

export type MeldType = 'run' | 'set';

/** 组合中的一格：可能是自然牌，也可能是王牌模拟出的牌 */
export type MeldSlot = {
  /** 实际使用的牌（模拟时即王牌本身） */
  readonly card: Card;
  /** 在该组合中生效的花色（模拟牌为模拟出的花色） */
  readonly suit: Suit;
  /** 在该组合中生效的解析点数（模拟牌为模拟出的点数） */
  readonly rank: ResolvedRank;
  /** 是否为王牌模拟 */
  readonly simulated: boolean;
};

export type Meld = {
  readonly type: MeldType;
  /** run 按 rank 升序；set 按 SUITS 顺序 */
  readonly slots: readonly MeldSlot[];
};

export const MIN_MELD_SIZE = 3;
export const MAX_RUN_SIZE = 13;
export const MAX_SET_SIZE = 4;

/** 组合总分：模拟牌按被模拟牌的分值计 */
export function meldValue(meld: Meld): number {
  return meld.slots.reduce((sum, slot) => sum + resolvedValue(slot.rank), 0);
}

export function meldCards(meld: Meld): Card[] {
  return meld.slots.map((slot) => slot.card);
}

/** 自然牌列表 */
function naturals(cards: readonly Card[]): NormalCard[] {
  const result: NormalCard[] = [];
  for (const card of cards) {
    if (!isJoker(card)) {
      result.push(card);
    }
  }
  return result;
}

/** A 的所有解析可能（1 或 14），其余唯一 */
function rankVariants(card: NormalCard): ResolvedRank[] {
  return card.rank === ACE_LOW ? [ACE_LOW, ACE_HIGH] : [card.rank];
}

/** 笛卡尔积：为每张 A 选择 1 或 14 */
function parsedRankAssignments(cards: readonly NormalCard[]): ResolvedRank[][] {
  let assignments: ResolvedRank[][] = [[]];
  for (const card of cards) {
    const variants = rankVariants(card);
    const next: ResolvedRank[][] = [];
    for (const prefix of assignments) {
      for (const variant of variants) {
        next.push([...prefix, variant]);
      }
    }
    assignments = next;
  }
  return assignments;
}

function slotOf(
  card: Card,
  suit: Suit,
  rank: ResolvedRank,
): MeldSlot {
  return {
    card,
    suit,
    rank,
    simulated: isJoker(card),
  };
}

/**
 * 尝试把一组牌解释为顺子（run），返回所有可行解释。
 * 存在多个返回值的典型场景：`♠7 ♠8 + 王牌` 既可补 ♠6 也可补 ♠9。
 */
export function asRuns(cards: readonly Card[]): Meld[] {
  if (cards.length < MIN_MELD_SIZE || cards.length > MAX_RUN_SIZE) {
    return [];
  }
  const naturalList = naturals(cards);
  if (naturalList.length < 2) {
    // 王牌必须依附至少 2 张自然牌
    return [];
  }
  // 顺子要求花色一致
  const suit = naturalList[0]?.suit;
  if (suit === undefined) {
    return [];
  }
  if (naturalList.some((card) => card.suit !== suit)) {
    return [];
  }

  const jokerCards = cards.filter(isJoker);
  const results: Meld[] = [];
  const seen = new Set<string>();

  for (const assignment of parsedRankAssignments(naturalList)) {
    const fixed = new Map<ResolvedRank, Card>();
    let duplicate = false;
    for (let i = 0; i < naturalList.length; i += 1) {
      const rank = assignment[i];
      const card = naturalList[i];
      if (rank === undefined || card === undefined) {
        continue;
      }
      if (fixed.has(rank)) {
        duplicate = true;
        break;
      }
      fixed.set(rank, card);
    }
    if (duplicate) {
      continue;
    }

    const ranks = [...fixed.keys()];
    const minRank = Math.min(...ranks);
    const maxRank = Math.max(...ranks);
    const span = maxRank - minRank + 1;
    // 王牌需补齐长度与区间空位的差
    if (span > cards.length) {
      continue;
    }

    const startCandidates: ResolvedRank[] = [];
    for (let start = ACE_LOW; start <= minRank; start += 1) {
      const end = start + cards.length - 1;
      if (end < maxRank || end > ACE_HIGH) {
        continue;
      }
      startCandidates.push(start);
    }

    for (const start of startCandidates) {
      const end = start + cards.length - 1;
      const slots: MeldSlot[] = [];
      let jokerCursor = 0;
      let ok = true;
      for (let rank = start; rank <= end; rank += 1) {
        const natural = fixed.get(rank);
        if (natural !== undefined) {
          slots.push(slotOf(natural, suit, rank));
        } else {
          const joker = jokerCards[jokerCursor];
          if (joker === undefined) {
            ok = false;
            break;
          }
          jokerCursor += 1;
          slots.push(slotOf(joker, suit, rank));
        }
      }
      if (!ok || jokerCursor !== jokerCards.length) {
        continue;
      }
      const key = slots.map((s) => `${s.rank}`).join(',');
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      results.push({ type: 'run', slots });
    }
  }
  return results;
}

/**
 * 尝试把一组牌解释为同点数组（set），返回所有可行解释。
 * 存在多个返回值的典型场景：`♠7 ♥7 + 王牌`，王牌可模拟 ♣ 或 ♦。
 */
export function asSets(cards: readonly Card[]): Meld[] {
  if (
    cards.length < MIN_MELD_SIZE ||
    cards.length > MAX_SET_SIZE
  ) {
    return [];
  }
  const naturalList = naturals(cards);
  if (naturalList.length < 2) {
    return [];
  }
  const naturalRank = naturalList[0]?.rank;
  if (naturalRank === undefined) {
    return [];
  }
  if (naturalList.some((card) => card.rank !== naturalRank)) {
    return [];
  }
  // 同点数组不涉及连续性，A 统一按最高位解析，即 15 分
  const rank: ResolvedRank =
    naturalRank === ACE_LOW ? ACE_HIGH : naturalRank;
  const usedSuits = new Set<Suit>();
  for (const card of naturalList) {
    if (usedSuits.has(card.suit)) {
      return [];
    }
    usedSuits.add(card.suit);
  }

  const jokers = cards.filter(isJoker);
  const freeSuits = SUITS.filter((suit) => !usedSuits.has(suit));
  if (jokers.length > freeSuits.length) {
    return [];
  }

  const results: Meld[] = [];

  /** 从 freeSuits 中挑 jokers.length 个分配给王牌 */
  const choose = (
    pool: readonly Suit[],
    count: number,
  ): Suit[][] => {
    if (count === 0) {
      return [[]];
    }
    const combos: Suit[][] = [];
    for (let i = 0; i < pool.length; i += 1) {
      const head = pool[i];
      if (head === undefined) {
        continue;
      }
      const rest = [...pool.slice(0, i), ...pool.slice(i + 1)];
      for (const tail of choose(rest, count - 1)) {
        combos.push([head, ...tail]);
      }
    }
    return combos;
  };

  for (const assignedSuits of choose(freeSuits, jokers.length)) {
    const bySuit = new Map<Suit, Card>();
    for (const card of naturalList) {
      bySuit.set(card.suit, card);
    }
    for (let i = 0; i < jokers.length; i += 1) {
      const joker = jokers[i];
      const suit = assignedSuits[i];
      if (joker === undefined || suit === undefined) {
        continue;
      }
      bySuit.set(suit, joker);
    }
    const slots: MeldSlot[] = [];
    for (const suit of SUITS) {
      const card = bySuit.get(suit);
      if (card !== undefined) {
        slots.push(slotOf(card, suit, rank));
      }
    }
    results.push({ type: 'set', slots });
  }
  return results;
}

/** 所有可行的组合解释（顺子 + 同点数组） */
export function resolveMelds(cards: readonly Card[]): Meld[] {
  return [...asRuns(cards), ...asSets(cards)];
}

/** 是否存在任意一种合法解释 */
export function isLegalMeld(cards: readonly Card[]): boolean {
  return resolveMelds(cards).length > 0;
}

/** 判定歧义：同一组牌存在多种解释，需要玩家选择 */
export function isAmbiguous(cards: readonly Card[]): boolean {
  return resolveMelds(cards).length > 1;
}

export type AppendResult = {
  /** 扩展后的完整组合 */
  readonly meld: Meld;
  /** 新增的那一格，便于 UI 高亮 */
  readonly added: MeldSlot;
  /** 追加后组合的总分 */
  readonly value: number;
};

/**
 * 尝试把一张牌接到已有组合上，返回所有可行方案。
 *
 * 顺子只允许向两端延伸（已成立的组合内部没有空位）；
 * 同点数组要求点数相同且花色未占用，上限 4 张。
 */
export function appendOptions(
  meld: Meld,
  card: Card,
): AppendResult[] {
  if (meld.type === 'set') {
    return appendToSet(meld, card);
  }
  return appendToRun(meld, card);
}

function appendToSet(meld: Meld, card: Card): AppendResult[] {
  if (meld.slots.length >= MAX_SET_SIZE) {
    return [];
  }
  const rank = meld.slots[0]?.rank;
  if (rank === undefined) {
    return [];
  }
  const usedSuits = new Set(meld.slots.map((slot) => slot.suit));

  if (!isJoker(card)) {
    if (card.rank !== rank || usedSuits.has(card.suit)) {
      return [];
    }
    const added = slotOf(card, card.suit, rank);
    const slots = sortSetSlots([...meld.slots, added]);
    const next: Meld = { type: 'set', slots };
    return [{ meld: next, added, value: meldValue(next) }];
  }

  const results: AppendResult[] = [];
  for (const suit of SUITS) {
    if (usedSuits.has(suit)) {
      continue;
    }
    const added = slotOf(card, suit, rank);
    const slots = sortSetSlots([...meld.slots, added]);
    const next: Meld = { type: 'set', slots };
    results.push({ meld: next, added, value: meldValue(next) });
  }
  return results;
}

function sortSetSlots(slots: readonly MeldSlot[]): MeldSlot[] {
  return [...slots].sort(
    (a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit),
  );
}

function appendToRun(meld: Meld, card: Card): AppendResult[] {
  if (meld.slots.length >= MAX_RUN_SIZE) {
    return [];
  }
  const first = meld.slots[0];
  const last = meld.slots[meld.slots.length - 1];
  if (first === undefined || last === undefined) {
    return [];
  }
  const suit = first.suit;
  const minRank = first.rank;
  const maxRank = last.rank;
  const results: AppendResult[] = [];

  const push = (rank: ResolvedRank, useSuit: Suit): void => {
    const added = slotOf(card, useSuit, rank);
    const slots = rank < minRank
      ? [added, ...meld.slots]
      : [...meld.slots, added];
    const next: Meld = { type: 'run', slots };
    results.push({ meld: next, added, value: meldValue(next) });
  };

  if (isJoker(card)) {
    // 王牌可补在任一端，只要不越界、不与已有牌撞点
    const lower = minRank - 1;
    const upper = maxRank + 1;
    if (lower >= ACE_LOW && !hasRank(meld, lower)) {
      push(lower, suit);
    }
    if (upper <= ACE_HIGH && !hasRank(meld, upper)) {
      push(upper, suit);
    }
    return results;
  }

  if (card.suit !== suit) {
    return [];
  }
  const candidates: ResolvedRank[] = card.rank === ACE_LOW
    ? [ACE_LOW, ACE_HIGH]
    : [card.rank];
  for (const rank of candidates) {
    if (rank === minRank - 1 && rank >= ACE_LOW && !hasRank(meld, rank)) {
      push(rank, suit);
    }
    if (rank === maxRank + 1 && rank <= ACE_HIGH && !hasRank(meld, rank)) {
      push(rank, suit);
    }
  }
  return results;
}

function hasRank(meld: Meld, rank: ResolvedRank): boolean {
  return meld.slots.some((slot) => slot.rank === rank);
}

/** 组合是否已用满（顺子 13 张 / 数组 4 张） */
export function isMeldFull(meld: Meld): boolean {
  return meld.type === 'run'
    ? meld.slots.length >= MAX_RUN_SIZE
    : meld.slots.length >= MAX_SET_SIZE;
}

/** 自然牌在组合中的可读描述，如 `♠7`、`JOKER=♠7` */
export function slotLabel(slot: MeldSlot): string {
  const rankText = rankTextOf(slot.rank);
  const suitText = suitSymbol(slot.suit);
  const base = `${suitText}${rankText}`;
  return slot.simulated ? `JOKER=${base}` : base;
}

const RANK_TEXT: Record<number, string> = {
  1: 'A',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

export function rankTextOf(rank: ResolvedRank): string {
  return RANK_TEXT[rank] ?? String(rank);
}

export function suitSymbol(suit: Suit): string {
  switch (suit) {
    case 'S':
      return '♠';
    case 'H':
      return '♥';
    case 'D':
      return '♦';
    case 'C':
      return '♣';
  }
}

export { KING };
export type { ResolvedRank };
