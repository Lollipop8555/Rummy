/**
 * 牌桌布局计算（纯函数，无 DOM、无 Canvas 依赖）。
 *
 * 本文件是实现 [Design.md](../../../Design.md) 布局要求 + 用户反馈的唯一依据：
 * - 布局是纯函数：输入「视口尺寸 + GameView」，输出每个元素的矩形。
 * - 绘制与命中测试消费同一份布局结果，因此二者永不错位。
 *
 * 用户关键反馈（必须遵守）：
 * 1. 操作按钮（亮牌/弃牌）放在**手牌区横向两侧**，不占用底部纵向空间。
 *    手牌是横向滚动的，按钮应在其左侧（排序）与右侧（操作）。
 * 2. 弃牌堆**堆叠**显示：每张只露出少量边，最新一张完整可见，不一张张排开。
 *
 * 坐标约定：手牌与弃牌堆的 `cards` 一律使用 **viewport 局部坐标**。
 */

import type { Card } from '../../core/cards';
import { meldValue, type Meld } from '../../core/meld';
import type { GameView } from '../../core/view';

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

export type CardSize = {
  readonly w: number;
  readonly h: number;
  readonly radius: number;
};

export type CardFaceLayout = Rect & {
  readonly card: Card;
  /** 组合中的位置（用于显示解析后的点数/花色） */
  readonly displayRank?: number;
  readonly displaySuit?: string;
  readonly simulated?: boolean;
  /** 手牌中是否可打出（决定是否绘制遮罩） */
  readonly playable?: boolean;
  readonly selected?: boolean;
  /** 横躺绘制：Canvas 真实旋转 90°，不是重排版 */
  readonly sideways?: boolean;
  /** 弃牌堆中该牌「可取」（取走后能立刻成组），用于高亮提示 */
  readonly highlight?: boolean;
  /** 牌圆角。组合区会缩小牌，圆角必须随牌宽缩放 */
  readonly radius: number;
};

/**
 * 可滚动列表（弃牌堆 / 手牌共用）：
 * 牌在 viewport 局部坐标系下完整绘制，超出部分由绘制层裁剪。
 */
export type ScrollListLayout = {
  readonly viewport: Rect;
  readonly cards: readonly CardFaceLayout[];
  readonly contentW: number;
  readonly contentH: number;
  readonly axis: 'x' | 'y';
};

export type MeldLayout = {
  readonly id: string;
  readonly owner: 'player' | 'ai';
  readonly rect: Rect;
  readonly cards: readonly CardFaceLayout[];
  /** 组合总分，绘制时直接使用，避免重算 */
  readonly value: number;
  /** 当前选中牌能否接到该组合（接牌目标高亮） */
  readonly layOffable?: boolean;
};

export type ButtonId =
  | 'deck'
  | 'undo'
  | 'settings'
  | 'sort'
  | 'actionPrimary'
  | 'actionSecondary';

export type ButtonLayout = Rect & {
  readonly id: ButtonId;
  /** 是否可点击（决定绘制透明度与命中） */
  readonly enabled?: boolean;
  /** 按钮文案（绘制层直接使用） */
  readonly label?: string;
};

export type LayoutMode = 'stacked' | 'columns';

/** 手牌布局：cards 使用 viewport 局部坐标 */
export type HandLayout = {
  readonly viewport: Rect;
  readonly cards: readonly CardFaceLayout[];
  readonly contentW: number;
};

