/**
 * 布局几何单测。
 *
 * 把 [Design.md](../../../Design.md) 的布局要求直接写成断言。
 * 这些是纯函数测试，不依赖浏览器，因此能在 vitest 里秒级验证。
 */

import { describe, expect, it } from 'vitest';
import {
  computeLayout,
  opponentHandCardRect,
  pickCardSize,
  type LayoutInput,
} from './layout';
import type { GameView } from '../../core/view';
import type { Card } from '../../core/cards';
import { makeDeck } from '../../core/cards';
import { asRuns } from '../../core/meld';
import { sortHand } from './sort';

const deckCards = makeDeck();
const firstN = (n: number): Card[] => deckCards.slice(0, n);

function baseView(over: Partial<GameView> = {}): GameView {
  const hand = firstN(10);
  const playable: Record<string, boolean> = {};
  for (const c of hand) playable[c.id] = true;
  return {
    phase: 'play',
    turn: 'player',
    roundIndex: 1,
    deckCount: 30,
    discard: [],
    discardPlayable: {},
    me: { cards: hand, playable },
    opponentHandCount: 10,
    table: [],
    totals: { player: 0, ai: 0 },
    lastRound: null,
    lastMatch: null,
    canUndo: true,
    intensity: 2,
    starterReveal: null,
    drawnCardId: null,
    mustMeldCardId: null,
    ...over,
  } as GameView;
}

function makeInput(
  view: GameView,
  width: number,
  height: number,
  over: Partial<LayoutInput> = {},
): LayoutInput {
  return {
    view,
    width,
    height,
    selectedIds: new Set<string>(),
    sortMode: 'suit',
    sortedHand: sortHand(view.me.cards, 'suit'),
    actionPrimaryLabel: null,
    actionSecondaryLabel: null,
    layOffTargets: new Set<string>(),
    ...over,
  };
}

describe('模式判定', () => {
  it('横屏（高度不足且更宽）走 columns', () => {
    expect(computeLayout(makeInput(baseView(), 844, 390)).mode).toBe('columns');
  });

  it('桌面与竖屏走 stacked', () => {
    expect(computeLayout(makeInput(baseView(), 1440, 900)).mode).toBe('stacked');
    expect(computeLayout(makeInput(baseView(), 390, 844)).mode).toBe('stacked');
  });
});

describe('卡牌尺寸', () => {
  it('横屏牌宽遵循 clamp(40, 15vh, 66)', () => {
    const c = pickCardSize('columns', 844, 400);
    expect(c.w).toBe(60); // 400 * 0.15 = 60
    expect(c.w).toBeGreaterThanOrEqual(40);
    expect(c.w).toBeLessThanOrEqual(66);
  });

  it('常规牌宽遵循 clamp(48, 11%最短边, 84)', () => {
    const c = pickCardSize('stacked', 390, 844);
    expect(c.w).toBeGreaterThanOrEqual(48);
    expect(c.w).toBeLessThanOrEqual(84);
    // 最短边 390 * 0.11 = 42.9 → clamp 到 48
    expect(c.w).toBe(48);
  });
});

describe('公共栏（常规模式）', () => {
  const layout = computeLayout(makeInput(baseView(), 1440, 900));

  it('牌堆在左，且位于公共栏内', () => {
    const deck = layout.deck;
    expect(deck).not.toBeNull();
    if (deck === null) return;
    expect(deck.x).toBeGreaterThanOrEqual(layout.zonePublic.x);
    expect(deck.x + deck.w).toBeLessThanOrEqual(layout.zonePublic.x + layout.zonePublic.w);
    expect(deck.x - layout.zonePublic.x).toBeLessThan(24);
  });

  it('撤回按钮在顶栏，紧邻设置按钮左侧', () => {
    expect(layout.undo.y).toBeLessThan(layout.topbar.h);
    expect(layout.undo.y + layout.undo.h).toBeLessThanOrEqual(layout.topbar.h + 1);
    // 撤回按钮右边缘紧邻设置按钮左边缘（间隔一个 GAP）
    expect(layout.settings.x - (layout.undo.x + layout.undo.w)).toBe(8);
  });

  it('公共栏高度 = 一张牌高 + 少量内边距（不撑出大片空白）', () => {
    // zonePublic.h ≈ card.h + 16（PAD*2）
    expect(layout.zonePublic.h).toBe(layout.card.h + 16);
  });
});

