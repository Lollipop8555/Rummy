/**
 * 手牌排序（纯视图逻辑，不影响引擎）。
 *
 * 两条固定规则：
 * 1. A 一律视为最大，避免每次出牌手牌顺序跳动。
 * 2. 王牌固定排最后，它可模拟任意牌，混入有序序列会破坏可读性。
 */

import { isJoker, SUITS, type Card } from '../../core/cards';

export type SortMode = 'suit' | 'rank';

export function sortHand(cards: readonly Card[], mode: SortMode): Card[] {
  const jokers = cards.filter(isJoker);
  const naturals = cards.filter((card) => !isJoker(card));

  const rankKey = (card: Card): number => {
    if (isJoker(card)) return 99;
    return card.rank === 1 ? 14 : card.rank;
  };
  const suitKey = (card: Card): number =>
    isJoker(card) ? 99 : SUITS.indexOf(card.suit);

  const sorted = [...naturals].sort((a, b) => {
    if (mode === 'suit') {
      const d = suitKey(a) - suitKey(b);
      return d !== 0 ? d : rankKey(a) - rankKey(b);
    }
    const d = rankKey(a) - rankKey(b);
    return d !== 0 ? d : suitKey(a) - suitKey(b);
  });

  return [...sorted, ...jokers];
}
