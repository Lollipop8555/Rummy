/**
 * 对战页（Canvas 版）。
 *
 * 牌桌完全由 Canvas 绘制；只有「对话框、提示条」这类浮层仍是 DOM——
 * 它们是真正的 UI 控件（需要无障碍、焦点管理、文本可选择），
 * 用 Canvas 重画反而会显著变差。
 *
 * 业务逻辑（core / ai / 存档 / 音效）完全没有改动。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isJoker, type Card } from '../core/cards';
import { appendOptions, resolveMelds, type Meld } from '../core/meld';
import type { GameView } from '../core/view';
import type { Action } from '../core/engine';
import { opponentDescriptionKey } from '../ai/runner';
import type { Language } from '../platform/profile';
import { translate, type TextKey } from './i18n';
import { Dialog } from './components/Dialog';
import type { SortMode } from './canvas/sort';
import { GameCanvas } from './canvas/GameCanvas';

export type GameScreenCanvasProps = {
  readonly view: GameView;
  readonly language: Language;
  readonly sortMode: SortMode;
  readonly onSortModeChange: (mode: SortMode) => void;
  readonly onAction: (action: Action) => { ok: boolean; error?: string };
  readonly onSurrender: () => void;
  readonly soundOn: boolean;
  readonly onToggleSound: () => void;
  readonly onRoundConfirm: () => void;
  readonly onMatchConfirm: () => void;
  readonly onNewGame: () => void;
};

type PendingMeld = {
  readonly cards: readonly Card[];
  readonly options: readonly Meld[];
};

export function GameScreenCanvas({
  view,
  language,
  sortMode,
  onSortModeChange,
  onAction,
  onSurrender,
  soundOn,
  onToggleSound,
  onRoundConfirm,
  onMatchConfirm,
  onNewGame,
}: GameScreenCanvasProps) {
  const t = useCallback(
    (key: TextKey, vars?: Record<string, string | number>) =>
      translate(language, key, vars),
    [language],
  );

  const [selected, setSelected] = useState<readonly string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingMeld, setPendingMeld] = useState<PendingMeld | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [surrenderOpen, setSurrenderOpen] = useState(false);
  /** 已提示过强制亮牌的牌 id，避免同一张牌反复弹提示 */
  const promptedMustMeld = useRef<string | null>(null);

  const myTurn = view.turn === 'player';
  const canAct = myTurn && view.phase === 'play';
  const mustDraw = myTurn && view.phase === 'draw';

  const selectedIds = useMemo(() => new Set(selected), [selected]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 1900);
  }, []);

  /**
   * 深层收取（从弃牌堆取非顶牌）后，引擎会把 `mustMeldCardId` 置为那张牌：
   * 规则要求它必须立刻组成组合打出，否则本回合无法结束。
   *
   * 这里做三件事，缺一不可：
   * 1. 自动选中该牌 —— 玩家一取到就处于「待亮牌」状态，不需要自己去手牌里找；
   * 2. 弹一次提示 —— 明确告知「必须立刻亮牌」，而不是让人以为卡住了；
   * 3. 清掉残留选中 —— 若之前选着别的牌，那些选择必须让位，否则会把
   *    不该出的牌一起带进组合判定。
   */
  useEffect(() => {
    const id = view.mustMeldCardId;
    if (id === null) {
      promptedMustMeld.current = null;
      return;
    }
    setSelected([id]);
    if (promptedMustMeld.current !== id) {
      promptedMustMeld.current = id;
      showToast(t('hint.mustMeld'));
    }
  }, [view.mustMeldCardId, showToast, t]);

  const clearSelection = useCallback(() => setSelected([]), []);

  const doAction = useCallback(
    (action: Action): boolean => {
      const result = onAction(action);
      if (!result.ok && result.error !== undefined) {
        showToast(result.error);
        return false;
      }
      return true;
    },
    [onAction, showToast],
  );

  const selectedCards = useMemo(
    () =>
      selected
        .map((id) => view.me.cards.find((c) => c.id === id))
        .filter((c): c is Card => c !== undefined),
    [selected, view.me.cards],
  );

  const selectedMeldOptions = useMemo(
    () => (selectedCards.length >= 3 ? resolveMelds(selectedCards) : []),
    [selectedCards],
  );

  // 选中单张牌时，计算可接牌的目标 meld id 集合（用于组合区高亮）
  const layOffTargets = useMemo(() => {
    const targets = new Set<string>();
    if (selectedCards.length === 1) {
      const card = selectedCards[0];
      if (card !== undefined) {
        for (const item of view.table) {
          if (appendOptions(item.meld, card).length > 0) {
            targets.add(item.id);
          }
        }
      }
    }
    return targets;
  }, [selectedCards, view.table]);

  const handleCardClick = useCallback(
    (card: Card) => {
      if (mustDraw) {
        showToast(t('hint.mustDrawFirst'));
        return;
      }
      if (!canAct) {
        showToast(isJoker(card) ? t('hint.jokerCannotDiscard') : t('hint.notPlayable'));
        return;
      }
      setSelected((prev) =>
        prev.includes(card.id)
          ? prev.filter((id) => id !== card.id)
          : [...prev, card.id],
      );
    },
    [canAct, mustDraw, showToast, t],
  );

  /** 选中的牌若能成组就亮牌；否则单张则弃牌 */
  const commitSelection = useCallback(() => {
    if (selectedCards.length === 0) {
      showToast(t('hint.notPlayable'));
      return;
    }
    if (selectedCards.length >= 3 && selectedMeldOptions.length > 0) {
      if (selectedMeldOptions.length > 1) {
        setPendingMeld({ cards: selectedCards, options: selectedMeldOptions });
        return;
      }
      if (doAction({
        type: 'meld',
        cardIds: selectedCards.map((c) => c.id),
        meldIndex: 0,
      })) {
        clearSelection();
      }
      return;
    }
    if (selectedCards.length === 1) {
      const card = selectedCards[0];
      if (card === undefined) return;
      // 深层收取的牌必须先亮出组合，不能直接弃
      if (view.mustMeldCardId !== null) {
        showToast(t('hint.mustMeld'));
        return;
      }
      if (isJoker(card)) {
        showToast(t('hint.jokerCannotDiscard'));
        return;
      }
      if (view.drawnCardId === card.id) {
        showToast(t('hint.drawnCannotDiscard'));
        return;
      }
      if (doAction({ type: 'discard', cardId: card.id })) {
        clearSelection();
      }
      return;
    }
    // 多张但不成组 → 尝试接牌到桌面组合
    const card = selectedCards[0];
    if (card === undefined) return;
    const target = view.table.find(
      (item) => appendOptions(item.meld, card).length > 0,
    );
    if (target !== undefined) {
      if (doAction({
        type: 'layOff',
        meldId: target.id,
        cardId: card.id,
        optionIndex: 0,
      })) {
        clearSelection();
      }
      return;
    }
    showToast(t('hint.notPlayable'));
  }, [
    clearSelection,
    doAction,
    selectedCards,
    selectedMeldOptions,
    showToast,
    t,
    view.drawnCardId,
    view.mustMeldCardId,
    view.table,
  ]);

  /** 点击组合区：若有选中的单张可接牌，则接牌到该组合 */
  const handleMeldClick = useCallback(
    (meldId: string) => {
      const card = selectedCards[0];
      if (card === undefined || selectedCards.length !== 1) return;
      if (doAction({
        type: 'layOff',
        meldId,
        cardId: card.id,
        optionIndex: 0,
      })) {
        clearSelection();
      }
    },
    [selectedCards, doAction, clearSelection],
  );

  // 操作按钮文案：有选中牌时给出「亮牌 / 弃牌」，否则不显示。
  // 深层收取的牌必须立刻亮牌，此时按钮只能是「亮牌」，不能给「弃牌」——
  // 否则玩家点下去只会收到一条报错提示，属于典型的「按钮亮着但不可用」。
  const mustMeldNow = view.mustMeldCardId !== null;
  const primaryLabel = canAct && selectedCards.length > 0
    ? mustMeldNow || selectedCards.length >= 3
      ? t('action.meld')
      : t('action.discard')
    : null;
  const secondaryLabel = canAct && selectedCards.length > 0
    ? t('common.cancel')
    : null;

  const topbarText = useMemo(
    () => ({
      score: `${String(view.totals.player)} : ${String(view.totals.ai)}`,
      round: t('game.round', { n: view.roundIndex }),
      opponentName: t('game.opponent'),
      opponentDesc: t(
        opponentDescriptionKey(
          view.intensity as Parameters<typeof opponentDescriptionKey>[0],
        ) as TextKey,
      ),
      opponentHandCount: view.opponentHandCount,
      sortLabel: sortMode === 'suit' ? '♣' : 'A',
      undoEnabled: view.canUndo,
      deckEnabled: mustDraw && view.deckCount > 0,
      deckEmpty: view.deckCount === 0,
    }),
    [mustDraw, sortMode, t, view],
  );

  return (
    <div
      className="game-canvas-root"
      data-testid="game"
      data-phase={view.phase}
      data-turn={view.turn}
      data-hand-count={view.me.cards.length}
      data-opponent-count={view.opponentHandCount}
      data-deck-count={view.deckCount}
      data-can-undo={view.canUndo ? 'true' : 'false'}
    >
      <div className="game-canvas-stage">
        <GameCanvas
          view={view}
          sortMode={sortMode}
          selectedIds={selectedIds}
          topbarText={topbarText}
          actionPrimaryLabel={primaryLabel}
          actionSecondaryLabel={secondaryLabel}
          layOffTargets={layOffTargets}
          onCardClick={handleCardClick}
          onMeldClick={handleMeldClick}
          onAction={(action) => {
            doAction(action);
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleSort={() =>
            onSortModeChange(sortMode === 'suit' ? 'rank' : 'suit')
          }
          onActionPrimary={commitSelection}
          onActionSecondary={clearSelection}
        />
      </div>

      {toast !== null && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      {mustDraw && (
        <div className="turn-hint" role="status" aria-live="polite">
          {t('hint.yourDraw')}
        </div>
      )}

      {settingsOpen && (
        <Dialog
          title={t('settings.title')}
          onClose={() => setSettingsOpen(false)}
          closeOnBackdrop
          actions={
            <button type="button" className="button" onClick={() => setSettingsOpen(false)}>
              {t('common.close')}
            </button>
          }
        >
          <button type="button" className="button" onClick={onToggleSound} style={{ textAlign: 'left' }}>
            {t('settings.sound')} · {soundOn ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => {
              setSettingsOpen(false);
              setSurrenderOpen(true);
            }}
          >
            {t('settings.surrender')}
          </button>
        </Dialog>
      )}

      {surrenderOpen && (
        <Dialog
          title={t('settings.surrenderConfirmTitle')}
          onClose={() => setSurrenderOpen(false)}
          actions={
            <>
              <button type="button" className="button" onClick={() => setSurrenderOpen(false)}>
                {t('settings.cancel')}
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  setSurrenderOpen(false);
                  onSurrender();
                }}
              >
                {t('settings.surrenderConfirm')}
              </button>
            </>
          }
        >
          <p className="dialog__body">{t('settings.surrenderConfirmBody')}</p>
        </Dialog>
      )}

      {pendingMeld !== null && (
        <Dialog
          title={t('joker.chooseTarget')}
          onClose={() => setPendingMeld(null)}
          actions={
            <button type="button" className="button" onClick={() => setPendingMeld(null)}>
              {t('common.close')}
            </button>
          }
        >
          <div className="joker-options">
            {pendingMeld.options.map((meld, index) => (
              <button
                type="button"
                key={String(index)}
                className="joker-option"
                onClick={() => {
                  const ok = doAction({
                    type: 'meld',
                    cardIds: pendingMeld.cards.map((c) => c.id),
                    meldIndex: index,
                  });
                  setPendingMeld(null);
                  if (ok) clearSelection();
                }}
              >
                <span className="joker-option__label">
                  {meld.slots
                    .map((s) => `${s.suit}${String(s.rank)}`)
                    .join(' ')}
                </span>
              </button>
            ))}
          </div>
        </Dialog>
      )}

      {view.phase === 'roundEnd' && view.lastRound !== null && (
        <Dialog
          title={t('round.endTitle')}
          actions={
            <button type="button" className="button button--primary" onClick={onRoundConfirm}>
              {t('round.continue')}
            </button>
          }
        >
          <p className="dialog__body">
            {t(`round.reason.${view.lastRound.reason}` as TextKey)}
          </p>
          <div className="score-table">
            <span />
            <span className="score-table__head score-table__value">{t('game.you')}</span>
            <span className="score-table__head score-table__value">{t('game.opponent')}</span>
            <span>{t('round.roundScore')}</span>
            <span className="score-table__value">{view.lastRound.playerRoundScore}</span>
            <span className="score-table__value">{view.lastRound.aiRoundScore}</span>
          </div>
        </Dialog>
      )}

      {view.phase === 'matchEnd' && view.lastMatch !== null && (
        <Dialog
          title={
            view.lastMatch.outcome === 'win'
              ? t('match.win')
              : view.lastMatch.outcome === 'lose'
                ? t('match.lose')
                : t('match.draw')
          }
          actions={
            view.lastMatch.outcome === 'draw' ? (
              <button type="button" className="button button--primary" onClick={onMatchConfirm}>
                {t('round.continue')}
              </button>
            ) : (
              <button type="button" className="button button--primary" onClick={onNewGame}>
                {t('match.newGame')}
              </button>
            )
          }
        >
          <div className="score-table">
            <span />
            <span className="score-table__head score-table__value">{t('game.you')}</span>
            <span className="score-table__head score-table__value">{t('game.opponent')}</span>
            <span className="score-table__total">{t('round.total')}</span>
            <span className="score-table__value score-table__total">
              {view.lastMatch.playerTotal}
            </span>
            <span className="score-table__value score-table__total">
              {view.lastMatch.aiTotal}
            </span>
          </div>
        </Dialog>
      )}
    </div>
  );
}
