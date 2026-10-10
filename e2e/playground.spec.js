import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.__errors = errors;
  await page.goto('/');
  await expect(page.locator('#source')).toHaveValue(/greeting/);
});
test.afterEach(async ({ page }) => { expect(page.__errors).toEqual([]); });

test('real workers execute both engines and layout fits the viewport', async ({ page }, testInfo) => {
  for (const engine of ['vm', 'tree']) {
    await page.locator('#engine').selectOption(engine);
    await page.locator('#run').click();
    await expect(page.locator('#result-badge')).toHaveText('SUCCESS');
    await expect(page.locator('#stdout')).toContainText('你好，itouLang！');
    await expect(page.locator('#stdout')).toContainText('6 × 7 = 42');
    await expect(page.locator('#diagnostic')).toBeHidden();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('playground.png'), fullPage: true });
});

test('closures example and bytecode inspection', async ({ page }) => {
  await page.locator('#example').selectOption('closures');
  await expect(page.locator('#source')).toHaveValue(/fn counter/);
  await page.locator('#run').click();
  await expect(page.locator('#stdout')).toHaveText('11\n16\n102\n17');
  await page.locator('#compile').click();
  await expect(page.locator('#result-badge')).toHaveText('COMPILED');
  await expect(page.locator('#bytecode')).toContainText('CLOSURE');
  await expect(page.locator('#bytecode')).toContainText('value @ 1:1');
});

test('breakpoint, lexical variables, source step and completion', async ({ page }) => {
  await page.locator('#source').fill('let total = 1;\nfn add(n) {\n  total = total + n;\n  return total;\n}\nprint(add(4));');
  await page.getByRole('button', { name: '切換第 3 行中斷點', exact: true }).click();
  await expect(page.locator('#breakpoint-count')).toHaveText('1 個中斷點');
  await page.locator('#debug').click();
  await expect(page.locator('#result-badge')).toHaveText('PAUSED');
  await page.locator('#continue').click();
  await expect(page.locator('#debug-position')).toContainText('Line 3:');
  await expect(page.locator('#frames')).toContainText('add');
  await expect(page.locator('#variables')).toContainText('total');
  await page.locator('#step-line').click();
  await expect(page.locator('#debug-position')).toContainText('Line 4:');
  await expect(page.locator('.variable-row').filter({ hasText: 'total' })).toContainText('5');
  await page.locator('#continue').click();
  await expect(page.locator('#result-badge')).toHaveText('FINISHED');
  await page.getByRole('tab', { name: '執行結果' }).click();
  await expect(page.locator('#stdout')).toHaveText('5');
});

test('runtime diagnostic contains source location and call stack', async ({ page }) => {
  await page.locator('#example').selectOption('error');
  await expect(page.locator('#source')).toHaveValue(/fn ratio/);
  await page.locator('#run').click();
  await expect(page.locator('#result-badge')).toHaveText('ERROR');
  await expect(page.locator('#diagnostic')).toContainText('error.itou:2:12');
  await expect(page.locator('#diagnostic')).toContainText('division by zero');
  await expect(page.locator('#diagnostic')).toContainText('at ratio');
  await expect(page.locator('#gutter-inner .active-line')).toHaveText('2');
});

test('source and theme persist, printed HTML remains text', async ({ page }) => {
  const source = 'print("<img src=x onerror=alert(1)>");';
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
  await page.locator('#source').fill('let s = "x"; let i = 0; while (i < 16) { s = s + s; i = i + 1; } while (true) { len(s); }');
  await page.locator('#run').click();
  await page.locator('#stop').click();
  await expect(page.locator('#result-badge')).toHaveText('STOPPED');
  await page.locator('#source').fill('print(42);');
  await page.locator('#run').click();
  await expect(page.locator('#stdout')).toHaveText('42');
  await expect(page.locator('#result-badge')).toHaveText('SUCCESS');
});

test('a delayed example response cannot overwrite newer user edits', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/examples/closures.itou', async route => {
    await gate;
    await route.continue();
  });
  await page.locator('#example').selectOption('closures');
  await page.locator('#source').fill('print("keep my edits");');
  const loaded = page.waitForResponse('**/examples/closures.itou');
  release();
  await loaded;
  await expect(page.locator('#source')).toHaveValue('print("keep my edits");');
  await page.locator('#run').click();
  await expect(page.locator('#stdout')).toHaveText('keep my edits');
});

test('typed example reports signatures and executes through both engines', async ({ page }) => {
  await page.locator('#example').selectOption('typed');
  await expect(page.locator('#source')).toHaveValue(/start: number/);
  await page.locator('#check').click();
  await expect(page.locator('#result-badge')).toHaveText('TYPES OK');
  await expect(page.locator('#output-kind')).toHaveText('TYPE REPORT');
  await expect(page.locator('#stdout')).toContainText('count: fn(number) -> number');
  for (const engine of ['tree', 'vm']) {
    await page.locator('#engine').selectOption(engine);
    await page.locator('#run').click();
    await expect(page.locator('#result-badge')).toHaveText('SUCCESS');
    await expect(page.locator('#output-kind')).toHaveText('STDOUT');
    await expect(page.locator('#stdout')).toHaveText('11\n16\n12\nanswer: 42');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('typed source fails before execution and displays the exact static diagnostic', async ({ page }) => {
  await page.locator('#source').fill('print("must not execute");\nlet n: number = "bad";');
  await page.locator('#run').click();
  await expect(page.locator('#result-badge')).toHaveText('ERROR');
  await expect(page.locator('#diagnostic')).toContainText('custom.itou:2:17: type:');
  await expect(page.locator('#diagnostic')).toContainText('expected number, got string');
  await expect(page.locator('#stdout')).not.toContainText('must not execute');
});
