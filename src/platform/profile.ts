/**
 * 玩家档案：积分、语言、音效偏好。
 * 与对局存档分离：认输清掉对局存档，但不影响积分。
 */

import { readJson, writeJson } from './storage';

export type Language = 'zh' | 'en';

export type Profile = {
  readonly rating: number;
  readonly language: Language;
  readonly soundOn: boolean;
};

const PROFILE_KEY = 'rummy.profile.v1';

export function defaultProfile(): Profile {
  return {
    rating: 0,
    language: detectLanguage(),
    soundOn: true,
  };
}

function detectLanguage(): Language {
  if (typeof navigator === 'undefined') {
    return 'zh';
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function loadProfile(): Profile {
  const stored = readJson<Partial<Profile>>(PROFILE_KEY);
  const base = defaultProfile();
  if (stored === null) {
    return base;
  }
  return {
    // 积分必须为有限数，否则存档损坏会让段位计算得到 NaN
    rating:
      typeof stored.rating === 'number' && Number.isFinite(stored.rating)
        ? stored.rating
        : base.rating,
    language: stored.language === 'en' || stored.language === 'zh'
      ? stored.language
      : base.language,
    soundOn: typeof stored.soundOn === 'boolean' ? stored.soundOn : base.soundOn,
  };
}

export function saveProfile(profile: Profile): void {
  writeJson(PROFILE_KEY, profile);
}

export function withRating(profile: Profile, delta: number): Profile {
  return { ...profile, rating: profile.rating + delta };
}