export type TableLayout = {
  readonly mode: LayoutMode;
  readonly width: number;
  readonly height: number;
  /** 基准竖牌尺寸（手牌 / 牌堆 / 弃牌堆据此绘制） */
  readonly card: CardSize;

  readonly topbar: Rect;
  readonly settings: ButtonLayout;
  /** 撤回按钮：顶栏，紧邻设置按钮左侧 */
  readonly undo: ButtonLayout;
  /**
   * 对手手牌带：顶栏中对手牌背所处的条带。
   *
   * 绘制与「对手出牌动画起点」共用这一份矩形，因此对手的牌
   * 一定是从**对手手牌位置**飞出，而不是从玩家手牌区飞出。
   */
  readonly opponentHandBand: Rect;

  readonly zoneAiMelds: Rect;
  readonly zonePublic: Rect;
  readonly zoneMine: Rect;
  /** 手牌整条横带（含排序按钮、手牌滚动区、操作按钮） */
  readonly handArea: Rect;
  /** 排序按钮：手牌区左侧，垂直居中 */
  readonly sort: ButtonLayout;

  readonly aiMelds: readonly MeldLayout[];
  readonly myMelds: readonly MeldLayout[];

  readonly deck: ButtonLayout | null;
  readonly discard: ScrollListLayout;

  readonly hand: HandLayout;

  /** 操作按钮：手牌区右侧（横向），不占底部纵向空间 */
  readonly actionPrimary: ButtonLayout | null;
  readonly actionSecondary: ButtonLayout | null;
};

const GAP = 8;
const PAD = 8;
/** 手牌重叠：每张向前露出 85%，避免挤在一起（用户反馈：横向不挤） */
const HAND_REVEAL = 0.85;
/** 组合区内一组牌每张露出比例 */
const MELD_REVEAL = 0.5;
/** 组合牌最小宽度（避免缩小到不可读） */
const MELD_MIN_W = 24;
/** 顶栏高度 */
const TOPBAR_STACKED = 56;
const TOPBAR_COLUMNS = 44;
/** 圆形按钮尺寸 */
const ROUND_BTN = 36;
/** 弃牌堆堆叠：每张露出的比例（加大间距，便于触摸点选） */
const DISCARD_REVEAL = 0.42;
/** 操作按钮尺寸（手牌区右侧，横向排列） */
const ACTION_BTN_W = 76;
const ACTION_BTN_H = 32;

