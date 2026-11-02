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

test('横屏矮屏判庄弹窗的确认按钮始终可见', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openCleanHomeWithSeed(page, 10);
  await page.getByRole('button', { name: /开始对局|Start Game/ }).click();

  const dialog = page.getByRole('dialog', { name: /本局庄家判定|Dealer draw/ });
  const confirm = dialog.getByRole('button', { name: /确认并发牌|Confirm and deal/ });
  await expect(dialog).toBeVisible();
  await expect(confirm).toBeVisible();

  const viewport = page.viewportSize();
  const dialogBox = await dialog.boundingBox();
  const confirmBox = await confirm.boundingBox();
  expect(viewport).not.toBeNull();
  expect(dialogBox).not.toBeNull();
  expect(confirmBox).not.toBeNull();
  if (viewport === null || dialogBox === null || confirmBox === null) return;
  expect(dialogBox.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(confirmBox.y + confirmBox.height).toBeLessThanOrEqual(viewport.height + 1);

  await confirm.click();
  await expect(page.getByTestId('game')).toHaveAttribute('data-phase', 'play');
});

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

test('判庄牌渲染为牌面且庄家首轮出牌会播放动画', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCleanHomeWithSeed(page, 10);
  await page.getByRole('button', { name: /开始对局|Start Game/ }).click();

  const dealDialog = page.getByRole('dialog', { name: /本局庄家判定|Dealer draw/ });
  await expect(dealDialog).toBeVisible();
  await expect(dealDialog.getByTestId('starter-card')).toBeVisible();
  expect(await dealDialog.getByTestId('starter-card').textContent()).not.toContain('D6');
  await dealDialog.getByRole('button', { name: /确认并发牌|Confirm and deal/ }).click();

  const game = page.getByTestId('game');
  await expect(game).toHaveAttribute('data-phase', 'play');
  await expect(game).toHaveAttribute('data-turn', 'player');
  await expect(game).toHaveAttribute('data-hand-count', '10');

  const canvas = page.getByTestId('game-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  const getHandFace = async (cardId: string): Promise<{ x: number; y: number }> => {
    const raw = await canvas.getAttribute('data-hand-faces');
    const faces = JSON.parse(raw ?? '[]') as Array<{ cardId: string; x: number; y: number }>;
    const face = faces.find((item) => item.cardId === cardId);
    if (face === undefined) throw new Error(`手牌中找不到 ${cardId}`);
    return { x: face.x, y: face.y };
  };

  for (const cardId of ['H7', 'S7', 'D7']) {
    const face = await getHandFace(cardId);
    await page.mouse.click(box.x + face.x, box.y + face.y);
  }
  await expect(game).toHaveAttribute('data-selected-count', '3');
  const before = Number(await canvas.getAttribute('data-animation-count'));
  const actionX = Number(await canvas.getAttribute('data-action-primary-x'));
  const actionY = Number(await canvas.getAttribute('data-action-primary-y'));
  expect(Number.isFinite(actionX) && Number.isFinite(actionY)).toBe(true);
  await page.mouse.click(box.x + actionX, box.y + actionY);
  await expect(game).toHaveAttribute('data-hand-count', '7');
  await expect.poll(async () => Number(await canvas.getAttribute('data-animation-count'))).toBeGreaterThan(before);
});

test('点击手牌会选中一张牌（语义状态可读）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCleanHomeWithSeed(page);
  await startGame(page);

  await waitForMyDrawTurn(page);
  await clickDeck(page);
  await page.waitForTimeout(300);

  // 读取手牌首牌中心坐标，点击选中，并验证可观察语义状态变化。
  const game = page.getByTestId('game');
  await expect(game).toHaveAttribute('data-selected-count', '0');
  const canvas = page.getByTestId('game-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  const hx = Number(await canvas.getAttribute('data-hand-x'));
  const hy = Number(await canvas.getAttribute('data-hand-y'));
  expect(Number.isFinite(hx) && Number.isFinite(hy)).toBe(true);
  await page.mouse.click(box.x + hx, box.y + hy);
  await page.waitForTimeout(200);

  await expect(game).toHaveAttribute('data-selected-count', '1');
});
