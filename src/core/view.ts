/**
 * 只读视图：`GameState` 的唯一对外投影。
 *
 * 信息公平的运行时保障（docs/技术方案.md 第 8 节第 3 层）：
 * `GameView` 结构上**不包含牌堆内容**，只暴露剩余张数。
 * AI 与 UI 都只消费本类型，因此「AI 读牌堆」在类型层面即不可能发生。
 *
 * 返回对象经深冻结，防止通过引用穿透回 `GameState`。
 */

import type { Card, Intensity, Side } from './cards';
import { appendOptions, isLegalMeld, type Meld } from './meld';

export type { Intensity };
import type {
  GameState,
  MatchResult,
  MeldOnTable,
  Phase,
  RoundResult,
} from './engine';

export type HandView = {
  readonly cards: readonly Card[];
  /** 每张牌此刻是否可以打出（亮牌或接牌），由 core 计算，UI 不自行推断 */
  readonly playable: Readonly<Record<string, boolean>>;
};

export type TableMeldView = {
  readonly id: string;
  readonly owner: Side;
  readonly meld: Meld;
};

export type GameView = {
  readonly phase: Phase;
  readonly turn: Side;
  readonly roundIndex: number;
  readonly opponentNameIndex: number;
  readonly deckCount: number;
  readonly discard: readonly Card[];
  /**
   * 弃牌堆中每张牌是否「可取」（取走后能立刻组成组合）。
   * 仅对玩家当前回合有意义；轮到对手或非 draw 阶段时为空。
   */
  readonly discardPlayable: Readonly<Record<string, boolean>>;
  /** 自己完整手牌；对手仅张数 */
  readonly me: HandView;
  readonly opponentHandCount: number;
  readonly table: readonly TableMeldView[];
  /** 本局双方的累计得分 */
  readonly totals: Readonly<Record<Side, number>>;
  readonly lastRound: RoundResult | null;
  readonly lastMatch: MatchResult | null;
  readonly canUndo: boolean;
  readonly intensity: Intensity;
  /** 先手判定时公开的牌 */
  readonly starterReveal: Card | null;
  /**
   * 本回合刚取到的牌 id（公开信息：这张牌是从牌堆或弃牌堆取的，双方都看得见）。
   * 规则禁止把它直接弃回弃牌堆，UI 需据此禁用该牌，AI 也据此规避。
   */
  readonly drawnCardId: string | null;
  /** 深层收取时必须先亮出组合的牌 id；非空时禁止弃牌 */
  readonly mustMeldCardId: string | null;
};

export type ViewOptions = {
  /** 以谁的视角生成视图 */
  readonly side: Side;
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== null && typeof child === 'object') {
        deepFreeze(child);
      }
    }
  }
  return value;
}

/**
 * 计算手牌中每张牌是否可打出。
 * 规则：可与其他手牌组成合法组合，或可接到桌面任一组合。
 */
function computePlayable(
  hand: readonly Card[],
  table: readonly MeldOnTable[],
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const card of hand) {
    // 可直接接到桌面
    const canLayOff = table.some(
      (item) => appendOptions(item.meld, card).length > 0,
    );
    if (canLayOff) {
      result[card.id] = true;
      continue;
    }
    // 或能与手牌中另外两张组成组合
    let found = false;
    const others = hand.filter((item) => item.id !== card.id);
    for (let i = 0; i < others.length && !found; i += 1) {
      for (let j = i + 1; j < others.length && !found; j += 1) {
        const a = others[i];
        const b = others[j];
        if (a === undefined || b === undefined) {
          continue;
        }
        if (isLegalMeld([card, a, b])) {
          found = true;
        }
      }
    }
    result[card.id] = found;
  }
  return result;
}

/**
 * 弃牌堆中每张牌是否「可取」。顶牌可直接拿；历史牌必须能立即组成组合/接牌。
 */
function computeDiscardPlayable(
  hand: readonly Card[],
  discard: readonly Card[],
  table: readonly MeldOnTable[],
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  discard.forEach((card, index) => {
    const isTop = index === discard.length - 1;
    // 弃牌堆顶牌可直接取（无需立刻成组），中间牌需立刻成组。
    if (isTop) {
      result[card.id] = true;
      return;
    }
    // 指定牌与其上方的连带牌、原手牌都可参与同一组合。
    const takenAbove = discard.slice(index + 1);
    const available = [...hand, ...takenAbove];
    const others = available.filter((candidate) => candidate.id !== card.id);
    let found = false;
    for (let i = 0; i < others.length && !found; i += 1) {
      for (let j = i + 1; j < others.length && !found; j += 1) {
        const a = others[i];
        const b = others[j];
        if (a === undefined || b === undefined) continue;
        if (isLegalMeld([card, a, b])) {
          found = true;
          break;
        }
      }
    }
    if (!found) {
      found = table.some((item) => appendOptions(item.meld, card).length > 0);
    }
    result[card.id] = found;
  });
  return result;
}

export function toGameView(
  state: GameState,
  options: ViewOptions,
): GameView {
  const me = options.side;
  const opponent = me === 'player' ? 'ai' : 'player';
  const myHand = state.hands[me];

  const table: TableMeldView[] = state.table.map((item) => ({
    id: item.id,
    owner: item.owner,
    meld: item.meld,
  }));

  const view: GameView = {
    phase: state.phase,
    turn: state.turn,
    roundIndex: state.roundIndex,
    // 只暴露张数，绝不暴露内容
    deckCount: state.deck.length,
    discard: state.discard.map((card) => card),
    opponentNameIndex: state.opponentNameIndex,
    // 弃牌高亮只在「轮到自己的取牌阶段」才有意义；
    // 进入 play 阶段（已取牌）后不再高亮，避免误以为还能取弃牌。
    discardPlayable:
      state.phase === 'draw' && state.turn === me
        ? computeDiscardPlayable(myHand, state.discard, state.table)
        : {},
    me: {
      cards: myHand.map((card) => card),
      playable: computePlayable(myHand, state.table),
    },
    opponentHandCount: state.hands[opponent].length,
    table,
    totals: {
      player: state.playerTotal,
      ai: state.aiTotal,
    },
    lastRound: state.lastRound,
    lastMatch: state.lastMatch,
    canUndo: state.undoStack.length > 0,
    intensity: state.intensity,
    starterReveal: state.starterReveal,
    drawnCardId: state.drawnCardId,
    mustMeldCardId: state.mustMeldCardId,
  };
  return deepFreeze(view);
}
