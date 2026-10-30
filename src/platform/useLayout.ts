/**
 * 当前布局预设的 React 订阅。
 *
 * `layoutObserver` 会把 preset 写到 `<html data-layout>`，
 * 但 CSS 只能改变样式，无法让组件渲染不同结构。
 * 当同一区域需要两套完全不同的 DOM（例如横屏下旋转 90° 的公共栏）时，
 * 靠 CSS 叠加覆盖会越写越乱，不如让组件直接拿到 preset 分叉渲染。
 */

import { useEffect, useState } from 'react';
import { detectLayout, type LayoutPreset } from './layout';

function currentPreset(): LayoutPreset {
  if (typeof document === 'undefined') {
    return 'phone-portrait';
  }
  const attr = document.documentElement.dataset.layout;
  if (
    attr === 'phone-portrait' ||
    attr === 'phone-landscape' ||
    attr === 'tablet' ||
    attr === 'desktop' ||
    attr === 'ultrawide'
  ) {
    return attr;
  }
  return detectLayout(window.innerWidth, window.innerHeight);
}

export function useLayout(): LayoutPreset {
  const [preset, setPreset] = useState<LayoutPreset>(currentPreset);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const next = currentPreset();
      setPreset((prev) => (prev === next ? prev : next));
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-layout'],
    });
    // 初始化时同步一次（observer 只能捕捉后续变化）
    setPreset(currentPreset());
    return () => observer.disconnect();
  }, []);

  return preset;
}
