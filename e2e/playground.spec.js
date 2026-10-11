import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.__errors = errors;
  await page.goto('/');
  await expect(page.locator('#source')).toHaveValue(/字串 問候/);
});
test.afterEach(async ({ page }) => { expect(page.__errors).toEqual([]); });

test('real workers execute both engines and layout fits the viewport', async ({ page }, testInfo) => {
  for (const engine of ['vm', 'tree']) {
    await page.locator('#engine').selectOption(engine);
    await page.locator('#run').click();
    await expect(page.locator('#result-badge')).toHaveText('成功');
    await expect(page.locator('#stdout')).toContainText('你好，itouLang！');
    await expect(page.locator('#stdout')).toContainText('6 × 7 = 42');
    await expect(page.locator('#diagnostic')).toBeHidden();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('playground.png'), fullPage: true });
});

test('closures example and bytecode inspection', async ({ page }) => {
  await page.locator('#example').selectOption('closures');
  await expect(page.locator('#source')).toHaveValue(/計數器\(整數 起始\)/);
  await page.locator('#run').click();
  await expect(page.locator('#stdout')).toHaveText('11\n16\n102\n17');
  await page.locator('#compile').click();
  await expect(page.locator('#result-badge')).toHaveText('編譯完成');
  await expect(page.locator('#bytecode')).toContainText('CLOSURE');
  await expect(page.locator('#bytecode')).toContainText('值 @ 1:1');
});

test('breakpoint, lexical variables, source step and completion', async ({ page }) => {
  await page.locator('#source').fill('整數 總和 = 1;\n整數 加上(整數 數值) {\n  總和 += 數值;\n  回傳 總和;\n}\n喵(加上(4));');
  await page.getByRole('button', { name: '切換第 3 行中斷點', exact: true }).click();
  await expect(page.locator('#breakpoint-count')).toHaveText('1 個中斷點');
  await page.locator('#debug').click();
  await expect(page.locator('#result-badge')).toHaveText('已暫停');
  await page.locator('#continue').click();
  await expect(page.locator('#debug-position')).toContainText('第 3 行');
  await expect(page.locator('#frames')).toContainText('加上');
  await expect(page.locator('#variables')).toContainText('總和');
  await expect(page.locator('.variable-row').filter({ hasText: '總和' })).toContainText('數字');
  await page.locator('#step-line').click();
  await expect(page.locator('#debug-position')).toContainText('第 4 行');
  await expect(page.locator('.variable-row').filter({ hasText: '總和' })).toContainText('5');
  await page.locator('#continue').click();
  await expect(page.locator('#result-badge')).toHaveText('已結束');
  await page.getByRole('tab', { name: '執行結果' }).click();
  await expect(page.locator('#stdout')).toHaveText('5');
});

test('runtime diagnostic contains source location and call stack', async ({ page }) => {
  await page.locator('#example').selectOption('error');
  await expect(page.locator('#source')).toHaveValue(/浮點數 比值/);
  await page.locator('#run').click();
  await expect(page.locator('#result-badge')).toHaveText('錯誤');
  await expect(page.locator('#diagnostic')).toContainText('error.itou:2:9');
  await expect(page.locator('#diagnostic')).toContainText('除以零');
  await expect(page.locator('#diagnostic')).toContainText('at 比值');
  await expect(page.locator('#gutter-inner .active-line')).toHaveText('2');
});

test('source and theme persist, printed HTML remains text', async ({ page }) => {
  const source = '喵("<img src=x onerror=alert(1)>");';
  await page.locator('#source').fill(source);
  await page.locator('#theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('#source')).toHaveValue(source);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#run').click();
  await expect(page.locator('#stdout')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#stdout img')).toHaveCount(0);
});

test('stop terminates a busy worker and the next program still runs', async ({ page }) => {
  await page.locator('#source').fill('字串 文字 = "x"; 整數 索引 = 0; 當 (索引 < 16) { 文字 += 文字; ++索引; } 當 (真) { 喵長(文字); }');
  await page.locator('#run').click();
  await page.locator('#stop').click();
  await expect(page.locator('#result-badge')).toHaveText('已停止');
  await page.locator('#source').fill('喵(42);');
  await page.locator('#run').click();
  await expect(page.locator('#stdout')).toHaveText('42');
  await expect(page.locator('#result-badge')).toHaveText('成功');
});

test('a delayed example response cannot overwrite newer user edits', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/examples/closures.itou', async route => {
    await gate;
    await route.continue();
  });
  await page.locator('#example').selectOption('closures');
  await page.locator('#source').fill('喵("保留我的修改");');
  const loaded = page.waitForResponse('**/examples/closures.itou');
  release();
  await loaded;
  await expect(page.locator('#source')).toHaveValue('喵("保留我的修改");');
  await page.locator('#run').click();
  await expect(page.locator('#stdout')).toHaveText('保留我的修改');
});

