/**
 * Canvas 牌桌。
 *
 * 职责边界：
 * - 布局：`computeLayout()` 纯函数，给尺寸与视图，得到所有元素的矩形
 * - 绘制：`drawTable()` 只按布局画，不做位置计算
 * - 交互：`hitTest()` 用同一份布局反查点击目标，因此视觉与命中永不错位
 *
 * 交互采用「pointerdown 记录起点 → pointerup 判定」的闭环：
 * - 位移小于阈值 → 视为点击，分发到 hitTest 命中的目标。
 * - 位移大于阈值 → 视为拖拽滚动（手牌/弃牌堆）。
 * 不使用 onClick + setPointerCapture 的组合（二者在移动端会互相抢占，
 * 导致点击无法触发，出现「无法弃牌」的问题）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Card } from '../../core/cards';
import type { GameView } from '../../core/view';
import type { Action } from '../../core/engine';
import {
  computeLayout,
  hitTest,
  type ScrollState,
  type TableLayout,
} from './layout';
import { drawTable, type FlyingCard } from './draw';
import type { SortMode } from './sort';
import { sortHand } from './sort';

export type GameCanvasProps = {
  readonly view: GameView;
  readonly sortMode: SortMode;
  readonly selectedIds: ReadonlySet<string>;
  readonly topbarText: Parameters<typeof drawTable>[1]['topbarText'];
  /** 操作按钮文案；null 表示当前阶段无操作 */
  readonly actionPrimaryLabel: string | null;
  readonly actionSecondaryLabel: string | null;
  /** 当前选中单张牌可接的 meld id 集合（接牌目标高亮） */
  readonly layOffTargets?: ReadonlySet<string>;
  readonly onCardClick: (card: Card) => void;
  readonly onMeldClick: (meldId: string) => void;
  readonly onAction: (action: Action) => void;
  readonly onOpenSettings: () => void;
  readonly onToggleSort: () => void;
  readonly onActionPrimary: () => void;
  readonly onActionSecondary: () => void;
};

/** 位移超过该值即视为「滚动」而非「点击」 */
const DRAG_THRESHOLD = 6;

function clampScroll(offset: number, max: number): number {
  return Math.min(max, Math.max(0, offset));
}