describe('手牌', () => {
  it('牌宽不被压缩（始终等于基准牌宽）', () => {
    const layout = computeLayout(makeInput(baseView(), 390, 844));
    const cw = layout.card.w;
    for (const face of layout.hand.cards) {
      expect(face.w).toBe(cw);
    }
  });

  it('手牌牌多时可横向滚动（内容宽超过 viewport）', () => {
    // 20 张牌，viewport 有限 → contentW > viewport.w
    const view = baseView({ me: { cards: firstN(20), playable: {} } });
    const layout = computeLayout(makeInput(view, 390, 844));
    expect(layout.hand.contentW).toBeGreaterThan(layout.hand.viewport.w);
  });

  it('选中只改变 Y，不改变绘制顺序（数组顺序不变）', () => {
    const view = baseView();
    const base = computeLayout(makeInput(view, 1440, 900));
    const firstId = base.hand.cards[2]?.card.id;
    expect(firstId).toBeDefined();
    if (firstId === undefined) return;

    const selected = computeLayout(
      makeInput(view, 1440, 900, { selectedIds: new Set([firstId]) }),
    );
    expect(selected.hand.cards.map((f) => f.card.id)).toEqual(
      base.hand.cards.map((f) => f.card.id),
    );
    const before = base.hand.cards[2];
    const after = selected.hand.cards[2];
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    if (before === undefined || after === undefined) return;
    expect(after.y).toBeLessThan(before.y);
    expect(selected.hand.cards[0]?.y).toBe(base.hand.cards[0]?.y);
  });
});

describe('横屏中间栏', () => {
  const layout = computeLayout(makeInput(baseView(), 844, 390));

  it('中间栏宽度足以容纳一张横躺牌（card.h）', () => {
    expect(layout.zonePublic.w).toBeGreaterThanOrEqual(layout.card.h);
  });

  it('中间栏不与左右区域重叠', () => {
    expect(layout.zonePublic.x).toBeGreaterThanOrEqual(
      layout.zoneAiMelds.x + layout.zoneAiMelds.w,
    );
    expect(layout.zoneMine.x).toBeGreaterThanOrEqual(
      layout.zonePublic.x + layout.zonePublic.w,
    );
  });

  it('横躺牌标记为 sideways，且尺寸为宽高互换', () => {
    const view = baseView({ discard: firstN(3) });
    const l = computeLayout(makeInput(view, 844, 390));
    expect(l.discard.cards.length).toBe(3);
    for (const face of l.discard.cards) {
      expect(face.sideways).toBe(true);
      expect(face.w).toBe(l.card.h);
      expect(face.h).toBe(l.card.w);
    }
    expect(l.discard.axis).toBe('y');
  });
});

describe('操作按钮（悬浮手牌上方中央）', () => {
  it('有无选中牌时，手牌位置完全一致（不被按钮顶起）', () => {
    const view = baseView();
    const noBtn = computeLayout(makeInput(view, 1440, 900));
    const withBtn = computeLayout(
      makeInput(view, 1440, 900, {
        actionPrimaryLabel: '弃牌',
        actionSecondaryLabel: '取消',
      }),
    );

    expect(withBtn.actionPrimary).not.toBeNull();
    expect(withBtn.hand.viewport.y).toBe(noBtn.hand.viewport.y);
    expect(withBtn.hand.cards.map((f) => f.y)).toEqual(noBtn.hand.cards.map((f) => f.y));
  });

  it('操作按钮悬浮在手牌区上方中央', () => {
    const layout = computeLayout(
      makeInput(baseView(), 1440, 900, { actionPrimaryLabel: '弃牌' }),
    );
    expect(layout.actionPrimary).not.toBeNull();
    if (layout.actionPrimary === null) return;
    // 按钮位于手牌区上方（y < handArea.y）
    expect(layout.actionPrimary.y + layout.actionPrimary.h).toBeLessThanOrEqual(
      layout.handArea.y,
    );
    // 按钮水平居中：中心点接近手牌区中心
    const btnCenter = layout.actionPrimary.x + layout.actionPrimary.w / 2;
    const areaCenter = layout.handArea.x + layout.handArea.w / 2;
    expect(Math.abs(btnCenter - areaCenter)).toBeLessThan(10);
  });
});

describe('排序按钮位置', () => {
  it('位于手牌区左侧，而不到顶栏', () => {
    const layout = computeLayout(makeInput(baseView(), 1440, 900));
    expect(layout.sort.y).toBeGreaterThanOrEqual(layout.handArea.y - 1);
    expect(layout.sort.y + layout.sort.h).toBeLessThanOrEqual(
      layout.handArea.y + layout.handArea.h + 1,
    );
    expect(layout.sort.y).toBeGreaterThan(layout.topbar.h);
  });
});

