import { expect, type Page } from '@playwright/test';

/**
 * 固定种子：保证同一用例每次拿到完全相同的牌局。
 *
 * 为什么必须固定：不固定时每轮手牌都不同，「是否存在可弃的牌」
 * 会随机变化，导致用例偶发失败——那不是产品缺陷，而是测试不可复现。
 */
export const FIXED_SEED = 20240101;

/** 从干净状态打开首页 */
export async function openCleanHome(page: Page): Promise<void> {
  await page.goto('./');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('home')).toBeVisible();
}

/** 带固定 seed 打开干净的首页（对局可复现） */
export async function openCleanHomeWithSeed(
  page: Page,
  seed: number = FIXED_SEED,
): Promise<void> {
  await page.goto(`./?seed=${String(seed)}`);
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`./?seed=${String(seed)}`);
  await expect(page.getByTestId('home')).toBeVisible();
}

/** 开始一局（使用固定 seed，保证可复现） */
export async function startGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: /开始对局|Start Game/ }).click();
  await expect(page.getByTestId('game')).toBeVisible();
}

/**
 * 等待轮到自己可摸牌（draw 阶段）。
 * Canvas 版无 DOM 按钮，改用根节点的语义状态断言：
 * 当 data-turn=player 且 data-phase=draw 时，即可摸牌。
 */
export async function waitForMyDrawTurn(page: Page): Promise<void> {
  const game = page.getByTestId('game');
  await expect(game).toHaveAttribute('data-turn', 'player', { timeout: 20_000 });
  await expect(game).toHaveAttribute('data-phase', 'draw', { timeout: 20_000 });
}

/** 读取 deck 中心坐标（由 GameCanvas 暴露在 data-deck-x/y） */
export async function deckCenter(page: Page): Promise<{ x: number; y: number }> {
  const canvas = page.getByTestId('game-canvas');
  const x = Number(await canvas.getAttribute('data-deck-x'));
  const y = Number(await canvas.getAttribute('data-deck-y'));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('deck 坐标不可用（可能尚未绘制或牌堆为空）');
  }
  return { x, y };
}

/** 点击牌堆摸牌 */
export async function clickDeck(page: Page): Promise<void> {
  const canvas = page.getByTestId('game-canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('canvas 不可见');
  const { x, y } = await deckCenter(page);
  await page.mouse.click(box.x + x, box.y + y);
}
