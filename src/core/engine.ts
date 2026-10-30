/**
 * 对局状态机（纯函数 reducer）。
 *
 * 设计约束：
 * - 零 DOM、零框架依赖，可直接单测与回放。
 * - 所有随机性走可序列化的 RNG 状态，保证存档后序列一致。
 * - 每次成功动作产出一条 `ActionLog`，供 UI 回放动画，避免 UI 自行推断轨迹。
 */

import {
  DECK_SIZE,
  HAND_SIZE,
  handTotal,
  isJoker,
  makeDeck,
  otherSide,
  type Card,
  type Intensity,
  type Side,
} from './cards';
import {
  appendOptions,
  isMeldFull,
  meldValue,
  resolveMelds,
} from './meld';
import { shuffle } from './rng';
import {
  TARGET_SCORE,
  isMatchOver,
  matchOutcome,
  roundScore,
  type MeldOwner,
} from './scoring';

export const ENGINE_VERSION = 2;

export type Phase =
  | 'draw' // 等待当前玩家取牌
  | 'play' // 已取牌，可亮牌/接牌/弃牌
  | 'roundEnd' // 一轮结束，等待确认
  | 'matchEnd'; // 一局结束，等待确认

export type MeldOnTable = MeldOwner & { readonly id: string };

export type RoundEndReason =
  | 'handEmptied'
  | 'jokerLock'
  | 'noLegalMove'
  /** 牌堆抽空且无法再取牌，本轮结束（类似炉石疲劳） */
  | 'deckExhausted';

export type RoundResult = {
  readonly playerTableScore: number;
  readonly aiTableScore: number;
  readonly playerHandScore: number;
  readonly aiHandScore: number;
  readonly playerRoundScore: number;
  readonly aiRoundScore: number;
  readonly reason: RoundEndReason;
};

export type MatchResult = {
  readonly playerTotal: number;
  readonly aiTotal: number;
  readonly outcome: 'win' | 'lose' | 'draw';
};

export type GameState = {
  readonly version: number;
  readonly phase: Phase;
  readonly turn: Side;
  /** 先手方，用于轮末交换 */
  readonly starter: Side;
  /** 牌堆，索引 0 为顶 */
  readonly deck: readonly Card[];
  readonly discard: readonly Card[];
  readonly hands: Readonly<Record<Side, readonly Card[]>>;
  readonly table: readonly MeldOnTable[];
  readonly playerTotal: number;
  readonly aiTotal: number;
  readonly roundIndex: number;
  readonly rng: number;
  readonly lastRound: RoundResult | null;
  readonly lastMatch: MatchResult | null;
  /** 开局判定的牌（公开可见），UI 用于展示先手判定过程 */
  readonly starterReveal: Card | null;
  /** 动作栈，用于回合内撤销 */
  readonly undoStack: readonly GameState[];
  /** 是否已在本回合取过牌 */
  readonly drewThisTurn: boolean;
  /** AI 强度档位快照，读档不得重算 */
  readonly intensity: Intensity;
  /**
   * 本回合是否已经取过牌。
   * 用于约束「刚摸到的牌不能再弃回弃牌堆」，
   * 防止双方在弃牌堆上来回搬运同一张牌（见 README「回合流程」）。
   */
  readonly drawnCardId: string | null;
  /** 每局随机确定的对手昵称序号，存档后继续保持一致。 */
  readonly opponentNameIndex: number;
  /**
   * 深层收取时必须立刻成组的牌 id。
   * 深层取牌采用原子动作直接把指定牌用于组合，此字段保留为 null 兼容存档结构。
   */
  readonly mustMeldCardId: string | null;
};

// ------------------------------------------------------------ 构造

function splitHands(
  deck: readonly Card[],
): [Record<Side, Card[]>, Card[]] {
  const playerHand = deck.slice(0, HAND_SIZE);
  const aiHand = deck.slice(HAND_SIZE, HAND_SIZE * 2);
  return [
    { player: playerHand, ai: aiHand },
    deck.slice(HAND_SIZE * 2),
  ];
}

