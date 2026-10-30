/**
 * 布局观察：把视口尺寸写入根节点 CSS 变量，并设置 data-layout 预设。
 *
 * 用 ResizeObserver 而非 window.resize：移动端地址栏伸缩、
 * 虚拟键盘弹出都会触发后者，但不需要每次都重算布局。
 */

import { applyLayoutVars } from './layout';

export function startLayoutObserver(): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const update = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    applyLayoutVars(width, height);
    // 与 100dvh 对齐：解决地址栏伸缩导致的抖动
    document.documentElement.style.setProperty('--vh', `${height}px`);
  };

  update();

  const observer = new ResizeObserver(update);
  observer.observe(document.documentElement);

  window.addEventListener('orientationchange', update);
  window.visualViewport?.addEventListener('resize', update);

  return () => {
    observer.disconnect();
    window.removeEventListener('orientationchange', update);
    window.visualViewport?.removeEventListener('resize', update);
  };
}