export type LayoutInput = {
  readonly view: GameView;
  readonly width: number;
  readonly height: number;
  readonly selectedIds: ReadonlySet<string>;
  readonly sortMode: 'suit' | 'rank';
  readonly sortedHand: readonly Card[];
  /** 操作按钮文案；null 表示当前阶段无操作 */
  readonly actionPrimaryLabel: string | null;
  readonly actionSecondaryLabel: string | null;
  /** 当前选中单张牌可接的 meld id 集合（用于接牌目标高亮） */
  readonly layOffTargets: ReadonlySet<string>;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 依视口选模式：高度不足且横向更宽即视为横屏紧凑模式 */
export function pickMode(width: number, height: number): LayoutMode {
  return height < 520 && width > height ? 'columns' : 'stacked';
}

/**
 * 卡牌基准尺寸。
 * - 常规模式：基准牌宽 clamp(48, 11%最短边, 84)，牌高 = 宽 × 1.42。
 * - 横屏模式：牌宽 clamp(40, 15vh, 66)（Design 6 尺寸表）。
 */
export function pickCardSize(
  mode: LayoutMode,
  width: number,
  height: number,
): CardSize {
  if (mode === 'columns') {
    const w = clamp(height * 0.15, 40, 66);
    return { w, h: Math.round(w * 1.42), radius: Math.round(w * 0.09) };
  }
  const shortest = Math.min(width, height);
  const w = clamp(shortest * 0.11, 48, 84);
  return {
    w: Math.round(w),
    h: Math.round(w * 1.42),
    radius: Math.round(w * 0.09),
  };
}

function layoutTopbarButtons(
  width: number,
  topHeight: number,
  card: CardSize,
): {
  topbar: Rect;
  settings: ButtonLayout;
  undo: ButtonLayout;
  opponentHandBand: Rect;
} {
  const settings: ButtonLayout = {
    id: 'settings',
    x: width - PAD - ROUND_BTN,
    y: (topHeight - ROUND_BTN) / 2,
    w: ROUND_BTN,
    h: ROUND_BTN,
  };
  // 撤回按钮紧邻设置按钮左侧，同处顶栏
  const undo: ButtonLayout = {
    id: 'undo',
    x: settings.x - GAP - ROUND_BTN,
    y: (topHeight - ROUND_BTN) / 2,
    w: ROUND_BTN,
    h: ROUND_BTN,
  };
  const topbar: Rect = { x: 0, y: 0, w: width, h: topHeight };
  return { topbar, settings, undo, opponentHandBand: layoutOpponentHandBand(topbar, undo, card) };
}

/**
 * 对手手牌带。
 *
 * 横向起点取顶栏 40% 处（左侧留给比分/轮次/头像/名称），右边界止于撤回按钮左侧。
 * 左侧文字若过长，由绘制层裁剪在 `band.x` 之前，绝不压到手牌带。
 */
function layoutOpponentHandBand(
  topbar: Rect,
  undo: ButtonLayout,
  card: CardSize,
): Rect {
  const bandH = Math.max(14, Math.round(card.h * 0.2));
  const right = Math.max(0, undo.x - GAP);
  const left = Math.min(
    Math.round(topbar.w * 0.4),
    Math.max(0, right - card.w),
  );
  return {
    x: left,
    y: Math.round((topbar.h - bandH) / 2),
    w: Math.max(0, right - left),
    h: bandH,
  };
}

/** 对手手牌带中第 index 张牌背的矩形（绘制与动画起点共用） */
export function opponentHandCardRect(
  layout: TableLayout,
  index: number,
): Rect {
  const band = layout.opponentHandBand;
  const step = Math.round(layout.card.w * 0.55);
  return {
    // 牌背整体位于 band 下方，只有顶部 band.h 像素露出（相当于「只看到牌头」）
    x: band.x + index * step,
    y: band.y + band.h - layout.card.h,
    w: layout.card.w,
    h: layout.card.h,
  };
}

/**
 * 一组牌排成一行。
 *
 * @param cardW 实际使用的牌宽（由 layoutMelds 整体缩放决定）。
 * 组合内的牌宽统一用 cardW，牌高 = cardW × 1.42。
 */
function layoutMeld(
  meld: Meld,
  owner: 'player' | 'ai',
  origin: Rect,
  cardW: number,
  id: string,
  maxWidth: number,
): MeldLayout {
  const n = meld.slots.length;
  if (n === 0) {
    return {
      id,
      owner,
      rect: { x: origin.x, y: origin.y, w: 0, h: 0 },
      cards: [],
      value: meldValue(meld),
    };
  }
  const reveal = MELD_REVEAL;
  // 先按目标牌宽算；若单组横向超过 maxWidth，则等比例缩小整组
  let w = cardW;
  let totalW = w + w * reveal * (n - 1);
  if (maxWidth > 0 && totalW > maxWidth) {
    w = maxWidth / (1 + reveal * (n - 1));
    w = Math.max(MELD_MIN_W, w);
    totalW = w + w * reveal * (n - 1);
  }
  const h = Math.round(w * 1.42);
  const radius = Math.round(w * 0.09);
  const step = w * reveal;

  const cards: CardFaceLayout[] = meld.slots.map((slot, i) => ({
    card: slot.card,
    displayRank: slot.rank,
    displaySuit: slot.suit,
    simulated: slot.simulated,
    x: origin.x + i * step,
    y: origin.y,
    w,
    h,
    radius,
  }));
  return {
    id,
    owner,
    rect: { x: origin.x, y: origin.y, w: totalW, h },
    cards,
    value: meldValue(meld),
  };
}

/** 计算一整桌的布局。纯函数，可单测、可用于命中测试。 */
export function computeLayout(input: LayoutInput): TableLayout {
  const { width, height } = input;
  const mode = pickMode(width, height);
  const card = pickCardSize(mode, width, height);

  const topHeight = mode === 'columns' ? TOPBAR_COLUMNS : TOPBAR_STACKED;
  const { topbar, settings, undo, opponentHandBand } = layoutTopbarButtons(
    width,
    topHeight,
    card,
  );

  if (mode === 'stacked') {
    return computeStacked(input, card, topbar, settings, undo, opponentHandBand);
  }
  return computeColumns(input, card, topbar, settings, undo, opponentHandBand);
}

function computeStacked(
  input: LayoutInput,
  card: CardSize,
  topbar: Rect,
  settings: ButtonLayout,
  undo: ButtonLayout,
  opponentHandBand: Rect,
): TableLayout {
  const { view, width, height } = input;

  // 公共栏高度 = 一张牌高 + 少量内边距，不参与剩余空间分配（Design 2.1）
  const publicH = card.h + PAD * 2;
  // 手牌区高度 = 牌高的 70%（牌完整绘制，底部 30% 溢出屏幕被裁掉）
  const handH = Math.round(card.h * 0.7);

  // 纵向：topbar / GAP / zoneAi / GAP / zonePublic / GAP / zoneMine / GAP / hand / PAD
  const fixed = topbar.h + publicH + handH + GAP * 4 + PAD;
  const zoneH = Math.max(0, (height - fixed) / 2);

  const zoneAi: Rect = {
    x: PAD,
    y: topbar.h + GAP,
    w: width - PAD * 2,
    h: zoneH,
  };
  const zonePublic: Rect = {
    x: PAD,
    y: zoneAi.y + zoneAi.h + GAP,
    w: width - PAD * 2,
    h: publicH,
  };
  const zoneMine: Rect = {
    x: PAD,
    y: zonePublic.y + zonePublic.h + GAP,
    w: width - PAD * 2,
    h: zoneH,
  };
  const handArea: Rect = {
    x: PAD,
    y: zoneMine.y + zoneMine.h + GAP,
    w: width - PAD * 2,
    h: handH,
  };

  const hand = layoutHand(input, handArea, card);
  return {
    mode: 'stacked',
    width,
    height,
    card,
    topbar,
    settings,
    undo,
    opponentHandBand,
    zoneAiMelds: zoneAi,
    zonePublic,
    zoneMine,
    handArea,
    aiMelds: layoutMelds(view, 'ai', zoneAi, card, input.layOffTargets),
    myMelds: layoutMelds(view, 'player', zoneMine, card, input.layOffTargets),
    deck: layoutDeckStacked(zonePublic, card),
    discard: layoutDiscardStacked(view, zonePublic, card),
    hand,
    sort: sortButton(handArea, card),
    ...layoutHandActions(handArea, hand, input),
  };
}

function computeColumns(
  input: LayoutInput,
  card: CardSize,
  topbar: Rect,
  settings: ButtonLayout,
  undo: ButtonLayout,
  opponentHandBand: Rect,
): TableLayout {
  const { view, width, height } = input;

  const handH = Math.round(card.h * 0.7);
  const bodyY = topbar.h + GAP;
  // 纵向：topbar / GAP / body / GAP / hand / PAD
  const bodyH = height - bodyY - handH - GAP - PAD;

  // 中间公共栏宽度 = 横躺牌高度（不是牌宽）（Design 2.2）
  const midW = card.h + PAD * 2;
  const sideW = (width - midW - GAP * 2 - PAD * 2) / 2;

  const zoneAi: Rect = { x: PAD, y: bodyY, w: sideW, h: bodyH };
  const zonePublic: Rect = {
    x: PAD + sideW + GAP,
    y: bodyY,
    w: midW,
    h: bodyH,
  };
  const zoneMine: Rect = {
    x: zonePublic.x + midW + GAP,
    y: bodyY,
    w: sideW,
    h: bodyH,
  };
  const handArea: Rect = {
    x: PAD,
    y: bodyY + bodyH + GAP,
    w: width - PAD * 2,
    h: handH,
  };

  const hand = layoutHand(input, handArea, card);
  return {
    mode: 'columns',
    width,
    height,
    card,
    topbar,
    settings,
    undo,
    opponentHandBand,
    zoneAiMelds: zoneAi,
    zonePublic,
    zoneMine,
    handArea,
    aiMelds: layoutMelds(view, 'ai', zoneAi, card, input.layOffTargets),
    myMelds: layoutMelds(view, 'player', zoneMine, card, input.layOffTargets),
    deck: layoutDeckVertical(zonePublic, card),
    discard: layoutDiscardVertical(view, zonePublic, card),
    hand,
    sort: sortButton(handArea, card),
    ...layoutHandActions(handArea, hand, input),
  };
}

/**
 * 组合区：横向流式排布 + 优先换行；整体超过 zone 高度时，
 * 按比例缩小所有牌重排（不是单组缩小、也不是只缩最后一个）。
 */
function layoutMelds(
  view: GameView,
  owner: 'player' | 'ai',
  zone: Rect,
  card: CardSize,
  layOffTargets: ReadonlySet<string>,
): MeldLayout[] {
  const melds = view.table.filter((m) => m.owner === owner);
  if (melds.length === 0) return [];

  const maxRowW = zone.w - PAD * 2;
  // 分值标签高度（与 draw.ts 中 valueH 一致）：换行间距需额外留出，
  // 避免第二行牌与上一行的分值标签重叠。
  const valueH = Math.round(Math.max(10, Math.round(card.w * 0.2)) * 1.5);

  /** 用指定牌宽做流式排布，返回布局和总高度 */
  const layoutAt = (cardW: number): { list: MeldLayout[]; totalH: number } => {
    const list: MeldLayout[] = [];
    const h = Math.round(cardW * 1.42);
    let cursorX = zone.x + PAD;
    let cursorY = zone.y + PAD;

    for (const m of melds) {
      const n = m.meld.slots.length;
      const neededW = cardW + cardW * MELD_REVEAL * (n - 1);
      const remainingW = zone.x + zone.w - PAD - cursorX;

      // 放不下且不在行首 → 换行（额外留出分值标签高度，避免与上一行重叠）
      if (neededW > remainingW && cursorX > zone.x + PAD) {
        cursorX = zone.x + PAD;
        cursorY += h + GAP + valueH;
      }

      const laid = layoutMeld(
        m.meld,
        owner,
        { x: cursorX, y: cursorY, w: maxRowW, h },
        cardW,
        m.id,
        maxRowW,
      );
      list.push({
        ...laid,
        layOffable: layOffTargets.has(m.id),
      });
      cursorX += laid.rect.w + GAP;
    }
    const totalH = cursorY + h - zone.y + PAD;
    return { list, totalH };
  };

  // 第一遍：基准牌宽排布
  const first = layoutAt(card.w);
  let list = first.list;
  const totalH = first.totalH;

  // 若整体超过 zone 高度，按比例缩小重排（保留最小可见宽）
  const availH = zone.h - PAD;
  if (totalH > availH && availH > 0) {
    const scale = availH / totalH;
    const newW = Math.max(MELD_MIN_W, card.w * scale);
    ({ list } = layoutAt(newW));
  }

  return list;
}

function sortButton(area: Rect, card: CardSize): ButtonLayout {
  const s = Math.min(34, Math.round(card.h * 0.5));
  return {
    id: 'sort',
    x: area.x + 2,
    y: area.y + (area.h - s) / 2,
    w: s,
    h: s,
  };
}

/**
 * 操作按钮：跟随选中牌上移，悬浮在选中牌顶部上方中央。
 * 未选中牌时按钮不显示（label 为 null），因此不存在与手牌重叠的问题。
 */
function layoutHandActions(
  area: Rect,
  hand: HandLayout,
  input: LayoutInput,
): { actionPrimary: ButtonLayout | null; actionSecondary: ButtonLayout | null } {
  const hasPrimary = input.actionPrimaryLabel !== null;
  const hasSecondary = input.actionSecondaryLabel !== null;
  if (!hasPrimary && !hasSecondary) {
    return { actionPrimary: null, actionSecondary: null };
  }

  const gap = 10;
  const totalW =
    (hasPrimary ? ACTION_BTN_W : 0) +
    (hasSecondary ? ACTION_BTN_W : 0) +
    (hasPrimary && hasSecondary ? gap : 0);
  const x = area.x + (area.w - totalW) / 2;

  // 选中牌顶部（屏幕坐标）：选中牌 y 为负（上移），viewport.y 为手牌区顶。
  // 按钮定位在选中牌顶部上方，跟随牌升起。
  const selectedTop = hand.cards.find((f) => f.selected === true)?.y ?? 0;
  const topY = hand.viewport.y + selectedTop;
  const y = topY - ACTION_BTN_H - 8;

  const primary: ButtonLayout | null = hasPrimary
    ? {
        id: 'actionPrimary',
        x,
        y,
        w: ACTION_BTN_W,
        h: ACTION_BTN_H,
        enabled: true,
        label: input.actionPrimaryLabel,
      }
    : null;

  const secondary: ButtonLayout | null = hasSecondary
    ? {
        id: 'actionSecondary',
        x: hasPrimary ? x + ACTION_BTN_W + gap : x,
        y,
        w: ACTION_BTN_W,
        h: ACTION_BTN_H,
        enabled: true,
        label: input.actionSecondaryLabel,
      }
    : null;

  return { actionPrimary: primary, actionSecondary: secondary };
}

/**
 * 手牌布局：牌完整绘制、横向重叠、居中；空间不足时可横向滑动（Design 3.4）。
 * 左侧让位给排序按钮，右侧让位给操作按钮。
 */
function layoutHand(
  input: LayoutInput,
  area: Rect,
  card: CardSize,
): HandLayout {
  const sortW = Math.min(34, Math.round(card.h * 0.5));
  const sortGap = 6;
  const leftInset = sortW + sortGap;
  // 手牌完整绘制（不裁剪）。手牌区高度只占牌高的 70%，
  // 牌整体向下偏移，让牌底部 30% 溢出屏幕底部被窗口裁掉。
  const viewport: Rect = {
    x: area.x + leftInset,
    y: area.y,
    w: Math.max(0, area.w - leftInset - PAD),
    h: Math.round(card.h * 0.7),
  };

  const cards = input.sortedHand;
  const n = cards.length;
  if (n === 0) {
    return { viewport, cards: [], contentW: 0 };
  }

  const step = card.w * HAND_REVEAL;
  const contentW = card.w + step * (n - 1);
  // 牌少时居中；牌多时从 viewport 左开始，靠滚动显示
  const startX = contentW <= viewport.w ? (viewport.w - contentW) / 2 : 0;
  // 牌顶对齐 viewport 顶（牌完整绘制，底部溢出被屏幕裁掉）。
  // 选中时上移固定量，露出完整牌；不改变绘制顺序（不改变 z-index）。
  const baseY = 0;
  const SELECT_LIFT = Math.round(card.h * 0.3);

  const faces: CardFaceLayout[] = cards.map((c, i) => {
    const selected = input.selectedIds.has(c.id);
    return {
      card: c,
      playable: input.view.me.playable[c.id] === true,
      selected,
      x: startX + i * step,
      y: selected ? baseY - SELECT_LIFT : baseY,
      w: card.w,
      h: card.h,
      radius: card.radius,
    };
  });

  return { viewport, cards: faces, contentW };
}

/** 常规模式弃牌堆：横向**堆叠**，每张露出少量边，最新一张在最右完整可见 */
function layoutDiscardStacked(
  view: GameView,
  zone: Rect,
  card: CardSize,
): ScrollListLayout {
  const all = view.discard;
  const reveal = Math.max(18, Math.round(card.w * DISCARD_REVEAL));
  const contentW = all.length === 0 ? 0 : card.w + (all.length - 1) * reveal;
  const viewport: Rect = {
    x: zone.x + PAD + card.w + GAP,
    y: zone.y + PAD,
    w: Math.max(0, zone.w - PAD * 2 - card.w - GAP),
    h: card.h,
  };

  const cards: CardFaceLayout[] = all.map((c, i) => ({
    card: c,
    x: i * reveal,
    y: 0,
    w: card.w,
    h: card.h,
    radius: card.radius,
    highlight: view.discardPlayable[c.id] === true,
  }));

  return { viewport, cards, contentW, contentH: card.h, axis: 'x' };
}

/** 横屏模式弃牌堆：纵向**堆叠**，牌横躺，最新一张在最底完整可见 */
function layoutDiscardVertical(
  view: GameView,
  zone: Rect,
  card: CardSize,
): ScrollListLayout {
  const all = view.discard;
  const cw = card.h;
  const ch = card.w;
  const reveal = Math.max(18, Math.round(ch * DISCARD_REVEAL));
  const contentH = all.length === 0 ? 0 : ch + (all.length - 1) * reveal;
  const viewport: Rect = {
    x: zone.x + PAD,
    y: zone.y + PAD + ch + GAP,
    w: cw,
    h: Math.max(0, zone.h - PAD * 2 - ch - GAP),
  };

  const cards: CardFaceLayout[] = all.map((c, i) => ({
    card: c,
    x: 0,
    y: i * reveal,
    w: cw,
    h: ch,
    sideways: true,
    radius: card.radius,
    highlight: view.discardPlayable[c.id] === true,
  }));

  return { viewport, cards, contentW: cw, contentH, axis: 'y' };
}

function layoutDeckStacked(zone: Rect, card: CardSize): ButtonLayout {
  return {
    id: 'deck',
    x: zone.x + PAD,
    y: zone.y + PAD,
    w: card.w,
    h: card.h,
  };
}

function layoutDeckVertical(zone: Rect, card: CardSize): ButtonLayout {
  const cw = card.h;
  const ch = card.w;
  return {
    id: 'deck',
    x: zone.x + (zone.w - cw) / 2,
    y: zone.y + PAD,
    w: cw,
    h: ch,
  };
}

export type ScrollState = {
  readonly hand: number;
  readonly discard: number;
};

export type HitResult =
  | { kind: 'hand'; card: Card }
  | { kind: 'button'; id: string }
  | { kind: 'meld'; meldId: string }
  | null;

/** 命中测试：后绘制者在上，逆序检查；叠加滚动偏移，确保视觉与命中不错位 */
export function hitTest(
  layout: TableLayout,
  px: number,
  py: number,
  scroll: ScrollState,
): HitResult {
  const inside = (r: Rect): boolean =>
    px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

  // 手牌（后绘制，优先命中）：转为局部坐标再判断
  const hv = layout.hand.viewport;
  const hx = px - (hv.x - scroll.hand);
  const hy = py - hv.y;
  for (let i = layout.hand.cards.length - 1; i >= 0; i -= 1) {
    const face = layout.hand.cards[i];
    if (face === undefined) continue;
    if (
      hx >= face.x &&
      hx <= face.x + face.w &&
      hy >= face.y &&
      hy <= face.y + face.h
    ) {
      return { kind: 'hand', card: face.card };
    }
  }

  if (layout.deck !== null && inside(layout.deck)) {
    return { kind: 'button', id: 'deck' };
  }
  if (layout.actionPrimary !== null && inside(layout.actionPrimary)) {
    return { kind: 'button', id: 'actionPrimary' };
  }
  if (layout.actionSecondary !== null && inside(layout.actionSecondary)) {
    return { kind: 'button', id: 'actionSecondary' };
  }
  if (inside(layout.undo)) return { kind: 'button', id: 'undo' };
  if (inside(layout.settings)) return { kind: 'button', id: 'settings' };
  if (inside(layout.sort)) return { kind: 'button', id: 'sort' };

  // 组合区：命中可接牌的目标 meld（选中手牌后可点击追加）
  for (const meld of [...layout.myMelds, ...layout.aiMelds]) {
    if (meld.layOffable !== true) continue;
    if (inside(meld.rect)) {
      return { kind: 'meld', meldId: meld.id };
    }
  }

  // 弃牌堆：命中每张可见牌。顶牌返回 discard-top，
  // 中间牌返回 discard-deep（深层收取，从该牌到顶部全部收入）。
  const dv = layout.discard;
  if (inside(dv.viewport)) {
    const ox = dv.axis === 'x' ? dv.viewport.x - scroll.discard : dv.viewport.x;
    const oy = dv.axis === 'y' ? dv.viewport.y - scroll.discard : dv.viewport.y;
    // 逆序命中：后绘制（最新）优先，顶牌在最上层
    for (let i = dv.cards.length - 1; i >= 0; i -= 1) {
      const face = dv.cards[i];
      if (face === undefined) continue;
      const wx = face.x + ox;
      const wy = face.y + oy;
      if (px >= wx && px <= wx + face.w && py >= wy && py <= wy + face.h) {
        if (i === dv.cards.length - 1) {
          return { kind: 'button', id: 'discard-top' };
        }
        // 中间牌：只有「可深层收取（能立刻成组）」才可点击，
        // 否则返回 null（不可选），避免误选无法成组的深层牌。
        if (face.highlight === true) {
          return { kind: 'button', id: `discard-deep:${face.card.id}` };
        }
        return null;
      }
    }
  }
  return null;
}
