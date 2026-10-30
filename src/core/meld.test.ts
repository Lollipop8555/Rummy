import { describe, expect, it } from 'vitest';
import {
  normalCard,
  jokerCard,
  type Card,
  type Suit,
} from './cards';
import {
  appendOptions,
  asRuns,
  asSets,
  isLegalMeld,
  meldValue,
  resolveMelds,
  type Meld,
} from './meld';

const c = (suit: Suit, rank: number): Card => normalCard(suit, rank);
const big: Card = jokerCard('big');
const small: Card = jokerCard('small');

describe('顺子（run）', () => {
  it('识别普通顺子并计分', () => {
    const melds = asRuns([c('S', 5), c('S', 6), c('S', 7)]);
    expect(melds).toHaveLength(1);
    const meld = melds[0] as Meld;
    expect(meld.type).toBe('run');
    expect(meldValue(meld)).toBe(18);
  });

  it('拒绝花色不一致', () => {
    expect(asRuns([c('S', 5), c('H', 6), c('S', 7)])).toHaveLength(0);
  });

  it('拒绝点数不连续', () => {
    expect(asRuns([c('S', 5), c('S', 6), c('S', 8)])).toHaveLength(0);
  });

  it('拒绝少于 3 张', () => {
    expect(asRuns([c('S', 5), c('S', 6)])).toHaveLength(0);
  });

  it('A 可作为最小牌 A-2-3，按 1 分计', () => {
    const melds = asRuns([c('S', 1), c('S', 2), c('S', 3)]);
    expect(melds).toHaveLength(1);
    expect(meldValue(melds[0] as Meld)).toBe(1 + 2 + 3);
  });

  it('A 可作为最大牌 Q-K-A，按 15 分计', () => {
    const melds = asRuns([c('S', 12), c('S', 13), c('S', 1)]);
    expect(melds).toHaveLength(1);
    expect(meldValue(melds[0] as Meld)).toBe(10 + 10 + 15);
  });

  it('A 不能同时当 1 和 14', () => {
    // A-2-3 里 A 已是 1，不能再拼 A=14 的 Q-K-A
    expect(asRuns([c('S', 13), c('S', 1), c('S', 2)])).toHaveLength(0);
  });

  it('王牌补唯一位置时只有一种解释（♠5 ♠6 ♠8 + 王牌 → ♠7）', () => {
    const melds = asRuns([c('S', 5), c('S', 6), c('S', 8), big]);
    expect(melds).toHaveLength(1);
    const ranks = (melds[0] as Meld).slots.map((slot) => slot.rank);
    expect(ranks).toEqual([5, 6, 7, 8]);
    expect((melds[0] as Meld).slots[2]?.simulated).toBe(true);
  });

  it('王牌位置有歧义时返回两种解释（♠7 ♠8 + 王牌）', () => {
    const melds = asRuns([c('S', 7), c('S', 8), big]);
    const rankSets = melds.map((m) => m.slots.map((s) => s.rank).join(','));
    expect(new Set(rankSets)).toEqual(new Set(['6,7,8', '7,8,9']));
  });

  it('王牌不能单独成组（需至少 2 张自然牌）', () => {
    expect(asRuns([big, small, c('S', 5)])).toHaveLength(0);
  });

  it('同一张牌不重复计入（无重复点数）', () => {
    expect(asRuns([c('S', 5), c('S', 5), c('S', 6)])).toHaveLength(0);
  });
});

