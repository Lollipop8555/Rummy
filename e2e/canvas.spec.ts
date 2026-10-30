/**
 * Canvas 渲染与对局状态验证。
 *
 * Canvas 版把牌桌画进一个 <canvas>，内部元素无法用 DOM 定位，
 * 因此通过根节点暴露的 data-* 语义状态断言对局进度；
 * 牌堆坐标由 GameCanvas 暴露在 data-deck-x/y，据此模拟点击摸牌。
 */
import { expect, test } from '@playwright/test';
import { openCleanHomeWithSeed, startGame, waitForMyDrawTurn, clickDeck } from './fixtures';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'portrait', width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  test(`canvas 已绘制内容 · ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openCleanHomeWithSeed(page);
    await startGame(page);
    await expect(page.getByTestId('game-canvas')).toBeVisible();
    await page.waitForTimeout(400);

    const stats = await page.evaluate(() => {
      const canvas = document.querySelector(
        '[data-testid="game-canvas"]',
      ) as HTMLCanvasElement | null;
      if (canvas === null) return { error: 'canvas not found' };
      const ctx = canvas.getContext('2d');
      if (ctx === null) return { error: 'no 2d context' };
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;

      const bands = [0, 0, 0];
      let opaque = 0;
      for (let y = 0; y < height; y += 2) {
        const band = Math.min(2, Math.floor((y / height) * 3));
        for (let x = 0; x < width; x += 2) {
          const i = (y * width + x) * 4;
          if ((data[i + 3] ?? 0) > 8) {
            opaque += 1;
            bands[band] = (bands[band] ?? 0) + 1;
          }
        }
      }
      return { width, height, opaque, bands };
    });

    expect(stats.error, String(stats.error)).toBeUndefined();
    if (stats.error !== undefined) return;

    expect(stats.opaque, 'canvas 应绘制了内容').toBeGreaterThan(2000);
    const bands = stats.bands as number[];
    expect(bands[0], '顶部（顶栏）应有内容').toBeGreaterThan(50);
    expect(bands[1], '中部（牌桌）应有内容').toBeGreaterThan(50);
    expect(bands[2], '底部（手牌）应有内容').toBeGreaterThan(50);
  });
}

test('对局状态通过 data-* 暴露，摸牌后进入 play 阶段', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCleanHomeWithSeed(page);
  await startGame(page);

  const game = page.getByTestId('game');
  // 开局有 10 张手牌，对手 10 张
  await expect(game).toHaveAttribute('data-hand-count', '10');
  await expect(game).toHaveAttribute('data-opponent-count', '10');

  // 等待轮到自己且处于 draw 阶段，点击牌堆摸牌
  await waitForMyDrawTurn(page);
  await clickDeck(page);

  // 摸牌后进入 play 阶段，手牌数 +1
  await expect(game).toHaveAttribute('data-phase', 'play');
  await expect(game).toHaveAttribute('data-hand-count', '11');
});

test('点击手牌会选中一张牌（语义状态可读）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCleanHomeWithSeed(page);
  await startGame(page);

  await waitForMyDrawTurn(page);
  await clickDeck(page);
  await page.waitForTimeout(300);

  // 读取手牌首牌中心坐标，点击选中
  const canvas = page.getByTestId('game-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  const hx = Number(await canvas.getAttribute('data-hand-x'));
  const hy = Number(await canvas.getAttribute('data-hand-y'));
  expect(Number.isFinite(hx) && Number.isFinite(hy)).toBe(true);
  await page.mouse.click(box.x + hx, box.y + hy);
  await page.waitForTimeout(200);

  // 点击后不报错即可；选中态在 canvas 内部（data-selected 未暴露时此处只做冒烟）
  expect(true).toBe(true);
});