/**
 * 判定先手：抽牌看奇偶。
 * A/3/5/7/9/J/K 为奇 → AI 先；偶数 → 玩家先。
 * 小王 = 奇（AI），大王 = 偶（玩家）。
 */
export function judgeStarter(card: Card): Side {
  if (isJoker(card)) {
    return card.joker === 'small' ? 'ai' : 'player';
  }
  return card.rank % 2 === 1 ? 'ai' : 'player';
}

export type NewGameOptions = {
  readonly seed: number;
  readonly intensity?: Intensity;
};

export function createGame(options: NewGameOptions): GameState {
  const [shuffled, rng] = shuffle(makeDeck(), options.seed);
  const reveal = shuffled[0];
  const starter = reveal === undefined ? 'player' : judgeStarter(reveal);
  const [hands, rest] = splitHands(shuffled);

  return {
    version: ENGINE_VERSION,
    phase: 'draw',
    turn: starter,
    starter,
    deck: rest,
    discard: [],
    hands,
    table: [],
    playerTotal: 0,
    aiTotal: 0,
    roundIndex: 1,
    rng,
    lastRound: null,
    lastMatch: null,
    starterReveal: reveal ?? null,
    opponentNameIndex: Math.abs(rng) % 8,
    undoStack: [],
    drewThisTurn: false,
    intensity: options.intensity ?? 0,
    drawnCardId: null,
    mustMeldCardId: null,
  };
}

// ------------------------------------------------------------ 动作

export type Action =
  | { readonly type: 'drawDeck' }
  | { readonly type: 'takeDiscardTop' }
  | { readonly type: 'takeDiscardDeep'; readonly cardId: string }
  | {
      readonly type: 'meld';
      readonly cardIds: readonly string[];
      /** 当存在歧义时由 UI 指定选中的解释索引 */
      readonly meldIndex?: number;
    }
  | {
      readonly type: 'layOff';
      readonly meldId: string;
      readonly cardId: string;
      /** 王牌追加时选择的位置索引 */
      readonly optionIndex?: number;
    }
  | { readonly type: 'discard'; readonly cardId: string }
  | { readonly type: 'undo' }
  | { readonly type: 'confirmRound' }
  | { readonly type: 'confirmMatch' };

export type ActionLog =
  | { readonly kind: 'draw'; readonly side: Side; readonly card: Card }
  | {
      readonly kind: 'takeDiscard';
      readonly side: Side;
      readonly cards: readonly Card[];
    }
  | { readonly kind: 'meld'; readonly side: Side; readonly meldId: string }
  | {
      readonly kind: 'layOff';
      readonly side: Side;
      readonly meldId: string;
      readonly card: Card;
    }
  | { readonly kind: 'discard'; readonly side: Side; readonly card: Card }
  | { readonly kind: 'roundEnd'; readonly result: RoundResult };

export type ReduceResult =
  | { readonly ok: true; readonly state: GameState; readonly logs: readonly ActionLog[] }
  | { readonly ok: false; readonly error: string };

function fail(error: string): ReduceResult {
  return { ok: false, error };
}

function ok(
  state: GameState,
  logs: readonly ActionLog[] = [],
): ReduceResult {
  return { ok: true, state, logs };
}

function handOf(state: GameState, side: Side): readonly Card[] {
  return state.hands[side];
}

function withoutCards(
  hand: readonly Card[],
  ids: readonly string[],
): Card[] {
  const remove = new Set(ids);
  return hand.filter((card) => !remove.has(card.id));
}

function findCard(hand: readonly Card[], id: string): Card | undefined {
  return hand.find((card) => card.id === id);
}

/** 逆时针推进到对方（2 人局即交替） */
function nextTurn(side: Side): Side {
  return otherSide(side);
}

