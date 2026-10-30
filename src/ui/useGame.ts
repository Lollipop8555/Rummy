/**
 * 对局控制器：把纯函数 reducer、AI、存档、积分串起来。
 *
 * 分层职责：
 * - core 产出新状态与动作日志（唯一真相）
 * - 本 hook 负责落盘、驱动 AI、结算积分
 * - UI 只消费 GameView
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { otherSide, type Side } from '../core/cards';
import {
  createGame,
  reduce,
  type Action,
  type ActionLog,
  type GameState,
} from '../core/engine';
import { ratingDelta, type MeldOwner } from '../core/scoring';
import { toGameView, type GameView } from '../core/view';
import { intensityForRating, planAiTurn } from '../ai/runner';
import { clearSave, loadGame, saveGame, type LoadResult } from '../platform/saveGame';
import type { Profile } from '../platform/profile';
import { playSound, haptic } from '../platform/audio';

export type GameStatus =
  | { readonly kind: 'home' }
  | { readonly kind: 'playing'; readonly view: GameView }
  | { readonly kind: 'loading' };

export type GameController = {
  readonly state: GameState | null;
  readonly view: GameView | null;
  readonly loadNotice: LoadResult['kind'] | null;
  readonly lastLogs: readonly ActionLog[];
  readonly start: () => void;
  readonly resume: () => void;
  readonly dispatch: (action: Action) => { readonly ok: boolean; readonly error?: string };
  readonly surrender: () => void;
  readonly clearNotice: () => void;
};

const PLAYER: Side = 'player';

/** AI 连续动作之间的间隔（毫秒）：足够看清每一步的来向，又不拖沓 */
const AI_STEP_MS = 420;

/**
 * 从 `?seed=123` 读取固定随机种子。
 * 用于 E2E 与问题复现：相同 seed 必然产生相同牌局。
 */
