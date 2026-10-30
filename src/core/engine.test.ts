import { describe, expect, it } from 'vitest';
import { DECK_SIZE, normalCard } from './cards';
import { asRuns } from './meld';
import {
  createGame,
  hasLegalMove,
  judgeStarter,
  reduce,
  type GameState,
} from './engine';
import { toGameView } from './view';
import { jokerCard } from './cards';

const SEED = 12345;

function newGame(seed = SEED): GameState {
  return createGame({ seed });
}

describe('发牌与开局', () => {
  it('发牌后双方各 10 张，牌数守恒 54', () => {
    const state = newGame();
    expect(state.hands.player).toHaveLength(10);
    expect(state.hands.ai).toHaveLength(10);
    const total =
      state.deck.length +
      state.discard.length +
      state.hands.player.length +
      state.hands.ai.length;
    // 先手判定牌已放回牌堆，故总数为 54
    expect(total).toBe(DECK_SIZE);
  });

  it('相同 seed 产生相同牌局（可复现）', () => {
    const a = newGame(777);
    const b = newGame(777);
    expect(a.hands.player.map((c) => c.id)).toEqual(
      b.hands.player.map((c) => c.id),
    );
    expect(a.hands.ai.map((c) => c.id)).toEqual(b.hands.ai.map((c) => c.id));
  });

  it('不同 seed 产生不同牌局', () => {
    const a = newGame(1);
    const b = newGame(2);
    expect(a.hands.player.map((c) => c.id)).not.toEqual(
      b.hands.player.map((c) => c.id),
    );
  });
});

describe('先手判定', () => {
  it('奇数点 → AI 先手', () => {
    expect(judgeStarter(normalCard('S', 3))).toBe('ai');
    expect(judgeStarter(normalCard('S', 13))).toBe('ai');
    expect(judgeStarter(normalCard('S', 1))).toBe('ai');
  });

  it('偶数点 → 玩家先手', () => {
    expect(judgeStarter(normalCard('S', 2))).toBe('player');
    expect(judgeStarter(normalCard('S', 12))).toBe('player');
  });

  it('小王 = 奇 → AI 先；大王 = 偶 → 玩家先', () => {
    expect(judgeStarter(jokerCard('small'))).toBe('ai');
    expect(judgeStarter(jokerCard('big'))).toBe('player');
  });
});