export function reduce(state: GameState, action: Action): ReduceResult {
  switch (action.type) {
    case 'drawDeck':
      return doDraw(state);
    case 'takeDiscardTop':
      return doTakeDiscardTop(state);
    case 'takeDiscardDeep':
      return doTakeDiscardDeep(state, action.cardId);
    case 'meld':
      return doMeld(state, action.cardIds, action.meldIndex);
    case 'layOff':
      return doLayOff(state, action.meldId, action.cardId, action.optionIndex);
    case 'discard':
      return doDiscard(state, action.cardId);
    case 'undo':
      return doUndo(state);
    case 'confirmRound':
      return doConfirmRound(state);
    case 'confirmMatch':
      return doConfirmMatch(state);
  }
}

function doDraw(state: GameState): ReduceResult {
  if (state.phase !== 'draw') {
    return fail('当前阶段不能取牌');
  }
  const top = state.deck[0];
  // 牌堆不做洗回：摸空即本轮结束（类似炉石抽空卡堆）。
  // 这条规则同时也是收敛性保证——若允许洗回，双方都不出牌时会无限循环。
  if (top === undefined) {
    return finishRound(state, state.turn, 'deckExhausted', []);
  }
  const side = state.turn;
  const next: GameState = {
    ...state,
    deck: state.deck.slice(1),
    hands: { ...state.hands, [side]: [...handOf(state, side), top] },
    phase: 'play',
    drewThisTurn: true,
    // 从牌堆摸的牌可以正常弃出，不需要禁止弃回。
    // 只有「从弃牌堆取的那张牌」才要求立刻成组、禁止弃回（见 doTakeDiscardTop）。
    drawnCardId: null,
    mustMeldCardId: null,
  };
  return ok(withUndo(state, next), [{ kind: 'draw', side, card: top }]);
}

/** 回合内操作前压栈，供撤销使用 */
function withUndo(previous: GameState, next: GameState): GameState {
  return { ...next, undoStack: [...previous.undoStack, previous] };
}

function doTakeDiscardTop(state: GameState): ReduceResult {
  if (state.phase !== 'draw') {
    return fail('当前阶段不能取牌');
  }
  const topIndex = state.discard.length - 1;
  const top = state.discard[topIndex];
  if (top === undefined) {
    return fail('弃牌堆为空');
  }
  const side = state.turn;
  // 规则：取弃牌堆顶牌**不需要**立刻成组（可像摸牌一样正常取）。
  // 但只要是「从弃牌堆取的牌」，本回合一律禁止弃回（drawnCardId 标记）。
  const nextHand = [...handOf(state, side), top];
  const next: GameState = {
    ...state,
    discard: state.discard.slice(0, topIndex),
    hands: { ...state.hands, [side]: nextHand },
    phase: 'play',
    drewThisTurn: true,
    drawnCardId: top.id,
    // 取顶牌无需立刻成组，不设强制亮牌标记
    mustMeldCardId: null,
  };
  return ok(withUndo(state, next), [{ kind: 'takeDiscard', side, cards: [top] }]);
}