function readSeedOverride(): number | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function useGame(
  profile: Profile,
  onRatingChange: (delta: number) => void,
): GameController {
  const [state, setState] = useState<GameState | null>(null);
  const [loadNotice, setLoadNotice] = useState<LoadResult['kind'] | null>(null);
  const [lastLogs, setLastLogs] = useState<readonly ActionLog[]>([]);
  const aiTimer = useRef<number | null>(null);
  /** 供定时器回调读取最新状态（闭包里的 state 可能已过期） */
  const stateRef = useRef<GameState | null>(null);
  /** AI 本回合剩余动作队列：逐条执行，让每一步都有独立的一帧可动画 */
  const aiQueue = useRef<readonly Action[]>([]);
  /**
   * 已为哪个「轮次 + 阶段」规划过动作。
   * 一次回合跨 draw 与 play 两个阶段，每个阶段各规划一次；
   * 同阶段内连续执行则复用同一份队列。
   */
  const aiPlanKey = useRef<string>('');
  /** 下一步的延迟：首步用档位思考时间，其后为固定间隔 */
  const aiDelay = useRef<number>(AI_STEP_MS);
  const settledMatch = useRef<number>(-1);

  /** 启动前先尝试读档，避免「刷新即丢局」 */
  useEffect(() => {
    const result = loadGame();
    if (result.kind === 'empty') {
      return;
    }
    if (result.kind === 'ok') {
      setState(result.state);
      return;
    }
    // 不兼容或损坏：丢弃并提示，不计分也不扣分
    clearSave();
    setLoadNotice(result.kind);
  }, []);

  const applyAction = useCallback(
    (action: Action): { ok: boolean; error?: string } => {
      if (state === null) {
        return { ok: false, error: '对局尚未开始' };
      }
      const result = reduce(state, action);
      if (!result.ok) {
        playSound('error');
        return { ok: false, error: result.error };
      }
      setState(result.state);
      setLastLogs(result.logs);
      // 事件驱动落盘：动作之后写入，不做节流
      saveGame(result.state);
      for (const log of result.logs) {
        if (log.kind === 'discard' || log.kind === 'meld' || log.kind === 'layOff') {
          playSound('place');
          haptic();
        } else if (log.kind === 'draw' || log.kind === 'takeDiscard') {
          playSound('draw');
        }
      }
      return { ok: true };
    },
    [state],
  );

  const start = useCallback(() => {
    // 允许通过 URL 参数注入 seed，便于 E2E 与 bug 复现。
    // 仅影响「新建对局」的洗牌序列，不涉及任何游戏规则。
    const forced = readSeedOverride();
    const seed = forced ?? (Date.now() & 0x7fffffff);
    const intensity = intensityForRating(profile.rating);
    const fresh = createGame({ seed, intensity });
    setState(fresh);
    setLastLogs([]);
    saveGame(fresh);
  }, [profile.rating]);

  const resume = useCallback(() => {
    const result = loadGame();
    if (result.kind === 'ok') {
      setState(result.state);
      return;
    }
    setLoadNotice(result.kind === 'empty' ? null : result.kind);
  }, []);

  const surrender = useCallback(() => {
    if (state === null) {
      return;
    }
    // 认输一律 -3，无免罚情形
    onRatingChange(-3);
    clearSave();
    setState(null);
    setLastLogs([]);
  }, [state, onRatingChange]);

  /** 局末结算积分（平局不加不扣，交由加赛） */
  useEffect(() => {
    if (state === null || state.phase !== 'matchEnd' || state.lastMatch === null) {
      return;
    }
    const matchIndex = state.roundIndex;
    if (settledMatch.current === matchIndex) {
      return;
    }
    settledMatch.current = matchIndex;
    const outcome = state.lastMatch.outcome;
    if (outcome === 'win' || outcome === 'lose') {
      onRatingChange(ratingDelta(outcome));
      playSound(outcome === 'win' ? 'win' : 'lose');
    }
  }, [state, onRatingChange]);

  /**
   * AI 回合驱动：**逐个动作**提交，而不是一次性跑完整个回合。
   *
   * 为什么必须逐个提交：
   * 牌桌动画依赖「上一帧状态 → 本帧状态」的差量来判断「哪张牌从哪飞向哪」。
   * 若把「摸牌 + 亮牌 + 弃牌」压在同一个 setState 里，中间状态从未出现在 React 树中，
   * 手牌数在净效果上也没变化（摸 1 弃 1），于是所有差量都检测不到，
   * 玩家只会看到牌「凭空出现」，也看不出是对手打的。
   *
   * 逐个提交后，每一步都产生一次真实的视图变化，动画起点也就能正确落到
   * 牌堆 / 对手手牌带 / 组合区，而不是错误地落到玩家手牌区。
   */
  useEffect(() => {
    stateRef.current = state;

    const clearTimer = (): void => {
      if (aiTimer.current !== null) {
        window.clearTimeout(aiTimer.current);
        aiTimer.current = null;
      }
    };

    const resetAi = (): void => {
      aiQueue.current = [];
      aiPlanKey.current = '';
      aiDelay.current = AI_STEP_MS;
      clearTimer();
    };

    if (
      state === null ||
      state.phase === 'roundEnd' ||
      state.phase === 'matchEnd' ||
      state.turn !== 'ai'
    ) {
      resetAi();
      return;
    }

    // 每个「轮次 + 阶段」规划一次（draw 一次、play 一次）
    const planKey = `${String(state.roundIndex)}:${state.phase}`;
    if (aiPlanKey.current !== planKey) {
      const view = toGameView(state, { side: 'ai' });
      const plan = planAiTurn(view, 'ai', state.intensity);
      aiQueue.current = plan.moves;
      aiPlanKey.current = planKey;
      aiDelay.current = plan.delayMs;
    }

    if (aiQueue.current.length === 0) {
      // 已无动作可做：本阶段结束。清掉标记，让下一阶段（或下一轮）重新规划。
      aiPlanKey.current = '';
      return;
    }

    const delay = aiDelay.current;
    aiDelay.current = AI_STEP_MS;

    aiTimer.current = window.setTimeout(() => {
      aiTimer.current = null;
      const move = aiQueue.current[0];
      if (move === undefined) {
        return;
      }
      aiQueue.current = aiQueue.current.slice(1);
      const current = stateRef.current;
      if (current === null) {
        return;
      }
      const result = reduce(current, move);
      if (!result.ok) {
        aiQueue.current = [];
        return;
      }
      setState(result.state);
      setLastLogs(result.logs);
      saveGame(result.state);
      for (const log of result.logs) {
        if (log.kind === 'discard' || log.kind === 'meld' || log.kind === 'layOff') {
          playSound('place');
          haptic();
        } else if (log.kind === 'draw' || log.kind === 'takeDiscard') {
          playSound('draw');
        }
      }
    }, delay);

    return clearTimer;
  }, [state]);

  const view = useMemo(
    () => (state === null ? null : toGameView(state, { side: PLAYER })),
    [state],
  );

  return {
    state,
    view,
    loadNotice,
    lastLogs,
    start,
    resume,
    dispatch: applyAction,
    surrender,
    clearNotice: () => setLoadNotice(null),
  };
}

/** 供 UI 显示「该谁行动」 */
export function isMyTurn(state: GameState | null): boolean {
  return state !== null && state.turn === 'player';
}

export function opponentOf(side: Side): Side {
  return otherSide(side);
}

export type { MeldOwner };
