/**
 * 布局预设判定。
 *
 * 用「宽高比 + 最短边」双维度判定，而非单纯宽度断点：
 * 手机横屏宽度可达 900px 但高度只有 380px，按宽度会被误判为桌面。
 */

export type LayoutPreset =
  | 'phone-portrait'
  | 'phone-landscape'
  | 'tablet'
  | 'desktop'
  | 'ultrawide';

export function detectLayout(width: number, height: number): LayoutPreset {
  if (width <= 0 || height <= 0) {
    return 'phone-portrait';
  }
  const ratio = width / height;
  const shortest = Math.min(width, height);
  const longest = Math.max(width, height);

  if (ratio > 2.2 && shortest >= 600) {
    return 'ultrawide';
  }
  if (ratio >= 1.5 && height < 500) {
    return 'phone-landscape';
  }
  if (ratio < 1 && shortest < 600) {
    return 'phone-portrait';
  }
  if (shortest <= 1024 && longest <= 1400) {
    return 'tablet';
  }
  return 'desktop';
}

/** 触摸设备禁用 3D 透视，否则显著影响命中精度 */
export function prefersTouch(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 把布局与尺寸写入根节点 CSS 变量。
 * 卡片宽度由容器反推，保证从手机到超宽屏等比缩放。
 */
export function applyLayoutVars(width: number, height: number): LayoutPreset {
  const preset = detectLayout(width, height);
  if (typeof document === 'undefined') {
    return preset;
  }
  const root = document.documentElement;
  root.dataset.layout = preset;
  root.style.setProperty('--vw', `${width}px`);
  root.style.setProperty('--vh', `${height}px`);
  root.style.setProperty('--shortest', `${Math.min(width, height)}px`);
  return preset;
}
