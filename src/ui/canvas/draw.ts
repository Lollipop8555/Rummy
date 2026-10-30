/**
 * Canvas 绘制：把 TableLayout 画出来。
 *
 * 与 layout.ts 分离的好处：布局可单测，绘制可替换（换皮不动布局）。
 * 所有坐标都来自 layout，绘制层不做任何位置计算。
 *
 * 手牌与弃牌堆是「可滚动列表」：牌在 viewport 局部坐标下完整绘制，
 * 通过 ctx.clip() 裁剪到 viewport，滚动偏移叠加到 x/y。
 */

import { isJoker, rankLabel, type Card, type Suit } from '../../core/cards';
import { opponentHandCardRect } from './layout';
import type {
  ButtonLayout,
  CardFaceLayout,
  MeldLayout,
  ScrollState,
  TableLayout,
} from './layout';

const SUIT_SYMBOL: Record<Suit, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

const COLOR_PAPER = '#fdfbf5';
const COLOR_INK = '#16211d';
const COLOR_RED = '#c0392b';
const COLOR_GOLD = '#d9a93a';
const COLOR_MINE = '#6fd3a8';
const COLOR_OPP = '#e08a3c';
const COLOR_MUTED = '#8aa79b';

/** 飞行中的牌：从起点飞到终点，progress 0..1。旋转角单位为弧度。 */
export type FlyingCard = {
  /**
   * 牌面。`null` 表示「牌面未知」（对手摸牌），此时必须以 `faceDown` 绘制牌背，
   * 否则会向玩家泄露对手手牌内容。
   */
  readonly card: Card | null;
  /** 是否绘制牌背（对手摸牌：牌面未知） */
  readonly faceDown?: boolean;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  /** 起点牌宽高（竖牌） */
  readonly fromW: number;
  readonly fromH: number;
  /** 终点牌宽高 */
  readonly toW: number;
  readonly toH: number;
  readonly fromRotation: number;
  readonly toRotation: number;
  readonly radius: number;
  readonly progress: number;
};

export type DrawInput = {
  readonly layout: TableLayout;
  readonly dpr: number;
  readonly scroll: ScrollState;
  /** 正在飞行的牌（最上层绘制；静态层跳过同 id 的牌，避免重影） */
  readonly flying?: readonly FlyingCard[];
  readonly topbarText: {
    readonly score: string;
    readonly round: string;
    readonly opponentName: string;
    readonly opponentDesc: string;
    readonly opponentHandCount: number;
    readonly sortLabel: string;
    readonly undoEnabled: boolean;
    readonly deckEnabled: boolean;
    readonly deckEmpty: boolean;
  };
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawCardBack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  dim: boolean,
): void {
  ctx.save();
  if (dim) ctx.globalAlpha = 0.55;

  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#1d3f57');
  grad.addColorStop(1, '#10222f');
  roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();

  roundRect(ctx, x + 5, y + 5, w - 10, h - 10, Math.max(2, radius * 0.6));
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.stroke();

  ctx.restore();
}

/**
 * 绘制一张牌。
 *
 * 「横过来」用 Canvas 真实旋转实现：以牌中心为原点顺时针旋转 90°，
 * 之后一切都按「竖牌」的坐标画——文字自然也是横躺的（Design 4）。
 */
function drawCardFace(ctx: CanvasRenderingContext2D, face: CardFaceLayout): void {
  if (face.sideways === true) {
    const cx = face.x + face.w / 2;
    const cy = face.y + face.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 2);
    const uprightW = face.h;
    const uprightH = face.w;
    drawCardFaceUpright(ctx, {
      ...face,
      x: -uprightW / 2,
      y: -uprightH / 2,
      w: uprightW,
      h: uprightH,
    });
    ctx.restore();
    return;
  }
  drawCardFaceUpright(ctx, face);
}