describe('取牌', () => {
  it('摸牌后进入 play 阶段，手牌 +1', () => {
    const state = newGame();
    const result = reduce(state, { type: 'drawDeck' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.phase).toBe('play');
    const side = result.state.turn;
    expect(result.state.hands[side]).toHaveLength(11);
    expect(result.logs[0]?.kind).toBe('draw');
  });

  it('play 阶段不能再次取牌', () => {
    const state = newGame();
    const first = reduce(state, { type: 'drawDeck' });
    if (!first.ok) throw new Error('前置失败');
    const second = reduce(first.state, { type: 'drawDeck' });
    expect(second.ok).toBe(false);
  });

  it('弃牌堆为空时不能取弃牌', () => {
    const state = newGame();
    const result = reduce(state, { type: 'takeDiscardTop' });
    expect(result.ok).toBe(false);
  });
});

describe('弃牌', () => {
  it('不允许弃出王牌', () => {
    const state = newGame();
    const side = state.turn;
    const withJoker: GameState = {
      ...state,
      phase: 'play',
      hands: {
        ...state.hands,
        [side]: [...state.hands[side], jokerCard('big')],
      },
    };
    const result = reduce(withJoker, { type: 'discard', cardId: 'JOKER_BIG' });
    expect(result.ok).toBe(false);
  });

  it('弃牌后换手并回到 draw 阶段', () => {
    const state = newGame();
    const drawn = reduce(state, { type: 'drawDeck' });
    if (!drawn.ok) throw new Error('前置失败');
    const side = drawn.state.turn;
    const card = drawn.state.hands[side][0];
    if (card === undefined) throw new Error('手牌为空');
    // 选一张非王牌
    const target = drawn.state.hands[side].find((c) => c.kind === 'normal');
    if (target === undefined) throw new Error('无自然牌');
    const result = reduce(drawn.state, {
      type: 'discard',
      cardId: target.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.turn).not.toBe(side);
    expect(result.state.phase).toBe('draw');
  });

  it('从牌堆摸的牌可以正常弃出', () => {
    const state = newGame();
    const drawn = reduce(state, { type: 'drawDeck' });
    if (!drawn.ok) throw new Error('前置失败');
    const side = drawn.state.turn;
    // 摸到的牌就是手牌最后一张
    const drawnCard = drawn.state.hands[side][drawn.state.hands[side].length - 1];
    if (drawnCard === undefined) throw new Error('手牌为空');
    // drawnCardId 应为 null，该牌可弃
    expect(drawn.state.drawnCardId).toBeNull();
    const result = reduce(drawn.state, { type: 'discard', cardId: drawnCard.id });
    expect(result.ok).toBe(true);
  });

  it('弃牌堆顶牌可直接取、无需立刻成组，但本回合禁止弃回', () => {
    // 弃牌堆顶是 ♠7，但手牌没有 ♠5♠6，仍应能取顶牌（顶牌无需成组）
    const state = newGame();
    const custom: GameState = {
      ...state,
      phase: 'draw',
      turn: 'player',
      discard: [normalCard('S', 7)],
      hands: {
        ...state.hands,
        player: [normalCard('H', 2), normalCard('D', 9), ...state.hands.player.slice(2)],
      },
    };
    const taken = reduce(custom, { type: 'takeDiscardTop' });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    // 顶牌取走后，本回合禁止弃回
    expect(taken.state.drawnCardId).toBe('S7');
    const discardResult = reduce(taken.state, { type: 'discard', cardId: 'S7' });
    expect(discardResult.ok).toBe(false);
  });

  it('深层收取：指定牌直接亮成组合，只有其上方的牌进入手牌', () => {
    const state = newGame();
    // 弃牌堆：[♠7, ♠9]；顶牌 ♠9，中间 ♠7。手牌 ♠5♠6，取 ♠7 直接亮成顺子。
    const custom: GameState = {
      ...state,
      phase: 'draw',
      turn: 'player',
      discard: [normalCard('S', 7), normalCard('S', 9)],
      hands: {
        ...state.hands,
        player: [normalCard('S', 5), normalCard('S', 6), ...state.hands.player.slice(2)],
      },
    };
    const taken = reduce(custom, { type: 'takeDiscardDeep', cardId: 'S7' });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    expect(taken.state.phase).toBe('play');
    expect(taken.state.discard).toEqual([]);
    expect(taken.state.hands.player.some((card) => card.id === 'S7')).toBe(false);
    expect(taken.state.hands.player.some((card) => card.id === 'S9')).toBe(true);
    expect(taken.state.table).toHaveLength(1);
    expect(taken.state.table[0]?.meld.slots.map((slot) => slot.card.id)).toEqual(
      ['S5', 'S6', 'S7'],
    );
    expect(taken.state.mustMeldCardId).toBeNull();
    expect(taken.logs.map((log) => log.kind)).toEqual(['takeDiscard', 'meld']);
  });

  it('深层收取：指定牌可与上方弃牌及手牌一起直接组成组合', () => {
    const state = newGame();
    const custom: GameState = {
      ...state,
      phase: 'draw',
      turn: 'player',
      // 指定 ♠9，其上方有 ♥9；顶端 ♣4 未参与组合，应进入手牌。
      discard: [normalCard('S', 9), normalCard('H', 9), normalCard('C', 4)],
      hands: {
        ...state.hands,
        player: [normalCard('D', 9)],
      },
    };
    const view = toGameView(custom, { side: 'player' });
    expect(view.discardPlayable.S9).toBe(true);

    const taken = reduce(custom, { type: 'takeDiscardDeep', cardId: 'S9' });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    expect(taken.state.table).toHaveLength(1);
    expect(taken.state.table[0]?.meld.slots.map((slot) => slot.card.id).sort()).toEqual(
      ['D9', 'H9', 'S9'],
    );
    expect(taken.state.hands.player.map((card) => card.id)).toEqual(['C4']);
    expect(taken.state.discard).toEqual([]);
    expect(taken.logs.map((log) => log.kind)).toEqual(['takeDiscard', 'meld']);
  });

  it('弃牌堆连续三张 9 可不依赖手牌直接组成同点数组', () => {
    const state = newGame();
    const custom: GameState = {
      ...state,
      phase: 'draw',
      turn: 'player',
      discard: [
        normalCard('S', 9),
        normalCard('H', 9),
        normalCard('D', 9),
      ],
      hands: {
        ...state.hands,
        player: [],
      },
    };
    const view = toGameView(custom, { side: 'player' });
    expect(view.discardPlayable.S9).toBe(true);

    const taken = reduce(custom, { type: 'takeDiscardDeep', cardId: 'S9' });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    expect(taken.state.table).toHaveLength(1);
    expect(taken.state.table[0]?.meld.type).toBe('set');
    expect(taken.state.table[0]?.meld.slots.map((slot) => slot.card.id).sort()).toEqual(
      ['D9', 'H9', 'S9'],
    );
    expect(taken.state.hands.player).toEqual([]);
    expect(taken.state.discard).toEqual([]);
    expect(taken.logs.map((log) => log.kind)).toContain('meld');
  });

  it('深层收取：指定牌直接接入桌面组合，上方牌仍进入手牌', () => {
    const state = newGame();
    const baseMeld = asRuns([
      normalCard('S', 4),
      normalCard('S', 5),
      normalCard('S', 6),
    ])[0];
    if (baseMeld === undefined) throw new Error('前置失败');
    const custom: GameState = {
      ...state,
      phase: 'draw',
      turn: 'player',
      discard: [normalCard('S', 7), normalCard('S', 9)],
      hands: {
        ...state.hands,
        player: [normalCard('H', 2), normalCard('D', 3)],
      },
      table: [{ id: 'm0', owner: 'player', meld: baseMeld }],
    };
    const taken = reduce(custom, { type: 'takeDiscardDeep', cardId: 'S7' });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    expect(taken.state.phase).toBe('play');
    expect(taken.state.table[0]?.meld.slots).toHaveLength(4);
    expect(taken.state.table[0]?.meld.slots.some((slot) => slot.card.id === 'S7')).toBe(true);
    expect(taken.state.hands.player.some((card) => card.id === 'S7')).toBe(false);
    expect(taken.state.hands.player.some((card) => card.id === 'S9')).toBe(true);
    expect(taken.state.mustMeldCardId).toBeNull();
    expect(taken.logs.map((log) => log.kind)).toEqual(['takeDiscard', 'layOff']);
  });
});

describe('亮牌与接牌', () => {
  it('合法组合可以亮出', () => {
    const state = newGame();
    const side = state.turn;
    const custom: GameState = {
      ...state,
      phase: 'play',
      hands: {
        ...state.hands,
        [side]: [
          normalCard('S', 5),
          normalCard('S', 6),
          normalCard('S', 7),
          normalCard('H', 2),
        ],
      },
    };
    const result = reduce(custom, {
      type: 'meld',
      cardIds: ['S5', 'S6', 'S7'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.table).toHaveLength(1);
    expect(result.state.hands[side]).toHaveLength(1);
  });

  it('非法组合被拒绝', () => {
    const state = newGame();
    const side = state.turn;
    const custom: GameState = {
      ...state,
      phase: 'play',
      hands: {
        ...state.hands,
        [side]: [
          normalCard('S', 5),
          normalCard('H', 9),
          normalCard('D', 2),
        ],
      },
    };
    const result = reduce(custom, {
      type: 'meld',
      cardIds: ['S5', 'H9', 'D2'],
    });
    expect(result.ok).toBe(false);
  });

  it('接牌后分值归属不变（归组合所属阵营）', () => {
    const state = newGame();
    const custom: GameState = {
      ...state,
      phase: 'play',
      turn: 'player',
      hands: {
        ...state.hands,
        player: [normalCard('S', 8)],
      },
      table: [
        {
          id: 'aiMeld',
          owner: 'ai',
          meld: {
            type: 'run',
            slots: [
              { card: normalCard('S', 5), suit: 'S', rank: 5, simulated: false },
              { card: normalCard('S', 6), suit: 'S', rank: 6, simulated: false },
              { card: normalCard('S', 7), suit: 'S', rank: 7, simulated: false },
            ],
          },
        },
      ],
    };
    const result = reduce(custom, {
      type: 'layOff',
      meldId: 'aiMeld',
      cardId: 'S8',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.table[0]?.owner).toBe('ai');
    expect(result.state.table[0]?.meld.slots).toHaveLength(4);
  });
});

describe('撤销', () => {
  it('回合内可撤销摸牌', () => {
    const state = newGame();
    const drawn = reduce(state, { type: 'drawDeck' });
    if (!drawn.ok) throw new Error('前置失败');
    const undone = reduce(drawn.state, { type: 'undo' });
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.state.phase).toBe('draw');
    const side = state.turn;
    expect(undone.state.hands[side]).toHaveLength(10);
  });

  it('弃牌后撤销栈清空', () => {
    const state = newGame();
    const drawn = reduce(state, { type: 'drawDeck' });
    if (!drawn.ok) throw new Error('前置失败');
    const side = drawn.state.turn;
    const target = drawn.state.hands[side].find((c) => c.kind === 'normal');
    if (target === undefined) throw new Error('无自然牌');
    const discarded = reduce(drawn.state, {
      type: 'discard',
      cardId: target.id,
    });
    if (!discarded.ok) throw new Error('弃牌失败');
    expect(discarded.state.undoStack).toHaveLength(0);
    const undo = reduce(discarded.state, { type: 'undo' });
    expect(undo.ok).toBe(false);
  });

  it('无可撤销操作时报错', () => {
    const state = newGame();
    expect(reduce(state, { type: 'undo' }).ok).toBe(false);
  });
});

describe('无合法动作', () => {
  it('手牌仅剩王牌且不可接牌时判定卡死', () => {
    const state = newGame();
    const custom: GameState = {
      ...state,
      phase: 'play',
      turn: 'player',
      hands: {
        ...state.hands,
        player: [jokerCard('big')],
      },
      table: [],
    };
    expect(hasLegalMove(custom)).toBe(false);
  });

  it('手牌含自然牌时始终有合法动作', () => {
    const state = newGame();
    const custom: GameState = {
      ...state,
      phase: 'play',
      turn: 'player',
      hands: { ...state.hands, player: [normalCard('S', 5)] },
      table: [],
    };
    expect(hasLegalMove(custom)).toBe(true);
  });
});

describe('GameView 信息公平', () => {
  it('视图不包含牌堆内容，仅张数', () => {
    const state = newGame();
    const view = toGameView(state, { side: 'ai' });
    expect(view.deckCount).toBe(state.deck.length);
    expect(Object.keys(view)).not.toContain('deck');
    expect(JSON.stringify(view)).not.toContain(state.deck[0]?.id ?? '__none__');
  });

  it('对手只有张数，没有手牌内容', () => {
    const state = newGame();
    const view = toGameView(state, { side: 'player' });
    expect(view.opponentHandCount).toBe(10);
    expect(Object.keys(view)).not.toContain('aiHand');
  });

  it('视图被深冻结，无法回写引擎状态', () => {
    const state = newGame();
    const view = toGameView(state, { side: 'player' });
    expect(Object.isFrozen(view)).toBe(true);
    expect(() => {
      (view as unknown as { phase: string }).phase = 'matchEnd';
    }).toThrow();
  });

  it('playable 标记不可打出的牌', () => {
    const state = newGame();
    const custom: GameState = {
      ...state,
      phase: 'play',
      hands: {
        ...state.hands,
        player: [
          normalCard('S', 5),
          normalCard('S', 6),
          normalCard('S', 7),
          normalCard('H', 2),
          normalCard('D', 9),
        ],
      },
      table: [],
    };
    const view = toGameView(custom, { side: 'player' });
    expect(view.me.playable.S5).toBe(true);
    expect(view.me.playable.S6).toBe(true);
    expect(view.me.playable.S7).toBe(true);
    expect(view.me.playable.D9).toBe(false);
  });
});