function doTakeDiscardDeep(
  state: GameState,
  cardId: string,
): ReduceResult {
  if (state.phase !== 'draw') {
    return fail('当前阶段不能取牌');
  }
  const index = state.discard.findIndex((card) => card.id === cardId);
  if (index < 0) {
    return fail('弃牌堆中没有该牌');
  }
  const taken = state.discard.slice(index);
  const target = taken[0];
  if (target === undefined) {
    return fail('弃牌堆中没有该牌');
  }
  const side = state.turn;
  const hand = handOf(state, side);
  const incomingHand = taken.slice(1);

  // 指定牌必须在本动作直接参与组合。可用牌包括原手牌及指定牌上方的连带牌；
  // 组合中实际使用的连带牌直接上桌，未使用的连带牌才收入手牌。
  const available = [...hand, ...incomingHand];
  for (let i = 0; i < available.length; i += 1) {
    for (let j = i + 1; j < available.length; j += 1) {
      const a = available[i];
      const b = available[j];
      if (a === undefined || b === undefined) continue;
      const meld = resolveMelds([target, a, b])[0];
      if (meld === undefined) continue;

      const usedIds = new Set([target.id, a.id, b.id]);
      const meldId = `m${state.roundIndex}-${state.table.length}-${side}`;
      const remainingHand = [
        ...withoutCards(hand, [...usedIds]),
        ...incomingHand.filter((card) => !usedIds.has(card.id)),
      ];
      const next: GameState = {
        ...state,
        discard: state.discard.slice(0, index),
        hands: { ...state.hands, [side]: remainingHand },
        table: [...state.table, { id: meldId, owner: side, meld }],
        phase: 'play',
        drewThisTurn: true,
        drawnCardId: null,
        mustMeldCardId: null,
      };
      return afterPlayAction(state, withUndo(state, next), side, [
        { kind: 'takeDiscard', side, cards: taken },
        { kind: 'meld', side, meldId },
      ]);
    }
  }

  for (const tableMeld of state.table) {
    const append = appendOptions(tableMeld.meld, target)[0];
    if (append === undefined) continue;
    const next: GameState = {
      ...state,
      discard: state.discard.slice(0, index),
      hands: {
        ...state.hands,
        [side]: [...hand, ...incomingHand],
      },
      table: state.table.map((item) =>
        item.id === tableMeld.id ? { ...item, meld: append.meld } : item,
      ),
      phase: 'play',
      drewThisTurn: true,
      drawnCardId: null,
      mustMeldCardId: null,
    };
    return afterPlayAction(state, withUndo(state, next), side, [
      { kind: 'takeDiscard', side, cards: taken },
      { kind: 'layOff', side, meldId: tableMeld.id, card: target },
    ]);
  }

  return fail('该牌无法立刻组成组合');
}

function doMeld(
  state: GameState,
  cardIds: readonly string[],
  meldIndex: number | undefined,
): ReduceResult {
  if (state.phase !== 'play') {
    return fail('必须先取牌');
  }
  if (cardIds.length < 3) {
    return fail('组合至少需要 3 张牌');
  }
  const side = state.turn;
  const hand = handOf(state, side);
  const cards: Card[] = [];
  for (const id of cardIds) {
    const card = findCard(hand, id);
    if (card === undefined) {
      return fail('手牌中没有该牌');
    }
    cards.push(card);
  }
  const options = resolveMelds(cards);
  if (options.length === 0) {
    return fail('这些牌无法组成合法组合');
  }
  const chosen = options[meldIndex ?? 0];
  if (chosen === undefined) {
    return fail('无效的组合解释');
  }
  const meldId = `m${state.roundIndex}-${state.table.length}-${side}`;
  // 若亮出的组合包含「必须成组打出的牌」，清除强制标记
  const clearedMustMeld =
    state.mustMeldCardId !== null && cardIds.includes(state.mustMeldCardId)
      ? null
      : state.mustMeldCardId;
  const next: GameState = {
    ...state,
    hands: { ...state.hands, [side]: withoutCards(hand, cardIds) },
    table: [...state.table, { id: meldId, owner: side, meld: chosen }],
    mustMeldCardId: clearedMustMeld,
  };
  return afterPlayAction(
    state,
    withUndo(state, next),
    side,
    [{ kind: 'meld', side, meldId }],
  );
}

