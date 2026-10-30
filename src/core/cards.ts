/**
 * 牌的定义与分值。
 *
 * 关键设计：A 有双重身份。
 * - 作为最大牌参与顺子（Q-K-A）时，解析点数记为 14，计 15 分。
 * - 作为最小牌参与顺子（A-2-3）时，解析点数记为 1，计 1 分。
 * 因此「分值」不是牌的固有属性，而是「牌在组合中的角色」的属性，
 * 计分必须基于 ResolvedCard 而非 RawCard。
 */

/** 花色 */
export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];

/** 对局双方 */
export type Side = 'player' | 'ai';

/**
 * AI 强度档位 L0..L5。
 * 定义在最底层的 cards 模块，供 engine / view / ai 共同引用，
 * 避免出现「core 反向依赖 ai」或「view 与 engine 循环引用」。
 */
export type Intensity = 0 | 1 | 2 | 3 | 4 | 5;

export function otherSide(side: Side): Side {
  return side === 'player' ? 'ai' : 'player';
}

/** 自然点数 1..13：A=1, J=11, Q=12, K=13 */
export type Rank = number;

/** 解析点数 1..14：A 低位=1，A 高位=14 */
export type ResolvedRank = number;

export const ACE_LOW = 1;
export const ACE_HIGH = 14;
export const KING = 13;

export type NormalCard = {
  readonly kind: 'normal';
  readonly id: string;
  readonly suit: Suit;
  readonly rank: Rank;
};

export type JokerCard = {
  readonly kind: 'joker';
  readonly id: string;
  readonly joker: 'big' | 'small';
};

export type Card = NormalCard | JokerCard;

export function isJoker(card: Card): card is JokerCard {
  return card.kind === 'joker';
}

export function isNormal(card: Card): card is NormalCard {
  return card.kind === 'normal';
}

/** 牌的唯一标识，形如 `S1`（黑桃A）、`JOKER_BIG` */
export function cardId(card: Card): string {
  return card.id;
}

export function normalCard(suit: Suit, rank: Rank): NormalCard {
  return { kind: 'normal', id: `${suit}${rank}`, suit, rank };
}

export const JOKER_BIG_ID = 'JOKER_BIG';
export const JOKER_SMALL_ID = 'JOKER_SMALL';

export function jokerCard(joker: 'big' | 'small'): JokerCard {
  return {
    kind: 'joker',
    id: joker === 'big' ? JOKER_BIG_ID : JOKER_SMALL_ID,
    joker,
  };
}

/** 生成一副 54 张牌（52 + 大王 + 小王），顺序确定，便于测试 */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = ACE_LOW; rank <= KING; rank += 1) {
      deck.push(normalCard(suit, rank));
    }
  }
  deck.push(jokerCard('small'));
  deck.push(jokerCard('big'));
  return deck;
}

export const DECK_SIZE = 54;
export const HAND_SIZE = 10;

/**
 * 王牌在手的分值：按 K 计，即 10 分。
 * 目的：抑制囤积，鼓励尽早打出百变牌。
 */
export const JOKER_HAND_VALUE = 10;

/** 自然牌在手中的分值：A=15，K/Q/J/10=10，其余按面值 */
export function handValue(card: Card): number {
  if (isJoker(card)) {
    return JOKER_HAND_VALUE;
  }
  if (card.rank === ACE_LOW) {
    return 15;
  }
  if (card.rank >= 10) {
    return 10;
  }
  return card.rank;
}

/** 组合中单张牌（按解析点数）的分值 */
export function resolvedValue(rank: ResolvedRank): number {
  if (rank === ACE_HIGH) {
    return 15;
  }
  if (rank === ACE_LOW) {
    return 1;
  }
  if (rank >= 10) {
    return 10;
  }
  return rank;
}

/** 双方手牌分值合计 */
export function handTotal(cards: readonly Card[]): number {
  return cards.reduce((sum, card) => sum + handValue(card), 0);
}

/** 自然牌可能的解析点数集合：A 可为 1 或 14 */
export function resolvedRanksFor(card: NormalCard): ResolvedRank[] {
  return card.rank === ACE_LOW ? [ACE_LOW, ACE_HIGH] : [card.rank];
}

/** 解析点数对应的可读文案，用于 UI 与调试 */
export function rankLabel(rank: ResolvedRank): string {
  switch (rank) {
    case ACE_LOW:
    case ACE_HIGH:
      return 'A';
    case 11:
      return 'J';
    case 12:
      return 'Q';
    case KING:
      return 'K';
    default:
      return String(rank);
  }
}
