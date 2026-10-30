/**
 * localStorage 访问封装。
 *
 * 隐私模式下 setItem 会抛异常，必须降级为纯内存模式：
 * 游戏仍可玩，仅失去续局能力（不能白屏或崩溃）。
 */

const memory = new Map<string, string>();
let available: boolean | null = null;

function canUseStorage(): boolean {
  if (available !== null) {
    return available;
  }
  try {
    const probe = '__rummy_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export function readRaw(key: string): string | null {
  if (!canUseStorage()) {
    return memory.get(key) ?? null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeRaw(key: string, value: string): void {
  memory.set(key, value);
  if (!canUseStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 配额或权限问题：保持内存副本即可，不中断游戏
  }
}

export function removeRaw(key: string): void {
  memory.delete(key);
  if (!canUseStorage()) {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 忽略
  }
}

export function readJson<T>(key: string): T | null {
  const raw = readRaw(key);
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    writeRaw(key, JSON.stringify(value));
  } catch {
    // 序列化失败（理论上不会发生）不应影响游戏
  }
}

/** 仅供测试与调试 */
export function __resetStorageState(): void {
  memory.clear();
  available = null;
}