function doLayOff(
  state: GameState,
  meldId: string,
  cardId: string,
  optionIndex: number | undefined,
): ReduceResult {
  if (state.phase !== 'play') {
    return fail('必须先取牌');
  }
  const side = state.turn;
  const hand = handOf(state, side);
  const card = findCard(hand, cardId);
  if (card === undefined) {
    return fail('手牌中没有该牌');
  }
  const target = state.table.find((item) => item.id === meldId);
  if (target === undefined) {
    return fail('目标组合不存在');
  }
  if (isMeldFull(target.meld)) {
    return fail('该组合已满');
  }
  const options = appendOptions(target.meld, card);
  const chosen = options[optionIndex ?? 0];
  if (chosen === undefined) {
    return fail('无法接牌');
  }
  // 深层收取的牌要求「必须立刻用于组成组合」。接牌同样属于组成组合，
  // 因此当被接出去的正是那张牌时必须清除强制标记——否则玩家接完牌
  // 仍无法弃牌、无法结束回合，只能撤销，形成死锁。
  const clearedMustMeld =
    state.mustMeldCardId === cardId ? null : state.mustMeldCardId;
  const next: GameState = {
    ...state,
    hands: { ...state.hands, [side]: withoutCards(hand, [cardId]) },
    // 重要：分值按「阵营」归属，接牌后组合仍归原主
    table: state.table.map((item) =>
      item.id === meldId ? { ...item, meld: chosen.meld } : item,
    ),
    mustMeldCardId: clearedMustMeld,
  };
  return afterPlayAction(
    state,
    withUndo(state, next),
    side,
    [{ kind: 'layOff', side, meldId, card }],
  );
}

function doDiscard(state: GameState, cardId: string): ReduceResult {
  if (state.phase !== 'play') {
    return fail('必须先取牌');
  }
  const side = state.turn;
  const hand = handOf(state, side);
  const card = findCard(hand, cardId);
  if (card === undefined) {
    return fail('手牌中没有该牌');
  }
  if (isJoker(card)) {
    return fail('不允许弃出王牌');
  }
  // 约束：本回合刚摸到的牌不允许直接弃回弃牌堆，
  // 否则双方可以在弃牌堆上来回搬运同一张牌，形成无限循环。
  if (state.drawnCardId === cardId) {
    return fail('本回合刚取到的牌不能直接弃回');
  }
  // 深层收取的牌必须立刻成组打出：未亮出包含它的组合前禁止弃牌
  if (state.mustMeldCardId !== null) {
    return fail('深层收取的牌必须立刻亮出组合');
  }

  const remaining = withoutCards(hand, [cardId]);
  const next: GameState = {
    ...state,
    hands: { ...state.hands, [side]: remaining },
    discard: [...state.discard, card],
    turn: nextTurn(side),
    phase: 'draw',
    drewThisTurn: false,
    drawnCardId: null,
    mustMeldCardId: null,
    undoStack: [],
  };
  const logs: ActionLog[] = [{ kind: 'discard', side, card }];

  // 出完手牌 → 立即结算
  if (remaining.length === 0) {
    return finishRound(next, side, 'handEmptied', logs);
  }
  // 无合法动作 → 卡死
  if (!hasLegalMove(next)) {
    return finishRound(next, side, 'noLegalMove', logs);
  }
  return ok(next, logs);
}

/**
 * 亮牌/接牌之后的统一收尾。
 *
 * 关键：手牌可能通过「亮牌」或「接牌」被清空，而不是通过弃牌。
 * 规则要求「出完手牌立即结束本轮，无需弃牌」，因此必须在这里判定，
 * 否则会出现 hand=0 却停留在 play 阶段、无牌可弃的死锁。
 */
function afterPlayAction(
  _previous: GameState,
  next: GameState,
  side: Side,
  logs: ActionLog[],
): ReduceResult {
  if (handOf(next, side).length === 0) {
    return finishRound(next, side, 'handEmptied', logs);
  }
  if (!hasLegalMove(next)) {
    return finishRound(next, side, 'noLegalMove', logs);
  }
  return ok(next, logs);
}

function doUndo(state: GameState): ReduceResult {
  const stack = state.undoStack;
  if (stack.length === 0) {
    return fail('没有可撤销的操作');
  }
  const previous = stack[stack.length - 1];
  if (previous === undefined) {
    return fail('没有可撤销的操作');
  }
  return ok({ ...previous, undoStack: stack.slice(0, -1) });
}