describe('同点数组（set）', () => {
  it('识别同点不同色', () => {
    const melds = asSets([c('S', 8), c('H', 8), c('D', 8)]);
    expect(melds).toHaveLength(1);
    expect(meldValue(melds[0] as Meld)).toBe(24);
  });

  it('拒绝同花色的重复点数', () => {
    expect(asSets([c('S', 8), c('S', 8), c('D', 8)])).toHaveLength(0);
  });

  it('拒绝点数不同', () => {
    expect(asSets([c('S', 8), c('H', 9), c('D', 8)])).toHaveLength(0);
  });

  it('上限 4 张', () => {
    expect(
      asSets([c('S', 8), c('H', 8), c('D', 8), c('C', 8)]),
    ).toHaveLength(1);
    // 5 张不可能（只有 4 种花色，且不允许重复）
    expect(
      asSets([c('S', 8), c('H', 8), c('D', 8), c('C', 8), big]),
    ).toHaveLength(0);
  });

  it('王牌模拟花色有歧义时返回多个方案', () => {
    const melds = asSets([c('S', 7), c('H', 7), big]);
    // 剩余花色 ♦ ♣，王牌可取任一
    expect(melds).toHaveLength(2);
  });

  it('A 组成的数组按 15 分计', () => {
    const melds = asSets([c('S', 1), c('H', 1), c('D', 1)]);
    expect(meldValue(melds[0] as Meld)).toBe(45);
  });
});

describe('接牌（appendOptions）', () => {
  const run: Meld = asRuns([c('S', 5), c('S', 6), c('S', 7)])[0] as Meld;
  const set: Meld = asSets([c('S', 8), c('H', 8), c('D', 8)])[0] as Meld;

  it('顺子可向右端延伸', () => {
    const options = appendOptions(run, c('S', 8));
    expect(options).toHaveLength(1);
    expect(options[0]?.meld.slots.map((s) => s.rank)).toEqual([5, 6, 7, 8]);
  });

  it('顺子可向左端延伸', () => {
    const options = appendOptions(run, c('S', 4));
    expect(options).toHaveLength(1);
    expect(options[0]?.meld.slots.map((s) => s.rank)).toEqual([4, 5, 6, 7]);
  });

  it('不能接下不相邻的牌', () => {
    expect(appendOptions(run, c('S', 9))).toHaveLength(0);
  });

  it('不能接不同花色', () => {
    expect(appendOptions(run, c('H', 8))).toHaveLength(0);
  });

  it('数组可追加未占用花色', () => {
    const options = appendOptions(set, c('C', 8));
    expect(options).toHaveLength(1);
  });

  it('数组不能追加已占用花色', () => {
    expect(appendOptions(set, c('S', 8))).toHaveLength(0);
  });

  it('数组已满 4 张时不可追加', () => {
    const full = asSets([
      c('S', 8),
      c('H', 8),
      c('D', 8),
      c('C', 8),
    ])[0] as Meld;
    expect(appendOptions(full, big)).toHaveLength(0);
  });

  it('王牌接顺子两端均可行时给出两个方案', () => {
    const options = appendOptions(run, big);
    expect(options).toHaveLength(2);
  });
});

describe('歧义与合法性聚合', () => {
  it('isLegalMeld 对合法与非法均正确', () => {
    expect(isLegalMeld([c('S', 5), c('S', 6), c('S', 7)])).toBe(true);
    expect(isLegalMeld([c('S', 5), c('H', 9), c('D', 2)])).toBe(false);
  });

  it('resolveMelds 同时包含顺子与数组的解释', () => {
    // 3 张同点不同色 → 只有 set
    expect(resolveMelds([c('S', 8), c('H', 8), c('D', 8)])).toHaveLength(1);
  });

  it('13 张同花顺存在两种合法解释（A 可居首或居尾）', () => {
    // A 可解析为 1（A,2,...,K）或 14（2,...,K,A），二者都是合法顺子，
    // 因此这里应返回 2 种解释，而非 1 种。
    const full: Card[] = [];
    for (let rank = 1; rank <= 13; rank += 1) {
      full.push(c('S', rank));
    }
    const melds = asRuns(full);
    expect(melds).toHaveLength(2);
    const rankSets = melds.map((m) => `${m.slots[0]?.rank}..${m.slots[12]?.rank}`);
    expect(new Set(rankSets)).toEqual(new Set(['1..13', '2..14']));
  });

  it('A-2-3 与 Q-K-A 不共存于同一条顺子时只给一种解释', () => {
    // 只取 3..K 再加 A，A 只能居尾
    const cards: Card[] = [c('S', 1)];
    for (let rank = 3; rank <= 13; rank += 1) {
      cards.push(c('S', rank));
    }
    const melds = asRuns(cards);
    expect(melds).toHaveLength(1);
  });
});