test('typed example reports Chinese signatures and executes through both engines', async ({ page }) => {
  await page.locator('#example').selectOption('typed');
  await expect(page.locator('#source')).toHaveValue(/整數 起始/);
  await page.locator('#check').click();
  await expect(page.locator('#result-badge')).toHaveText('型別通過');
  await expect(page.locator('#output-kind')).toHaveText('型別報告');
  await expect(page.locator('#stdout')).toContainText('計數：函式(數字) -> 數字');
  for (const engine of ['tree', 'vm']) {
    await page.locator('#engine').selectOption(engine);
    await page.locator('#run').click();
    await expect(page.locator('#result-badge')).toHaveText('成功');
    await expect(page.locator('#output-kind')).toHaveText('標準輸出');
    await expect(page.locator('#stdout')).toHaveText('11\n16\n12\n答案： 42');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('typed source fails before execution and displays the exact static diagnostic', async ({ page }) => {
  await page.locator('#source').fill('喵("不應該執行");\n整數 數值 = "錯誤";');
  await page.locator('#run').click();
  await expect(page.locator('#result-badge')).toHaveText('錯誤');
  await expect(page.locator('#diagnostic')).toContainText('custom.itou:2:9: type:');
  await expect(page.locator('#diagnostic')).toContainText('預期 number，得到 string');
  await expect(page.locator('#stdout')).not.toContainText('不應該執行');
});

test('WebAssembly runs Chinese main and for/continue, and malformed source remains recoverable', async ({ page }) => {
  const wasm = page.waitForResponse(response => response.url().endsWith('/web/native/itou.wasm'));
  await page.locator('#example').selectOption('cpp');
  await expect(page.locator('#source')).toHaveValue(/整數 主程式\(\)/);
  await page.locator('#run').click();
  expect((await wasm).headers()['content-type']).toBe('application/wasm');
  await expect(page.locator('#stdout')).toHaveText('平方和： 46');
  for (const source of ['('.repeat(300) + '1' + ')'.repeat(300) + ';', '1' + '+1'.repeat(500) + ';', '{'.repeat(300) + '}'.repeat(300), '無值 遞迴() { 遞迴(); } 遞迴();']) {
    await page.locator('#source').fill(source);
    await page.locator('#run').click();
    await expect(page.locator('#result-badge')).toHaveText('錯誤');
    await expect(page.locator('#diagnostic')).toContainText('limit:');
  }
  await page.locator('#source').fill('整數 數值 = 41; 喵(++數值);');
  await page.locator('#run').click();
  await expect(page.locator('#stdout')).toHaveText('42');
});

test('喵in reads the stdin panel, streams retain exact output and debugger input', async ({ page }) => {
  await page.locator('#example').selectOption('streams');
  await expect(page.locator('#source')).toHaveValue(/喵in >> 左邊 >> 右邊/);
  await expect(page.locator('#input')).toHaveValue('3 4\n');
  await page.locator('#input').fill('20 22');
  for (const engine of ['vm', 'tree']) {
    await page.locator('#engine').selectOption(engine);
    await page.locator('#run').click();
    await expect(page.locator('#result-badge')).toHaveText('成功');
    await expect(page.locator('#stdout')).toHaveText('總和：42');
    await expect(page.locator('#stderr')).toHaveText('讀取完成');
  }
  await page.locator('#source').fill('整數 數值;\n喵out << "前";\n喵in >> 數值;\n喵out << 數值;\n喵err << "提醒";');
  await page.locator('#input').fill('42');
  await page.getByRole('button', { name: '切換第 3 行中斷點', exact: true }).click();
  await page.locator('#debug').click();
  await expect(page.locator('#result-badge')).toHaveText('已暫停');
  await page.locator('#continue').click();
  await expect(page.locator('#debug-position')).toContainText('第 3 行');
  await page.getByRole('tab', { name: '執行結果' }).click();
  await expect(page.locator('#stdout')).toHaveText('前');
  await page.getByRole('tab', { name: '除錯器' }).click();
  await page.locator('#continue').click();
  await expect(page.locator('#result-badge')).toHaveText('已結束');
  await page.getByRole('tab', { name: '執行結果' }).click();
  await expect(page.locator('#stdout')).toHaveText('前42');
  await expect(page.locator('#stderr')).toHaveText('提醒');
  expect(await page.locator('#stdout').textContent()).toBe('前42');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('喵getline preserves spaces and changing stdin invalidates a debug session', async ({ page }) => {
  await page.locator('#source').fill('字串 文字; 喵getline(喵in, 文字); 喵out << 文字;');
  await page.locator('#input').fill('你好 世界\n');
  await page.locator('#run').click();
  await expect(page.locator('#stdout')).toHaveText('你好 世界');
  await page.locator('#debug').click();
  await expect(page.locator('#result-badge')).toHaveText('已暫停');
  await page.locator('#input').fill('修改後的測資\n');
  await expect(page.locator('#continue')).toBeDisabled();
  await page.locator('#run').click();
  await expect(page.locator('#stdout')).toHaveText('修改後的測資');
});