describe('对手手牌带（动画起点）', () => {
  it('位于顶栏内，且右边界不越过撤回按钮', () => {
    const layout = computeLayout(makeInput(baseView(), 1440, 900));
    const band = layout.opponentHandBand;
    expect(band.y).toBeGreaterThanOrEqual(layout.topbar.y);
    expect(band.y + band.h).toBeLessThanOrEqual(layout.topbar.y + layout.topbar.h);
    expect(band.x + band.w).toBeLessThanOrEqual(layout.undo.x);
  });

  it('与玩家手牌区完全分离（对手的牌绝不能从手牌区飞出）', () => {
    for (const [w, h] of [
      [1440, 900],
      [844, 390],
      [390, 844],
    ] as const) {
      const layout = computeLayout(makeInput(baseView(), w, h));
      const band = layout.opponentHandBand;
      const hand = layout.hand.viewport;
      const overlapsY = band.y < hand.y + hand.h && hand.y < band.y + band.h;
      expect(overlapsY, `${String(w)}x${String(h)} 对手手牌带与手牌区不应在纵向重叠`).toBe(false);
    }
  });

  it('对手摸牌的落点在手牌带内（牌背底边对齐手牌带底部）', () => {
    const layout = computeLayout(makeInput(baseView(), 1440, 900));
    const r = opponentHandCardRect(layout, 2);
    const band = layout.opponentHandBand;
    expect(r.x).toBeGreaterThanOrEqual(band.x);
    expect(r.y + r.h).toBe(band.y + band.h);
    expect(r.y).toBeLessThanOrEqual(band.y);
  });
});

describe('弃牌堆（堆叠）', () => {
  it('每张牌完整绘制，尺寸等于基准牌', () => {
    const view = baseView({ discard: firstN(8) });
    const layout = computeLayout(makeInput(view, 1440, 900));
    expect(layout.discard.cards.length).toBe(8);
    for (const face of layout.discard.cards) {
      expect(face.w).toBe(layout.card.w);
      expect(face.h).toBe(layout.card.h);
    }
  });

  it('弃牌堆堆叠：相邻牌间距小于牌宽（重叠，而非排开）', () => {
    const view = baseView({ discard: firstN(5) });
    const layout = computeLayout(makeInput(view, 1440, 900));
    expect(layout.discard.cards.length).toBeGreaterThanOrEqual(2);
    const a = layout.discard.cards[0];
    const b = layout.discard.cards[1];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a === undefined || b === undefined) return;
    expect(b.x - a.x).toBeLessThan(layout.card.w);
    expect(b.x - a.x).toBeGreaterThan(0);
  });

  it('横屏窄容器弃牌过多时可滚动（内容高超过 viewport）', () => {
    const view = baseView({ discard: firstN(40) });
    const layout = computeLayout(makeInput(view, 844, 390));
    expect(layout.discard.axis).toBe('y');
    expect(layout.discard.contentH).toBeGreaterThan(layout.discard.viewport.h);
    const lastId = view.discard[view.discard.length - 1]?.id;
    expect(layout.discard.cards[layout.discard.cards.length - 1]?.card.id).toBe(lastId);
  });
});

describe('组合区', () => {
  it('空间不足时缩小牌（牌宽 < 基准牌宽），而不是滚动', () => {
    // 造一个很长的同花顺，让单组宽超过组合区
    const runCards = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12', 'S13'];
    const cards = runCards.map((id) => deckCards.find((c) => c.id === id)).filter((c): c is Card => c !== undefined);
    const meld = asRuns(cards)[0];
    expect(meld).toBeDefined();
    if (meld === undefined) return;

    const view = baseView({ table: [{ id: 'm1', owner: 'player', meld }] });
    // 横屏窄侧栏：组合区宽度不足以完整摆下 13 张牌，必须缩小
    const layout = computeLayout(makeInput(view, 844, 390));
    expect(layout.myMelds.length).toBe(1);
    const face = layout.myMelds[0]?.cards[0];
    expect(face).toBeDefined();
    if (face === undefined) return;
    // 缩小后的牌宽应小于基准牌宽
    expect(face.w).toBeLessThan(layout.card.w);
    // 但仍不小于最小可见宽
    expect(face.w).toBeGreaterThanOrEqual(24);
  });

  it('组合记录了分值', () => {
    const meld = asRuns([
      deckCards.find((c) => c.id === 'S5') as Card,
      deckCards.find((c) => c.id === 'S6') as Card,
      deckCards.find((c) => c.id === 'S7') as Card,
    ])[0];
    if (meld === undefined) return;
    const view = baseView({ table: [{ id: 'm1', owner: 'ai', meld }] });
    const layout = computeLayout(makeInput(view, 1440, 900));
    expect(layout.aiMelds[0]?.value).toBe(18);
  });
});