export function GameCanvas(props: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const layoutRef = useRef<TableLayout | null>(null);
  const [scroll, setScroll] = useState<ScrollState>({ hand: 0, discard: 0 });
  const scrollRef = useRef<ScrollState>({ hand: 0, discard: 0 });
  // 飞行动画：用 ref 保存（不进 state，绕开 React 渲染时序导致的闪帧）
  const flyingRef = useRef<readonly FlyingCard[]>([]);
  const rafRef = useRef<number | null>(null);
  // 动画进行中标记：true 时静态层跳过飞行牌、由飞行层绘制
  const animatingRef = useRef(false);
  // 上一次的弃牌堆 / 手牌，用于检测新增
  const prevDiscardRef = useRef<readonly string[]>([]);
  const prevHandRef = useRef<readonly string[]>([]);
  /** 上次的对手手牌张数：用于检测「对手摸牌」并播放牌背飞入 */
  const prevOppCountRef = useRef<number>(-1);
  /** 上次的轮次：轮次切换会重发牌，此时手牌数变化不代表「摸牌」 */
  const prevRoundRef = useRef<number>(-1);
  // 上一帧桌面上已有的牌 id（用于检测亮牌/接牌新增的牌）
  const prevTableCardsRef = useRef<readonly string[]>([]);
  // 上一帧布局：用于计算 animation 起点（被移动的牌原来的位置）
  const lastLayoutRef = useRef<TableLayout | null>(null);

  // 指针按下时的状态：记录起点、可滚动区域、初始偏移、是否已移动
  const pointerRef = useRef<{
    axis: 'hand' | 'discard' | 'none';
    startX: number;
    startY: number;
    startOffset: number;
    moved: boolean;
  }>({ axis: 'none', startX: 0, startY: 0, startOffset: 0, moved: false });

  // 容器尺寸：用 ResizeObserver 而非 window.resize
  useEffect(() => {
    const el = canvasRef.current?.parentElement;
    if (el === null || el === undefined) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box === undefined) return;
      setSize({ w: Math.round(box.width), h: Math.round(box.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sortedHand = useMemo(
    () => sortHand(props.view.me.cards, props.sortMode),
    [props.view.me.cards, props.sortMode],
  );

  const layout = useMemo(() => {
    if (size.w === 0 || size.h === 0) return null;
    return computeLayout({
      view: props.view,
      width: size.w,
      height: size.h,
      selectedIds: props.selectedIds,
      sortMode: props.sortMode,
      sortedHand,
      actionPrimaryLabel: props.actionPrimaryLabel,
      actionSecondaryLabel: props.actionSecondaryLabel,
      layOffTargets: props.layOffTargets ?? new Set<string>(),
    });
  }, [
    size,
    props.view,
    props.selectedIds,
    props.sortMode,
    props.actionPrimaryLabel,
    props.actionSecondaryLabel,
    props.layOffTargets,
    sortedHand,
  ]);

  layoutRef.current = layout;

  // 手牌数或布局变化时，把滚动偏移收敛到合法范围
  useEffect(() => {
    if (layout === null) return;
    const maxHand = Math.max(0, layout.hand.contentW - layout.hand.viewport.w);
    const maxDiscard =
      layout.discard.axis === 'x'
        ? Math.max(0, layout.discard.contentW - layout.discard.viewport.w)
        : Math.max(0, layout.discard.contentH - layout.discard.viewport.h);
    const next = {
      hand: clampScroll(scrollRef.current.hand, maxHand),
      discard: clampScroll(scrollRef.current.discard, maxDiscard),
    };
    if (next.hand !== scrollRef.current.hand || next.discard !== scrollRef.current.discard) {
      scrollRef.current = next;
      setScroll(next);
    }
  }, [layout]);

  // 最新绘制输入存 ref，供命令式重绘读取（避免依赖 state 的渲染时序）
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const topbarRef = useRef(props.topbarText);
  topbarRef.current = props.topbarText;

  /** 命令式重绘：直接读 ref 里最新的布局/尺寸/滚动/飞行状态绘制一帧 */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const lay = layoutRef.current;
    const sz = sizeRef.current;
    if (canvas === null || lay === null) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(sz.w * dpr);
    const ph = Math.round(sz.h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = `${String(sz.w)}px`;
      canvas.style.height = `${String(sz.h)}px`;
    }
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    drawTable(ctx, {
      layout: lay,
      dpr,
      topbarText: topbarRef.current,
      scroll: scrollRef.current,
      flying: flyingRef.current,
    });
  }, []);

  /** 启动一次飞行动画：命令式逐帧重绘，完全绕开 React state 时序 */
  const flyCards = useCallback(
    (bases: readonly FlyingCard[]) => {
      if (bases.length === 0) return;
      const duration = 340;
      const startedAt = performance.now();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      animatingRef.current = true;
      const tick = (now: number): void => {
        const p = Math.min(1, (now - startedAt) / duration);
        // 起始几帧从透明淡入，避免终点闪现
        flyingRef.current = bases.map((b) => ({ ...b, progress: p }));
        redraw();
        if (p < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          flyingRef.current = [];
          animatingRef.current = false;
          rafRef.current = null;
          redraw();
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [redraw],
  );

  // 手牌某张牌在当前布局中的屏幕落点（局部坐标 + viewport 原点 - 滚动）
  const handFaceScreen = useCallback(
    (lay: TableLayout, cardId: string): { x: number; y: number; w: number; h: number } | null => {
      const face = lay.hand.cards.find((f) => f.card.id === cardId);
      if (face === undefined) return null;
      return {
        x: lay.hand.viewport.x - scrollRef.current.hand + face.x,
        y: lay.hand.viewport.y + face.y,
        w: face.w,
        h: face.h,
      };
    },
    [],
  );

  /**
   * 某张牌在上一帧中属于谁的手牌：
   * - 在上一帧的**我方手牌**里 → 从它在手牌中的位置飞出
   * - 否则 → 是对手的牌，从**顶栏对手手牌带**飞出
   *
   * 这是「对手出牌却从我手牌里飞出去」的直接修复点：此前无条件下手牌位置，
   * 对手的牌找不到时便退化成手牌区中心，于是看起来像从自己手里飞出。
   */
  const originForSide = useCallback(
    (lastLay: TableLayout, cardId: string): { x: number; y: number; w: number; h: number } => {
      const mine = handFaceScreen(lastLay, cardId);
      if (mine !== null) return mine;
      // 不在上一帧的我方手牌里 → 对手的牌，从顶栏对手手牌带最右侧飞出
      const cs = lastLay.card;
      const band = lastLay.opponentHandBand;
      return {
        // 与 opponentHandCardRect 保持同一套几何：取手牌带最右一张的位置
        x: band.x + Math.max(0, band.w - cs.w),
        y: band.y + band.h - cs.h,
        w: cs.w,
        h: cs.h,
      };
    },
    [handFaceScreen],
  );

  // 检测弃牌堆新增（弃牌）：牌从它**原来所在的那只手牌**飞向弃牌堆顶
  useEffect(() => {
    const ids = props.view.discard.map((c) => c.id);
    const prev = prevDiscardRef.current;
    if (prev.length > 0 && ids.length > prev.length && layout !== null) {
      const card = props.view.discard[props.view.discard.length - 1];
      const dv = layout.discard;
      const last = dv.cards[dv.cards.length - 1];
      const lastLay = lastLayoutRef.current;
      if (card !== undefined && last !== undefined) {
        // 新增一张牌后先把视口滚到最新端，保证玩家「看到牌被弃出去」，
        // 而不是弃到视口之外、看起来像消失。
        const maxDiscard =
          dv.axis === 'x'
            ? Math.max(0, dv.contentW - dv.viewport.w)
            : Math.max(0, dv.contentH - dv.viewport.h);
        if (scrollRef.current.discard !== maxDiscard) {
          scrollRef.current = { ...scrollRef.current, discard: maxDiscard };
          setScroll(scrollRef.current);
        }
        const cs = layout.card;
        const origin = lastLay !== null ? originForSide(lastLay, card.id) : null;
        const toX = last.x + dv.viewport.x - scrollRef.current.discard;
        const toY = last.y + dv.viewport.y;
        flyCards([{
          card,
          fromX: origin?.x ?? layout.hand.viewport.x + layout.hand.viewport.w / 2,
          fromY: origin?.y ?? layout.hand.viewport.y,
          toX,
          toY,
          fromW: origin?.w ?? cs.w,
          fromH: origin?.h ?? cs.h,
          toW: last.w,
          toH: last.h,
          fromRotation: 0,
          // 横屏弃牌堆牌是横躺的，终点旋转 π/2
          toRotation: last.sideways === true ? Math.PI / 2 : 0,
          radius: last.radius,
          progress: 0,
        }]);
      }
    }
    prevDiscardRef.current = ids;
  }, [props.view.discard, layout, flyCards, originForSide]);

  // 检测手牌新增（摸牌）：牌从牌堆飞向它在手牌中的实际落点
  useEffect(() => {
    const ids = props.view.me.cards.map((c) => c.id);
    const prev = prevHandRef.current;
    if (prev.length > 0 && ids.length > prev.length && layout !== null) {
      const newId = ids.find((id) => !prev.includes(id));
      const card = props.view.me.cards.find((c) => c.id === newId);
      const deck = layout.deck;
      const cs = layout.card;
      // 新牌按排序插在手牌中任意位置（不是末尾），所以必须按它**实际落点**
      // 调整横向滚动，否则摸到的牌可能落在视口外，玩家看不到「牌进来了」。
      if (newId !== undefined) {
        const face = layout.hand.cards.find((f) => f.card.id === newId);
        if (face !== undefined) {
          const maxHand = Math.max(0, layout.hand.contentW - layout.hand.viewport.w);
          const left = scrollRef.current.hand;
          const right = left + layout.hand.viewport.w;
          let next = left;
          if (face.x < left) {
            next = face.x;
          } else if (face.x + face.w > right) {
            next = face.x + face.w - layout.hand.viewport.w;
          }
          next = clampScroll(next, maxHand);
          if (next !== left) {
            scrollRef.current = { ...scrollRef.current, hand: next };
            setScroll(scrollRef.current);
          }
        }
      }
      const target = newId !== undefined ? handFaceScreen(layout, newId) : null;
      if (card !== undefined && deck !== null) {
        flyCards([{
          card,
          fromX: deck.x + deck.w / 2 - cs.w / 2,
          fromY: deck.y + deck.h / 2 - cs.h / 2,
          toX: target?.x ?? layout.hand.viewport.x + layout.hand.viewport.w / 2,
          toY: target?.y ?? layout.hand.viewport.y,
          // 牌堆横屏时是横躺的（从 sideways），手牌是竖牌
          fromW: deck.w,
          fromH: deck.h,
          toW: cs.w,
          toH: target === null ? cs.h : cs.w * 1.42,
          fromRotation: deck.w > deck.h ? Math.PI / 2 : 0,
          toRotation: 0,
          radius: cs.radius,
          progress: 0,
        }]);
      }
    }
    prevHandRef.current = ids;
  }, [props.view.me.cards, layout, flyCards, handFaceScreen]);

  /**
   * 检测对手摸牌：牌从牌堆飞向**对手手牌带**，且只画牌背。
   *
   * 信息公平：对手摸到的牌对玩家不可见，因此 `card` 传 null + `faceDown`，
   * 飞行过程中绝不解码牌面。
   */
  useEffect(() => {
    const count = props.view.opponentHandCount;
    const round = props.view.roundIndex;
    const prev = prevOppCountRef.current;
    const sameRound = prevRoundRef.current === round;
    prevOppCountRef.current = count;
    prevRoundRef.current = round;
    // 新一轮重发牌时手牌数会跳变，那不是「摸牌」，不播动画
    if (!sameRound || prev < 0 || count <= prev || layout === null) return;
    const deck = layout.deck;
    if (deck === null) return;
    const cs = layout.card;
    const band = layout.opponentHandBand;
    flyCards([{
      card: null,
      faceDown: true,
      fromX: deck.x + deck.w / 2 - cs.w / 2,
      fromY: deck.y + deck.h / 2 - cs.h / 2,
      toX: band.x + Math.max(0, band.w - cs.w),
      toY: band.y + band.h - cs.h,
      fromW: deck.w,
      fromH: deck.h,
      toW: cs.w,
      toH: cs.h,
      fromRotation: deck.w > deck.h ? Math.PI / 2 : 0,
      toRotation: 0,
      radius: cs.radius,
      progress: 0,
    }]);
  }, [props.view.opponentHandCount, props.view.roundIndex, layout, flyCards]);

  // 检测桌面组合新增（亮牌 / 接牌）：新增的牌从它在手牌中的原位置飞到组合区
  useEffect(() => {
    if (layout === null) {
      prevTableCardsRef.current = [];
      return;
    }
    const curTableCards: string[] = [];
    for (const m of props.view.table) {
      for (const slot of m.meld.slots) curTableCards.push(slot.card.id);
    }
    const prev = prevTableCardsRef.current;
    const lastLay = lastLayoutRef.current;
    const added = curTableCards.filter((id) => !prev.includes(id));
    if (prev.length > 0 && added.length > 0) {
      // 桌面所有牌的位置（按 id），供查目标点
      const tableFaces: { id: string; x: number; y: number; w: number; h: number; radius: number; sideways: boolean }[] = [];
      for (const m of [...layout.myMelds, ...layout.aiMelds]) {
        for (const face of m.cards) {
          tableFaces.push({ id: face.card.id, x: face.x, y: face.y, w: face.w, h: face.h, radius: face.radius, sideways: face.sideways === true });
        }
      }
      const flights: FlyingCard[] = [];
      for (const id of added) {
        const tf = tableFaces.find((f) => f.id === id);
        if (tf === undefined) continue;
        const card = props.view.table.flatMap((m) => m.meld.slots).find((s) => s.card.id === id)?.card;
        if (card === undefined) continue;
        // 起点：该牌在上一帧**所属那一方**的手牌位置（我方手牌 or 对手手牌带）
        const origin = lastLay !== null ? originForSide(lastLay, id) : null;
        const cs = layout.card;
        flights.push({
          card,
          fromX: origin?.x ?? layout.hand.viewport.x + layout.hand.viewport.w / 2,
          fromY: origin?.y ?? layout.hand.viewport.y,
          toX: tf.x,
          toY: tf.y,
          fromW: origin?.w ?? cs.w,
          fromH: origin?.h ?? cs.h,
          toW: tf.w,
          toH: tf.h,
          fromRotation: 0,
          toRotation: tf.sideways ? Math.PI / 2 : 0,
          radius: tf.radius,
          progress: 0,
        });
      }
      if (flights.length > 0) flyCards(flights);
    }
    prevTableCardsRef.current = curTableCards;
  }, [props.view.table, layout, flyCards, originForSide]);

  // 主绘制：在三个动画检测之后执行。若触发了动画（animatingRef），
  // 由飞行的 rAF 循环接管重绘，这里不再画静态帧，避免闪一帧终点。
  useEffect(() => {
    if (animatingRef.current) return;
    redraw();
  }, [layout, size, scroll, props.topbarText, redraw]);

  // 动画检测完成后，记录当前布局为「上一帧布局」（供下一次动画算起点）
  useEffect(() => {
    lastLayoutRef.current = layout;
  }, [layout]);

  // 卸载时清理动画帧
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const maxScrollFor = useCallback((axis: 'hand' | 'discard'): number => {
    const current = layoutRef.current;
    if (current === null) return 0;
    if (axis === 'hand') {
      return Math.max(0, current.hand.contentW - current.hand.viewport.w);
    }
    const d = current.discard;
    return d.axis === 'x'
      ? Math.max(0, d.contentW - d.viewport.w)
      : Math.max(0, d.contentH - d.viewport.h);
  }, []);

  const hitScrollAxis = useCallback((px: number, py: number): 'hand' | 'discard' | null => {
    const current = layoutRef.current;
    if (current === null) return null;
    const inside = (r: { x: number; y: number; w: number; h: number }): boolean =>
      px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    if (inside(current.hand.viewport)) return 'hand';
    if (inside(current.discard.viewport)) return 'discard';
    return null;
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const axis = hitScrollAxis(px, py);
      pointerRef.current = {
        axis: axis ?? 'none',
        startX: event.clientX,
        startY: event.clientY,
        startOffset: axis !== null ? scrollRef.current[axis] : 0,
        moved: false,
      };
    },
    [hitScrollAxis],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const p = pointerRef.current;
      if (p.axis === 'none') return;
      const current = layoutRef.current;
      if (current === null) return;
      const isX = p.axis === 'hand' || current.discard.axis === 'x';
      const dx = event.clientX - p.startX;
      const dy = event.clientY - p.startY;
      const distance = Math.abs(isX ? dx : dy);
      if (!p.moved && distance < DRAG_THRESHOLD) return;
      p.moved = true;
      const delta = isX ? -dx : -dy;
      const max = maxScrollFor(p.axis);
      scrollRef.current = {
        ...scrollRef.current,
        [p.axis]: clampScroll(p.startOffset + delta, max),
      };
      setScroll(scrollRef.current);
    },
    [maxScrollFor],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const p = pointerRef.current;
      const moved = p.moved;
      // 立即复位，避免后续事件误判
      pointerRef.current = { axis: 'none', startX: 0, startY: 0, startOffset: 0, moved: false };
      if (moved) return; // 拖拽滚动，不当作点击

      const current = layoutRef.current;
      if (current === null) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const hit = hitTest(
        current,
        event.clientX - rect.left,
        event.clientY - rect.top,
        scrollRef.current,
      );
      if (hit === null) return;

      if (hit.kind === 'hand') {
        props.onCardClick(hit.card);
        return;
      }
      if (hit.kind === 'meld') {
        props.onMeldClick(hit.meldId);
        return;
      }
      switch (hit.id) {
        case 'deck':
          props.onAction({ type: 'drawDeck' });
          break;
        case 'discard-top':
          // 只有 draw 阶段（轮到玩家取牌）才能取弃牌顶牌
          if (props.view.phase === 'draw' && props.view.turn === 'player') {
            props.onAction({ type: 'takeDiscardTop' });
          }
          break;
        case 'undo':
          props.onAction({ type: 'undo' });
          break;
        case 'settings':
          props.onOpenSettings();
          break;
        case 'sort':
          props.onToggleSort();
          break;
        case 'actionPrimary':
          props.onActionPrimary();
          break;
        case 'actionSecondary':
          props.onActionSecondary();
          break;
        default: {
          // 深层收取：discard-deep:{cardId}
          if (hit.id.startsWith('discard-deep:')) {
            // 只有 draw 阶段（轮到玩家取牌）才能深层收取
            if (props.view.phase === 'draw' && props.view.turn === 'player') {
              const cardId = hit.id.slice('discard-deep:'.length);
              props.onAction({ type: 'takeDiscardDeep', cardId });
            }
          }
          break;
        }
      }
    },
    [props],
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const axis = hitScrollAxis(event.clientX - rect.left, event.clientY - rect.top);
      if (axis === null) return;
      const max = maxScrollFor(axis);
      scrollRef.current = {
        ...scrollRef.current,
        [axis]: clampScroll(scrollRef.current[axis] + event.deltaY, max),
      };
      setScroll(scrollRef.current);
    },
    [hitScrollAxis, maxScrollFor],
  );

  // 暴露 deck / 手牌首牌中心坐标供 E2E 精确点击（Canvas 无 DOM 按钮）
  const deckCenter =
    layout?.deck !== null && layout?.deck !== undefined
      ? { x: layout.deck.x + layout.deck.w / 2, y: layout.deck.y + layout.deck.h / 2 }
      : null;
  const handCenter =
    layout !== null && layout.hand.cards.length > 0
      ? (() => {
          const first = layout.hand.cards[0];
          if (first === undefined) return null;
          return {
            x: layout.hand.viewport.x - scroll.hand + first.x + first.w / 2,
            y: layout.hand.viewport.y + first.y + first.h / 2,
          };
        })()
      : null;

  return (
    <canvas
      ref={canvasRef}
      data-testid="game-canvas"
      data-deck-x={deckCenter?.x}
      data-deck-y={deckCenter?.y}
      data-hand-x={handCenter?.x}
      data-hand-y={handCenter?.y}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
    />
  );
}
