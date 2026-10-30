import { useCallback, useEffect, useMemo, useState } from 'react';
import { hasSaveGame } from './platform/saveGame';
import { startLayoutObserver } from './platform/layoutObserver';
import {
  loadProfile,
  saveProfile,
  type Profile,
} from './platform/profile';
import {
  setSoundEnabled,
  unlockAudio,
} from './platform/audio';
import { useGame } from './ui/useGame';
import { HomeScreen } from './ui/HomeScreen';
import { GameScreenCanvas } from './ui/GameScreenCanvas';
import type { SortMode } from './ui/canvas/sort';
import { translate, type TextKey } from './ui/i18n';

const SORT_KEY = 'rummy.sortMode.v1';

function readSortMode(): SortMode {
  try {
    const raw = window.localStorage.getItem(SORT_KEY);
    return raw === 'rank' ? 'rank' : 'suit';
  } catch {
    return 'suit';
  }
}

export default function App() {
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [sortMode, setSortMode] = useState<SortMode>(() => readSortMode());
  // 有存档时直接进入对局：需求是「刷新/关闭重开不影响对局继续」，
  // 若停在首页要求手动点「继续」，等于把打断成本又还给了玩家。
  //
  // 注意：两者必须由同一次求值派生。分别调用 hasSaveGame() 会让
  // savedExists 与 showHome 各自读一次存储，一旦状态在两次调用间变化
  // （或 StrictMode 重复执行初始化），就会出现「有存档却停在首页」
  // 或「无存档却进了对局」的不一致。
  const [initialSave] = useState(() => hasSaveGame());
  const [savedExists, setSavedExists] = useState(initialSave);
  const [showHome, setShowHome] = useState(!initialSave);

  // 布局预设与尺寸变量：ResizeObserver 驱动
  useEffect(() => startLayoutObserver(), []);

  // 音效开关与档案同步
  useEffect(() => {
    setSoundEnabled(profile.soundOn);
  }, [profile.soundOn]);

  const handleRatingChange = useCallback((delta: number) => {
    setProfile((prev) => {
      const next = { ...prev, rating: prev.rating + delta };
      saveProfile(next);
      return next;
    });
  }, []);

  const controller = useGame(profile, handleRatingChange);

  const updateProfile = useCallback((next: Profile) => {
    setProfile(next);
    saveProfile(next);
  }, []);

  const handleAction = useCallback(
    (action: Parameters<typeof controller.dispatch>[0]) => {
      // 首次手势解锁 AudioContext（浏览器自动播放策略）
      unlockAudio();
      const result = controller.dispatch(action);
      setSavedExists(true);
      return result;
    },
    [controller],
  );

  const handleStart = useCallback(() => {
    unlockAudio();
    controller.start();
    setSavedExists(true);
    setShowHome(false);
  }, [controller]);

  const handleResume = useCallback(() => {
    unlockAudio();
    controller.resume();
    setShowHome(false);
  }, [controller]);

  const handleSurrender = useCallback(() => {
    controller.surrender();
    setSavedExists(false);
    setShowHome(true);
  }, [controller]);

  const handleNewGame = useCallback(() => {
    controller.start();
    setSavedExists(true);
  }, [controller]);

  const noticeText = useMemo(() => {
    if (controller.loadNotice === 'incompatible') {
      return translate(profile.language, 'save.incompatible');
    }
    if (controller.loadNotice === 'corrupt') {
      return translate(profile.language, 'save.corrupt');
    }
    return null;
  }, [controller.loadNotice, profile.language]);

  const toggleSound = useCallback(() => {
    updateProfile({ ...profile, soundOn: !profile.soundOn });
  }, [profile, updateProfile]);

  const toggleLanguage = useCallback(() => {
    updateProfile({
      ...profile,
      language: profile.language === 'zh' ? 'en' : 'zh',
    });
  }, [profile, updateProfile]);

  const changeSortMode = useCallback((mode: SortMode) => {
    setSortMode(mode);
    try {
      window.localStorage.setItem(SORT_KEY, mode);
    } catch {
      // 忽略：排序偏好丢失不影响游戏
    }
  }, []);

  return (
    <div className="app table-surface">
      <div className="table-perspective">
        {showHome || controller.view === null ? (
          <HomeScreen
            profile={profile}
            hasSave={savedExists}
            notice={noticeText}
            onStart={handleStart}
            onResume={handleResume}
            onToggleLanguage={toggleLanguage}
            onDismissNotice={controller.clearNotice}
          />
        ) : (
          <GameScreenCanvas
            view={controller.view}
            language={profile.language}
            opponentName={translate(
              profile.language,
              `opponent.name.${String(controller.view.opponentNameIndex)}` as TextKey,
            )}
            sortMode={sortMode}
            onSortModeChange={changeSortMode}
            onAction={handleAction}
            onSurrender={handleSurrender}
            soundOn={profile.soundOn}
            onToggleSound={toggleSound}
            onRoundConfirm={() => {
              controller.dispatch({ type: 'confirmRound' });
            }}
            onMatchConfirm={() => {
              controller.dispatch({ type: 'confirmMatch' });
            }}
            onNewGame={handleNewGame}
          />
        )}
      </div>
    </div>
  );
}

export type { TextKey };