function drawCardFaceUpright(
  ctx: CanvasRenderingContext2D,
  face: CardFaceLayout,
): void {
  const { x, y, w, h, card, radius } = face;
  const joker = isJoker(card);

  // 阴影
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = joker ? '#f4ead2' : COLOR_PAPER;
  ctx.fill();
  ctx.restore();

  // 边框
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 模拟牌（王牌顶替）：**内**金色细描边。
  //
  // 语义分工（Design 6）：金色 = 王牌标记 / 分值；青绿 = 可操作。
  // 因此这里必须是金色，且画在**牌内**——表示「这张牌本身是王牌顶的」，
  // 是牌的固有属性，与「此刻能否点它」无关。
  if (face.simulated === true) {
    roundRect(ctx, x + 2, y + 2, w - 4, h - 4, Math.max(2, radius - 2));
    ctx.strokeStyle = COLOR_GOLD;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 不可打出：轻压暗（不缩小、不消失）——Design 6：rgba(8,18,14,0.2)
  if (face.playable === false) {
    roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = 'rgba(8,18,14,0.2)';
    ctx.fill();
  }

  // 王牌顶替出的「点数 + 花色」：组合里由 layout 提供 displaySuit/displayRank。
  // 顶替时按自然牌排版（这样顺子/同点数组的读法一致），只是颜色改为金色并加 ★ 角标。
  const simulatedSuit: Suit | null =
    (face.displaySuit as Suit | undefined) ?? null;
  const simulatedRank: number | null = face.displayRank ?? null;
  const effectiveSuit: Suit | null = joker ? simulatedSuit : card.suit;
  const red = effectiveSuit !== null && (effectiveSuit === 'H' || effectiveSuit === 'D');
  const rankText = isJoker(card)
    ? simulatedRank === null
      ? ''
      : rankLabel(simulatedRank)
    : rankLabel(face.displayRank ?? card.rank);
  const suitText = effectiveSuit === null ? '' : SUIT_SYMBOL[effectiveSuit];

  if (joker && simulatedSuit === null) {
    // 手牌中的王牌（尚未顶替）：牌面只有一个自适应缩放的 JOKER 标记，绝不出界
    const pad = Math.max(4, Math.round(w * 0.1));
    ctx.fillStyle = '#8a6d1f';
    fillFitText(ctx, 'JOKER', x + w / 2, y + h * 0.52, w - pad * 2, Math.min(w, h) * 0.26, '800');
    fillFitText(ctx, '★', x + w / 2, y + h * 0.3, w - pad * 2, Math.min(w, h) * 0.16, '700');
  } else {
    ctx.fillStyle = red ? COLOR_RED : COLOR_INK;
    const fs = Math.round(w * 0.3);
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(rankText, x + w * 0.08, y + h * 0.06);
    ctx.font = `700 ${Math.round(w * 0.24)}px system-ui, sans-serif`;
    ctx.fillText(suitText, x + w * 0.08, y + h * 0.06 + fs * 0.95);

    ctx.font = `400 ${Math.round(w * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.9;
    ctx.fillText(suitText, x + w / 2, y + h * 0.52);
    ctx.globalAlpha = 1;
  }

  // 王牌顶替标记：金色 ★（不影响点数/花色阅读，同时明确「这不是自然牌」）
  if (joker && simulatedSuit !== null) {
    drawSimulatedBadge(ctx, x, y, w, radius);
  }

  // 弃牌堆中「可取」的牌：青绿**外侧**光环，提示玩家现在可以点击它。
  //
  // 这里原先用金色内描边，与「王牌顶替」完全同色同画法，玩家分不清
  // 「这张牌是王牌顶的」和「这张牌我现在能取」。可操作统一改用青绿光环：
  // - 颜色 = 青绿（与牌堆可取、可接牌目标一致，全应用只有一种「可操作」颜色）
  // - 位置 = 牌外侧（画在牌内像牌面装饰，画在外侧才读作「可点」）
  if (face.highlight === true) {
    ctx.save();
    // 描边压着牌边画（一半在内一半在外），而不是整圈外扩：
    // 弃牌堆有 ctx.clip() 裁到 viewport，外扩的圆角会被切掉一截。
    ctx.shadowColor = 'rgba(111,211,168,0.6)';
    ctx.shadowBlur = 8;
    roundRect(ctx, x, y, w, h, radius);
    ctx.strokeStyle = COLOR_MINE;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  // 选中：上移由 layout 决定，这里只描边
  if (face.selected === true) {
    roundRect(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(2, radius - 1));
    ctx.strokeStyle = COLOR_MINE;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

/**
 * 王牌顶替角标：右上角一枚小 ★ 圆点。
 *
 * 为什么不做整块「JOKER」文字：组合里的牌会被缩到 24–84px 宽，
 * 大段文字必然出界或被裁切（这是用户明确反馈的问题）。
 * 用固定像素尺寸的角标，任何牌宽下都不会溢出。
 */
function drawSimulatedBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  radius: number,
): void {
  const r = Math.max(4, Math.min(7, Math.round(w * 0.13)));
  const cx = x + w - r - Math.max(2, radius * 0.4);
  const cy = y + r + Math.max(2, radius * 0.4);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = COLOR_GOLD;
  ctx.fill();
  ctx.fillStyle = '#201804';
  ctx.font = `700 ${Math.round(r * 1.25)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('★', cx, cy + 0.5);
  ctx.restore();
}

/**
 * 在给定最大宽度内绘制单行文字，超宽时自动缩小字号。
 *
 * 用于「JOKER」这类固定文案：牌宽变化时靠缩字号而不是靠裁切，
 * 因此任何尺寸都不会出现文字出界（用户反馈的裁切问题）。
 */
function fillFitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxW: number,
  preferredPx: number,
  weight: string,
): void {
  let px = Math.max(6, Math.round(preferredPx));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${weight} ${px}px system-ui, sans-serif`;
  const measured = ctx.measureText(text).width;
  if (measured > maxW && measured > 0) {
    px = Math.max(6, Math.floor((px * maxW) / measured));
    ctx.font = `${weight} ${px}px system-ui, sans-serif`;
  }
  ctx.fillText(text, cx, cy);
}

function drawMeld(
  ctx: CanvasRenderingContext2D,
  meld: MeldLayout,
  radius: number,
  skipIds: ReadonlySet<string>,
): void {
  // 底板（用基准圆角，不随缩小牌变，保持视觉一致）
  roundRect(ctx, meld.rect.x - 3, meld.rect.y - 3, meld.rect.w + 6, meld.rect.h + 6, radius + 3);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fill();
  ctx.strokeStyle =
    meld.owner === 'player'
      ? 'rgba(111,211,168,0.24)'
      : 'rgba(224,138,60,0.26)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 可接牌目标：亮绿高亮边框，提示可点击追加
  if (meld.layOffable === true) {
    roundRect(ctx, meld.rect.x - 4, meld.rect.y - 4, meld.rect.w + 8, meld.rect.h + 8, radius + 4);
    ctx.strokeStyle = COLOR_MINE;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  for (const face of meld.cards) {
    if (skipIds.has(face.card.id)) continue;
    drawCardFace(ctx, face);
  }
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  r: ButtonLayout,
  kind: 'gear' | 'undo' | 'sort',
  enabled: boolean,
  sortLabel: string,
): void {
  ctx.save();
  if (!enabled) ctx.globalAlpha = 0.32;
  ctx.beginPath();
  ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  ctx.save();
  if (!enabled) ctx.globalAlpha = 0.32;
  ctx.strokeStyle = '#fdfbf5';
  ctx.fillStyle = '#fdfbf5';
  ctx.lineWidth = Math.max(1.6, r.w * 0.06);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const s = r.w * 0.34;

  if (kind === 'gear') {
    const teeth = 8;
    const rOuter = s;
    const rInner = s * 0.74;
    const toothHalf = (Math.PI / teeth) * 0.34;
    ctx.beginPath();
    for (let i = 0; i < teeth; i += 1) {
      const a = (i / teeth) * Math.PI * 2;
      const a1 = a - toothHalf;
      const a2 = a + toothHalf;
      const a3 = a + (Math.PI / teeth) - toothHalf;
      const a4 = a + (Math.PI / teeth) + toothHalf;
      if (i === 0) {
        ctx.moveTo(cx + Math.cos(a1) * rInner, cy + Math.sin(a1) * rInner);
      } else {
        ctx.lineTo(cx + Math.cos(a1) * rInner, cy + Math.sin(a1) * rInner);
      }
      ctx.lineTo(cx + Math.cos(a2) * rOuter, cy + Math.sin(a2) * rOuter);
      ctx.lineTo(cx + Math.cos(a3) * rOuter, cy + Math.sin(a3) * rOuter);
      ctx.lineTo(cx + Math.cos(a4) * rInner, cy + Math.sin(a4) * rInner);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.32, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === 'undo') {
    const r = s * 0.78;
    const start = Math.PI * 0.62;
    const end = Math.PI * 2.28;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end, false);
    ctx.stroke();

    const ax = cx + Math.cos(start) * r;
    const ay = cy + Math.sin(start) * r;
    const arrowSize = s * 0.42;
    ctx.beginPath();
    ctx.moveTo(ax, ay - arrowSize);
    ctx.lineTo(ax - arrowSize * 0.72, ay + arrowSize * 0.24);
    ctx.lineTo(ax + arrowSize * 0.72, ay + arrowSize * 0.24);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.font = `700 ${Math.round(r.w * 0.46)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sortLabel, cx, cy + 1);
  }
  ctx.restore();
}

function drawActionButton(
  ctx: CanvasRenderingContext2D,
  btn: ButtonLayout | null,
  primary: boolean,
): void {
  if (btn === null) return;
  const enabled = btn.enabled !== false;

  ctx.save();
  if (!enabled) ctx.globalAlpha = 0.3;

  roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 9);
  if (primary) {
    ctx.fillStyle = COLOR_MINE;
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.fillStyle = primary ? '#06231a' : '#fdfbf5';
  ctx.font = '600 12.5px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(btn.label ?? '', btn.x + btn.w / 2, btn.y + btn.h / 2);
  ctx.restore();
}

function drawTopbar(
  ctx: CanvasRenderingContext2D,
  layout: TableLayout,
  topbarText: DrawInput['topbarText'],
): void {
  const card = layout.card;
  const cy = layout.topbar.h / 2;
  let x = 12;

  // 比分（我方青绿 + 分隔 + 对手橙）
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const mine = topbarText.score.split(':')[0]?.trim() ?? '';
  const opp = topbarText.score.split(':')[1]?.trim() ?? '';
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillStyle = COLOR_MINE;
  ctx.fillText(mine, x, cy);
  const mineW = ctx.measureText(mine).width;
  ctx.fillStyle = COLOR_MUTED;
  ctx.fillText(':', x + mineW + 4, cy);
  const colonW = ctx.measureText(':').width;
  ctx.fillStyle = COLOR_OPP;
  ctx.fillText(opp, x + mineW + 8 + colonW, cy);
  const oppScoreW = ctx.measureText(opp).width;
  x += mineW + 8 + colonW + oppScoreW + 14;

  // 轮次
  ctx.fillStyle = COLOR_MUTED;
  ctx.font = '400 11px system-ui, sans-serif';
  ctx.fillText(topbarText.round, x, cy);
  const roundW = ctx.measureText(topbarText.round).width;
  x += roundW + 14;

  // 对手头像 + 名称 + 强度描述（两行）
  const avatarR = 9;
  ctx.beginPath();
  ctx.arc(x + avatarR, cy, avatarR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(224,138,60,0.85)';
  ctx.fill();
  ctx.fillStyle = '#0b2018';
  ctx.font = '700 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(topbarText.opponentName.slice(0, 1), x + avatarR, cy + 0.5);
  x += avatarR * 2 + 6;

  ctx.textAlign = 'left';
  ctx.fillStyle = '#fdfbf5';
  ctx.font = '600 11.5px system-ui, sans-serif';
  ctx.fillText(topbarText.opponentName, x, cy - 6);
  ctx.fillStyle = COLOR_MUTED;
  ctx.font = '400 10px system-ui, sans-serif';
  ctx.fillText(topbarText.opponentDesc, x, cy + 6);
  const nameW = ctx.measureText(topbarText.opponentName).width;
  const descW = ctx.measureText(topbarText.opponentDesc).width;
  x += Math.max(nameW, descW) + 10;

  // 对手手牌：位置**完全来自 layout.opponentHandBand**。
  // 绘制、以及 GameCanvas 的「对手出牌动画起点」共用这份几何，
  // 因此对手的牌必然从顶栏的对手手牌处飞出，不会从玩家手牌区冒出。
  const band = layout.opponentHandBand;
  const step = Math.round(card.w * 0.55);
  const oppCount = topbarText.opponentHandCount;

  if (band.w > 0 && oppCount > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(band.x, band.y, band.w, band.h);
    ctx.clip();
    const maxVisible = Math.min(oppCount, Math.ceil(band.w / step) + 1);
    for (let i = 0; i < maxVisible; i += 1) {
      const r = opponentHandCardRect(layout, i);
      drawCardBack(ctx, r.x, r.y, r.w, r.h, card.radius, false);
    }
    ctx.restore();
  }
}

export function drawTable(ctx: CanvasRenderingContext2D, input: DrawInput): void {
  const { layout, dpr, topbarText, scroll } = input;
  const { width, height, card } = layout;
  // 飞行中的牌 id：静态层跳过这些牌，避免与飞行层重影。
  // 牌面未知（对手摸牌）的飞行牌没有 id，不参与跳过。
  const flyingIds = new Set(
    (input.flying ?? [])
      .map((f) => f.card?.id)
      .filter((id): id is string => id !== undefined),
  );

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // ---- 区域底纹
  for (const [rect, border] of [
    [layout.zoneAiMelds, 'rgba(224,138,60,0.3)'],
    [layout.zonePublic, 'rgba(255,255,255,0.13)'],
    [layout.zoneMine, 'rgba(111,211,168,0.28)'],
  ] as const) {
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ---- 顶栏
  drawTopbar(ctx, layout, topbarText);

  // ---- 圆形按钮
  drawButton(ctx, layout.settings, 'gear', true, '');
  drawButton(ctx, layout.sort, 'sort', true, topbarText.sortLabel);
  drawButton(ctx, layout.undo, 'undo', topbarText.undoEnabled, '');

  // ---- 组合
  for (const m of layout.aiMelds) drawMeld(ctx, m, card.radius, flyingIds);
  for (const m of layout.myMelds) drawMeld(ctx, m, card.radius, flyingIds);

  // 组合分数：字号随牌宽缩放（Design 3.2：字号 ≈ 牌宽 × 0.2）
  const valueFont = Math.max(10, Math.round(card.w * 0.2));
  const valuePadX = Math.round(valueFont * 0.5);
  const valueH = Math.round(valueFont * 1.5);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${valueFont}px system-ui, sans-serif`;
  for (const m of [...layout.aiMelds, ...layout.myMelds]) {
    const label = String(m.value);
    const textW = ctx.measureText(label).width;
    const bx = m.rect.x + m.rect.w / 2;
    const by = m.rect.y + m.rect.h + valueH / 2 + 2;
    roundRect(ctx, bx - textW / 2 - valuePadX, by - valueH / 2, textW + valuePadX * 2, valueH, valueH / 2);
    ctx.fillStyle = 'rgba(217,169,58,0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(217,169,58,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = COLOR_GOLD;
    ctx.fillText(label, bx, by);
  }

  // ---- 牌堆
  if (layout.deck !== null) {
    const d = layout.deck;
    if (topbarText.deckEmpty) {
      roundRect(ctx, d.x, d.y, d.w, d.h, card.radius);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      drawCardBack(ctx, d.x, d.y, d.w, d.h, card.radius, !topbarText.deckEnabled);
      if (topbarText.deckEnabled) {
        roundRect(ctx, d.x - 2, d.y - 2, d.w + 4, d.h + 4, card.radius + 2);
        ctx.strokeStyle = COLOR_MINE;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // ---- 弃牌堆（可滚动列表，完整绘制 + 裁剪）
  drawScrollList(ctx, layout.discard, layout.discard.axis, scroll.discard, flyingIds);

  // ---- 手牌：未选中牌在 viewport 内裁剪绘制，选中牌单独绘制（不裁剪，覆盖到组合区）
  drawHand(ctx, layout.hand, scroll.hand, flyingIds);

  // ---- 操作条按钮
  drawActionButton(ctx, layout.actionPrimary, true);
  drawActionButton(ctx, layout.actionSecondary, false);

  // ---- 飞行中的牌（最上层）
  for (const f of input.flying ?? []) {
    drawFlyingCard(ctx, f);
  }

  ctx.restore();
}

/** 绘制飞行中的牌：位置/尺寸/旋转角在起点终点之间线性插值 */
function drawFlyingCard(ctx: CanvasRenderingContext2D, f: FlyingCard): void {
  const p = f.progress;
  const x = f.fromX + (f.toX - f.fromX) * p;
  const y = f.fromY + (f.toY - f.fromY) * p - Math.sin(p * Math.PI) * 24;
  const w = f.fromW + (f.toW - f.fromW) * p;
  const h = f.fromH + (f.toH - f.fromH) * p;
  const rotation = f.fromRotation + (f.toRotation - f.fromRotation) * p;
  // 以牌中心为原点旋转，绕中心飞
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.save();
  // 起始几帧淡入：前半段 0→1，避免终点闪现
  ctx.globalAlpha = Math.min(1, p * 4);
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.translate(-w / 2, -h / 2);
  if (f.faceDown === true || f.card === null) {
    // 信息公平：对手摸到的牌不可见，全程只画牌背
    drawCardBack(ctx, 0, 0, w, h, f.radius, false);
  } else {
    drawCardFace(ctx, {
      card: f.card,
      x: 0,
      y: 0,
      w,
      h,
      radius: f.radius,
    });
  }
  ctx.restore();
}

function drawScrollList(
  ctx: CanvasRenderingContext2D,
  list: { viewport: { x: number; y: number; w: number; h: number }; cards: readonly CardFaceLayout[] },
  axis: 'x' | 'y',
  offset: number,
  skipIds: ReadonlySet<string>,
): void {
  const vp = list.viewport;
  ctx.save();
  ctx.beginPath();
  ctx.rect(vp.x, vp.y, vp.w, vp.h);
  ctx.clip();
  const ox = axis === 'x' ? vp.x - offset : vp.x;
  const oy = axis === 'y' ? vp.y - offset : vp.y;
  for (const face of list.cards) {
    if (skipIds.has(face.card.id)) continue;
    drawCardFace(ctx, { ...face, x: face.x + ox, y: face.y + oy });
  }
  ctx.restore();
}

/**
 * 手牌绘制：整手牌是独立层级，**不做 viewport 裁剪**。
 * 牌完整绘制，牌底 30% 自然溢出屏幕底部被窗口裁掉；
 * 选中牌上移后完整可见，遮挡上方组合区也无妨。
 * 所有牌按数组顺序绘制，不改变 z-index。
 */
function drawHand(
  ctx: CanvasRenderingContext2D,
  hand: { viewport: { x: number; y: number; w: number; h: number }; cards: readonly CardFaceLayout[] },
  offset: number,
  skipIds: ReadonlySet<string>,
): void {
  const vp = hand.viewport;
  const ox = vp.x - offset;
  for (const face of hand.cards) {
    if (skipIds.has(face.card.id)) continue;
    drawCardFace(ctx, { ...face, x: face.x + ox, y: face.y + vp.y });
  }
}