function doConfirmRound(state: GameState): ReduceResult {
  if (state.phase !== 'roundEnd' || state.lastRound === null) {
    return fail('当前没有待确认的轮次结算');
  }
  const playerTotal = state.playerTotal;
  const aiTotal = state.aiTotal;
  if (isMatchOver(playerTotal, aiTotal)) {
    return ok({
      ...state,
      phase: 'matchEnd',
      lastMatch: {
        playerTotal,
        aiTotal,
        outcome: matchOutcome(playerTotal, aiTotal),
      },
    });
  }
  return ok(startNextRound(state));
}

function doConfirmMatch(state: GameState): ReduceResult {
  if (state.phase !== 'matchEnd' || state.lastMatch === null) {
    return fail('当前没有待确认的局末结算');
  }
  if (state.lastMatch.outcome === 'draw') {
    // 平局：加赛一轮
    return ok(startNextRound(state));
  }
  return ok({
    ...state,
    phase: 'matchEnd',
  });
}

function startNextRound(state: GameState): GameState {
  const [shuffled, rng] = shuffle(makeDeck(), state.rng);
  const [hands, rest] = splitHands(shuffled);
  const starter = nextTurn(state.starter);
  return {
    ...state,
    phase: 'draw',
    turn: starter,
    starter,
    deck: rest,
    discard: [],
    hands,
    table: [],
    roundIndex: state.roundIndex + 1,
    rng,
    lastRound: null,
    undoStack: [],
    drewThisTurn: false,
    starterReveal: null,
    drawnCardId: null,
    mustMeldCardId: null,
  };
}

function finishRound(
  state: GameState,
  _by: Side,
  reason: RoundEndReason,
  logs: ActionLog[],
): ReduceResult {
  const playerTable = tableScore(state, 'player');
  const aiTable = tableScore(state, 'ai');
  const playerHand = handOf(state, 'player');
  const aiHand = handOf(state, 'ai');
  const playerRound = roundScore(playerTable, playerHand);
  const aiRound = roundScore(aiTable, aiHand);

  const result: RoundResult = {
    playerTableScore: playerTable,
    aiTableScore: aiTable,
    playerHandScore: handTotal(playerHand),
    aiHandScore: handTotal(aiHand),
    playerRoundScore: playerRound,
    aiRoundScore: aiRound,
    reason,
  };

  const next: GameState = {
    ...state,
    phase: 'roundEnd',
    playerTotal: state.playerTotal + playerRound,
    aiTotal: state.aiTotal + aiRound,
    lastRound: result,
    undoStack: [],
  };
  return ok(next, [...logs, { kind: 'roundEnd', result }]);
}

function tableScore(state: GameState, side: Side): number {
  return state.table
    .filter((item) => item.owner === side)
    .reduce((sum, item) => sum + meldValue(item.meld), 0);
}

/**
 * 是否存在合法动作。
 * 用于「无合法动作 → 本轮结束」的判定（王牌卡死 / 牌堆耗尽）。
 */
export function hasLegalMove(state: GameState): boolean {
  if (state.phase === 'play') {
    const side = state.turn;
    const hand = handOf(state, side);
    if (hand.some((card) => !isJoker(card))) {
      return true;
    }
    // 只剩王牌：能接就还能动，否则卡死
    return hand.some((card) =>
      state.table.some((item) => appendOptions(item.meld, card).length > 0),
    );
  }
  if (state.phase === 'draw') {
    if (state.deck.length > 0) {
      return true;
    }
    return state.discard.length > 0;
  }
  return false;
}

/** 供 UI 与结算使用：牌堆剩余张数（AI 允许知道） */
export function deckCount(state: GameState): number {
  return state.deck.length;
}

export const TOTAL_CARDS = DECK_SIZE;
export const TARGET = TARGET_SCORE;
