import { describe, expect, it } from 'vitest';
import { handTotal, jokerCard, normalCard } from './cards';
import { asRuns, asSets, type Meld } from './meld';
import {
  isMatchOver,
  matchOutcome,
  pointsToNextTier,
  ratingDelta,
  roundScore,
  tableScoreOf,
  tierOf,
} from './scoring';

describe('手牌分值', () => {
  it('A=15、K/Q/J/10=10、其余面值', () => {
    expect(handTotal([normalCard('S', 1)])).toBe(15);
    expect(handTotal([normalCard('S', 13)])).toBe(10);
    expect(handTotal([normalCard('S', 10)])).toBe(10);
    expect(handTotal([normalCard('S', 9)])).toBe(9);
    expect(handTotal([normalCard('S', 2)])).toBe(2);
  });

  it('王牌在手按 K 计 10 分', () => {
    expect(handTotal([jokerCard('big')])).toBe(10);
    expect(handTotal([jokerCard('small')])).toBe(10);
  });
});

describe('一轮结算', () => {
  it('出完手牌时得分为桌面分，无额外奖励', () => {
    expect(roundScore(40, [])).toBe(40);
  });

  it('未出完时扣除手牌分，可为负', () => {
    expect(roundScore(10, [normalCard('S', 1)])).toBe(-5);
  });

  it('桌面分按阵营归属，不按出牌者', () => {
    const playerMeld = asRuns([
      normalCard('S', 5),
      normalCard('S', 6),
      normalCard('S', 7),
    ])[0] as Meld;
    const aiMeld = asSets([
      normalCard('H', 8),
      normalCard('D', 8),
      normalCard('C', 8),
    ])[0] as Meld;
    const table = [
      { owner: 'player' as const, meld: playerMeld },
      { owner: 'ai' as const, meld: aiMeld },
    ];
    expect(tableScoreOf(table, 'player')).toBe(18);
    expect(tableScoreOf(table, 'ai')).toBe(24);
  });
});

describe('一局判定', () => {
  it('任一方达到 500 即结束', () => {
    expect(isMatchOver(500, 100)).toBe(true);
    expect(isMatchOver(499, 499)).toBe(false);
  });

  it('胜负与平局', () => {
    expect(matchOutcome(520, 510)).toBe('win');
    expect(matchOutcome(500, 540)).toBe('lose');
    expect(matchOutcome(500, 500)).toBe('draw');
  });

  it('积分变化 +5 / -3', () => {
    expect(ratingDelta('win')).toBe(5);
    expect(ratingDelta('lose')).toBe(-3);
  });
});

describe('段位', () => {
  it('负分为黑铁', () => {
    expect(tierOf(-1).key).toBe('tier.iron');
    expect(tierOf(-100).key).toBe('tier.iron');
  });

  it('青铜 III 起步', () => {
    expect(tierOf(0)).toMatchObject({ key: 'tier.bronze3', stars: 0 });
    expect(tierOf(49).key).toBe('tier.bronze3');
    expect(tierOf(50).key).toBe('tier.bronze2');
  });

  it('各档位边界', () => {
    expect(tierOf(149).key).toBe('tier.bronze1');
    expect(tierOf(150).key).toBe('tier.silver3');
    expect(tierOf(299).key).toBe('tier.silver1');
    expect(tierOf(300).key).toBe('tier.gold3');
    expect(tierOf(449).key).toBe('tier.gold1');
    expect(tierOf(450).key).toBe('tier.platinum');
    expect(tierOf(499).key).toBe('tier.platinum');
  });

  it('钻石 500 起为 0 星', () => {
    expect(tierOf(500)).toMatchObject({ key: 'tier.diamond', stars: 0 });
    expect(tierOf(549).stars).toBe(0);
  });

  it('钻石每 50 分 +1 星：550 与 599 同为一星', () => {
    expect(tierOf(550).stars).toBe(1);
    expect(tierOf(599).stars).toBe(1);
  });

  it('600 为两星', () => {
    expect(tierOf(600).stars).toBe(2);
    expect(tierOf(650).stars).toBe(3);
  });

  it('钻石无上限', () => {
    expect(tierOf(5000).stars).toBeGreaterThan(80);
  });

  it('距下一段位的差额', () => {
    expect(pointsToNextTier(32)).toBe(18);
    expect(pointsToNextTier(0)).toBe(50);
    expect(pointsToNextTier(550)).toBe(50);
    expect(pointsToNextTier(-20)).toBe(20);
  });
});
