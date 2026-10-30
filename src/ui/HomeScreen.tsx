import { useCallback } from 'react';
import {
  pointsToNextTier,
  tierOf,
} from '../core/scoring';
import type { Language, Profile } from '../platform/profile';
import { translate, type TextKey } from './i18n';

export type HomeScreenProps = {
  readonly profile: Profile;
  readonly hasSave: boolean;
  readonly notice: string | null;
  readonly onStart: () => void;
  readonly onResume: () => void;
  readonly onToggleLanguage: () => void;
  readonly onDismissNotice: () => void;
};

export function HomeScreen({
  profile,
  hasSave,
  notice,
  onStart,
  onResume,
  onToggleLanguage,
  onDismissNotice,
}: HomeScreenProps) {
  const language: Language = profile.language;
  const t = useCallback(
    (key: TextKey, vars?: Record<string, string | number>) =>
      translate(language, key, vars),
    [language],
  );

  const tier = tierOf(profile.rating);
  const toNext = pointsToNextTier(profile.rating);
  const tierName =
    t(tier.key as TextKey) + (tier.stars > 0 ? ` ${'★'.repeat(tier.stars)}` : '');

  // 进度条：当前档位内进度。钻石档位每 50 分一颗星，同样适用。
  const span = 50;
  const intoTier = profile.rating - tier.min;
  const progress =
    Number.isFinite(toNext) && span > 0
      ? Math.max(0, Math.min(100, (intoTier / span) * 100))
      : 100;

  return (
    <div className="home" data-testid="home">
      <button
        type="button"
        className="icon-button home__lang"
        onClick={onToggleLanguage}
        aria-label={t('home.language')}
      >
        {language === 'zh' ? 'EN' : '中'}
      </button>

      <h1 className="home__title">{t('app.title')}</h1>
      <p className="home__subtitle">{t('app.subtitle')}</p>

      <div className="home__card">
        <div className="home__row">
          <span className="home__row-label">{t('home.rating')}</span>
          <span className="home__tier" data-testid="home-rating">
            {profile.rating}
          </span>
        </div>
        <div className="home__row">
          <span className="home__row-label">{t('home.tier')}</span>
          <span className="home__tier" data-testid="home-tier">
            {tierName}
          </span>
        </div>
        <div className="home__progress" aria-hidden="true">
          <div
            className="home__progress-bar"
            style={{ width: `${String(progress)}%` }}
          />
        </div>
        <p className="home__hint">
          {Number.isFinite(toNext)
            ? t('home.toNextTier', { n: toNext })
            : t('home.maxTier')}
        </p>
      </div>

      <div className="home__actions" data-testid="home-actions">
        {hasSave && (
          <button type="button" className="button button--primary" onClick={onResume}>
            {t('home.continue')}
          </button>
        )}
        <button
          type="button"
          className={hasSave ? 'button' : 'button button--primary'}
          onClick={onStart}
        >
          {t('home.start')}
        </button>
      </div>

      {notice !== null && (
        <div className="toast" role="status" onClick={onDismissNotice}>
          {notice}
        </div>
      )}
    </div>
  );
}
