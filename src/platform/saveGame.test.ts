import { beforeEach, describe, expect, it } from 'vitest';
import { DECK_SIZE } from '../core/cards';
import { createGame, reduce, type GameState } from '../core/engine';
import {
  clearSave,
  countAllCards,
  hasSaveGame,
  loadGame,
  saveGame,
} from './saveGame';
import { __resetStorageState, readRaw, writeRaw } from './storage';

/** 无 DOM 环境下的 localStorage 垫片 */
function installLocalStorageShim(): void {
  const store = new Map<string, string>();
  const shim = {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
    clear: (): void => store.clear(),
    key: (index: number): string | null =>
      [...store.keys()][index] ?? null,
    get length(): number {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: shim },
    writable: true,
    configurable: true,
  });
}

installLocalStorageShim();

beforeEach(() => {
  installLocalStorageShim();
  __resetStorageState();
  clearSave();
});

describe('存档往返', () => {
  it('无存档时返回 empty', () => {
    expect(loadGame().kind).toBe('empty');
    expect(hasSaveGame()).toBe(false);
  });

  it('保存后能读回完全一致的状态（含 RNG 与手牌顺序）', () => {
    const state = createGame({ seed: 4242, intensity: 3 });
    saveGame(state);
    const result = loadGame();
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.state.rng).toBe(state.rng);
    expect(result.state.hands.player.map((c) => c.id)).toEqual(
      state.hands.player.map((c) => c.id),
    );
    expect(result.state.deck.map((c) => c.id)).toEqual(
      state.deck.map((c) => c.id),
    );
    expect(result.state.intensity).toBe(3);
  });

  it('读档后继续摸牌，序列与未中断时一致', () => {
    const base = createGame({ seed: 99, intensity: 2 });
    const step1 = reduce(base, { type: 'drawDeck' });
    if (!step1.ok) throw new Error('前置失败');
    saveGame(step1.state);

    const loaded = loadGame();
    if (loaded.kind !== 'ok') throw new Error('读档失败');

    const cont1 = reduce(loaded.state, { type: 'undo' });
    if (!cont1.ok) throw new Error('撤销失败');
    const cont2 = reduce(cont1.state, { type: 'drawDeck' });
    if (!cont2.ok) throw new Error('摸牌失败');

    const direct = reduce(base, { type: 'drawDeck' });
    if (!direct.ok) throw new Error('对照失败');

    expect(cont2.state.hands.player.map((c) => c.id)).toEqual(
      direct.state.hands.player.map((c) => c.id),
    );
  });

  it('牌数守恒：任意时刻为 54', () => {
    const state = createGame({ seed: 7 });
    expect(countAllCards(state)).toBe(DECK_SIZE);
  });

  it('版本不兼容时丢弃，不返回状态', () => {
    writeRaw(
      'rummy.save.v1',
      JSON.stringify({
        version: 999,
        savedAt: 0,
        state: createGame({ seed: 1 }),
      }),
    );
    const result = loadGame();
    expect(result.kind).toBe('incompatible');
    expect(hasSaveGame()).toBe(false);
  });

  it('牌数不守恒判定为损坏', () => {
    const state = createGame({ seed: 5 });
    const broken: GameState = { ...state, deck: state.deck.slice(3) };
    writeRaw(
      'rummy.save.v1',
      JSON.stringify({ version: state.version, savedAt: 0, state: broken }),
    );
    const result = loadGame();
    expect(result.kind).toBe('corrupt');
  });

  it('内容不是合法 JSON 时判定为损坏或空', () => {
    writeRaw('rummy.save.v1', '{not json');
    const result = loadGame();
    expect(['empty', 'corrupt']).toContain(result.kind);
  });

  it('清除存档后不再显示继续对局', () => {
    saveGame(createGame({ seed: 3 }));
    expect(hasSaveGame()).toBe(true);
    clearSave();
    expect(hasSaveGame()).toBe(false);
  });
});

describe('存储降级', () => {
  it('localStorage 抛异常时不影响读写（降级为内存）', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (): never => {
            throw new Error('denied');
          },
          setItem: (): never => {
            throw new Error('denied');
          },
          removeItem: (): never => {
            throw new Error('denied');
          },
        },
      },
      writable: true,
      configurable: true,
    });
    __resetStorageState();

    expect(() => writeRaw('k', 'v')).not.toThrow();
    expect(readRaw('k')).toBe('v');
  });
});
