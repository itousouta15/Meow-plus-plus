import { upgradeHelloBrand } from '../src/branding.js';

const $ = id => document.getElementById(id);
const editor = $('source');
const breakpoints = new Set();
let worker = null, request = 0, started = 0, busy = false, debugging = false, activeLine = null;
let filename = 'hello.itou';
let lineCount = 1;
let loadVersion = 0;
const readPreference = key => { try { return localStorage.getItem(key); } catch { return null; } };
const savePreference = (key, value) => { try { localStorage.setItem(key, value); return true; } catch { return false; } };

function status(text, state = '') {
  $('status').textContent = text;
  $('status').dataset.state = state;
}
const badgeLabels = { READY: '就緒', RUNNING: '執行中', COMPILING: '編譯中', SUCCESS: '成功', 'TYPES OK': '型別通過', COMPILED: '編譯完成', PAUSED: '已暫停', FINISHED: '已結束', ERROR: '錯誤', STOPPED: '已停止' };
const typeLabels = { any: '任意', number: '數字', string: '字串', boolean: '布林', null: '空', fn: '函式', function: '函式', pending: '尚未初始化' };
function localizedType(text) { return text.replace(/\b(any|number|string|boolean|null|fn|function|pending)\b/g, word => typeLabels[word]); }
function badge(text, state = '') { $('result-badge').textContent = badgeLabels[text] ?? text; $('result-badge').dataset.state = state; }
function selectTab(name) {
  for (const tab of document.querySelectorAll('[data-tab]')) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`panel-${tab.dataset.tab}`).hidden = !selected;
  }
}
function controls() {
  for (const id of ['run', 'check', 'compile', 'debug', 'example', 'engine']) $(id).disabled = busy;
  $('stop').disabled = !busy && !debugging;
  for (const id of ['step-line', 'step-instruction', 'continue']) $(id).disabled = busy || !debugging;
}
function drawGutter() {
  const inner = $('gutter-inner');
  const lineHeight = 24;
  inner.style.height = `${lineCount * lineHeight + 32}px`;
  const start = Math.max(1, Math.floor(editor.scrollTop / lineHeight) - 1);
  const end = Math.min(lineCount, start + Math.ceil(editor.clientHeight / lineHeight) + 5);
  const fragment = document.createDocumentFragment();
  for (let line = start; line <= end; line++) {
    const button = document.createElement('button');
    button.textContent = String(line);
    button.dataset.line = line;
    button.style.top = `${16 + (line - 1) * lineHeight}px`;
    button.classList.toggle('has-breakpoint', breakpoints.has(line));
    button.classList.toggle('active-line', line === activeLine);
    button.setAttribute('aria-label', `切換第 ${line} 行中斷點`);
    button.setAttribute('aria-pressed', String(breakpoints.has(line)));
    button.tabIndex = -1;
    fragment.append(button);
  }
  inner.replaceChildren(fragment);
  $('gutter').scrollTop = editor.scrollTop;
  $('breakpoint-count').textContent = `${breakpoints.size} 個中斷點`;
}
function cursor() {
  const before = editor.value.slice(0, editor.selectionStart);
  const lines = before.split('\n');
  $('cursor').textContent = `第 ${lines.length} 行，第 ${lines.at(-1).length + 1} 欄`;
}
function renderOutput(lines, error = null, stdout = null, stderr = '') {
  const text = stdout ?? lines.join('\n');
  $('stdout').textContent = text || '（沒有輸出）';
  $('stdout').dataset.empty = String(text.length === 0);
  $('stderr-panel').hidden = !stderr;
  $('stderr').textContent = stderr;
  $('diagnostic').hidden = !error;
  $('diagnostic').textContent = error ?? '';
}
function renderDebug(state) {
  activeLine = state.done ? null : state.location.line;
  drawGutter();
  const instruction = state.instruction;
  $('debug-position').textContent = state.done ? `執行結束 · ${state.steps.toLocaleString()} 條指令` : `第 ${state.location.line} 行，第 ${state.location.column} 欄  ·  #${instruction.functionId} / ${String(instruction.index).padStart(4, '0')} ${instruction.op}`;
  const frames = state.frames.map(frame => {
    const row = document.createElement('div'); row.className = 'frame-row';
    const name = document.createElement('span'); name.textContent = frame.name === '<script>' ? '<全域>' : frame.name === '<anonymous>' ? '<匿名函式>' : frame.name;
    const position = document.createElement('span'); position.textContent = `第 ${frame.line} 行 / 指令 ${frame.ip}`;
    row.append(name, position); return row;
  });
  $('frames').replaceChildren(...frames);
  const fragment = document.createDocumentFragment();
  state.scopes.forEach((scope, index) => {
    const heading = document.createElement('div'); heading.className = 'scope-label';
    heading.textContent = `作用域 ${index}${index === 0 ? ' · 目前位置' : ''}`;
    fragment.append(heading);
    if (scope.length === 0) { const empty = document.createElement('div'); empty.className = 'muted'; empty.textContent = '（沒有區域變數）'; fragment.append(empty); }
    for (const variable of scope) {
      const row = document.createElement('div'); row.className = 'variable-row';
      for (const text of [variable.name, variable.value, localizedType(variable.type)]) { const cell = document.createElement('span'); cell.textContent = text; row.append(cell); }
      row.title = `宣告型別：${localizedType(variable.declaredType)}`;
      fragment.append(row);
    }
  });
  $('variables').replaceChildren(fragment);
  $('operand-stack').textContent = state.stack.length ? state.stack.map((value, index) => `${index}: ${value}`).join('\n') : '[]';
  renderOutput(state.output, null, state.stdout, state.stderr);
  $('metrics').textContent = `${state.steps.toLocaleString()} 條虛擬機指令`;
  if (activeLine !== null) {
    const top = (activeLine - 1) * 24;
    if (top < editor.scrollTop || top > editor.scrollTop + editor.clientHeight - 48) editor.scrollTop = Math.max(0, top - 48);
    drawGutter();
  }
}
function resetWorker() {
  worker?.terminate();
  worker = null;
  request++;
  busy = false;
  debugging = false;
  activeLine = null;
  controls();
  drawGutter();
}
function createWorker() {
  worker = new Worker('/web/worker.js', { type: 'module' });
  worker.onmessage = event => {
    const message = event.data;
    if (message.id !== request) return;
    busy = false;
    if (message.assembly) $('bytecode').textContent = message.assembly;
    if (message.type === 'result') {
      debugging = false;
      renderOutput(message.result.output, null, message.result.stdout, message.result.stderr);
      const elapsed = (performance.now() - started).toFixed(1);
      $('metrics').textContent = `${elapsed} 毫秒 · ${message.result.steps.toLocaleString()} ${message.result.engine === 'vm' ? '條指令' : '步語法樹操作'}`;
      badge('SUCCESS', 'success'); status(`執行完成 · ${message.result.engine === 'vm' ? '位元組碼虛擬機' : '語法樹直譯器'}`);
    } else if (message.type === 'checked') {
      debugging = false;
      renderOutput(message.report.globals.map(variable => `${variable.name}：${localizedType(variable.type)}`));
      $('metrics').textContent = `${message.report.globals.length} 個宣告 · ${message.report.functions.length} 個函式`;
      badge('TYPES OK', 'success'); status('靜態型別檢查通過。');
    } else if (message.type === 'compiled') {
      debugging = false;
      badge('COMPILED', 'success'); status('編譯完成，尚未執行程式。');
    } else if (message.type === 'paused') {
      debugging = !message.state.done;
      renderDebug(message.state);
      badge(message.state.done ? 'FINISHED' : 'PAUSED', message.state.done ? 'success' : 'paused');
      status(message.state.done ? '除錯執行完成。' : `停在第 ${message.state.location.line} 行 · 可單步或繼續到中斷點`);
    } else if (message.type === 'error') {
      debugging = false;
      if (message.state) renderDebug(message.state);
      renderOutput(message.output, message.formatted, message.stdout, message.stderr);
      $('metrics').textContent = ({ lex: '詞法分析', parse: '語法分析', resolve: '名稱解析', type: '型別檢查', runtime: '執行期', limit: '資源上限', internal: '核心錯誤' })[message.error.phase] ?? message.error.phase;
      badge('ERROR', 'error'); status(message.error.message, 'error'); selectTab('output');
      if (message.error.span) {
        activeLine = message.error.span.line;
        editor.setSelectionRange(message.error.span.start, message.error.span.end);
        editor.scrollTop = Math.max(0, (activeLine - 3) * 24);
        cursor(); drawGutter();
      }
    }
    controls();
  };
  worker.onerror = event => {
    resetWorker();
    badge('ERROR', 'error'); status('Worker 無法執行。請確認由本機 HTTP 伺服器開啟。', 'error');
    renderOutput([], event.message); selectTab('output');
  };
}
function start(type) {
  loadVersion++;
  resetWorker();
  createWorker();
  busy = true; controls(); started = performance.now();
  $('diagnostic').hidden = true;
  $('output-kind').textContent = type === 'check' ? '型別報告' : '標準輸出';
  badge(type === 'run' ? 'RUNNING' : 'COMPILING');
  status(type === 'run' ? '正在執行…' : '正在編譯…');
  selectTab(type === 'compile' ? 'bytecode' : type === 'debug' ? 'debugger' : 'output');
  worker.postMessage({ id: request, type, source: editor.value, filename, engine: $('engine').value, input: $('input').value });
}
function debugCommand(type) {
  if (!debugging || busy) return;
  busy = true; controls(); badge('RUNNING');
  worker.postMessage({ id: request, type, breakpoints: [...breakpoints] });
}
function changed() {
  loadVersion++;
  if (busy || debugging) resetWorker();
  activeLine = null;
  filename = 'custom.itou'; $('filename').textContent = filename; $('example').value = 'custom';
  lineCount = editor.value.split('\n').length;
  for (const line of breakpoints) if (line > lineCount) breakpoints.delete(line);
  $('save-state').textContent = savePreference('itoulang.source', editor.value) ? '已儲存到此瀏覽器' : '暫存於本次工作區';
  badge('READY'); status('程式已更新。'); cursor(); drawGutter();
}
async function loadExample(name) {
  const version = ++loadVersion;
  resetWorker();
  try {
    const response = await fetch(`/examples/${name}.itou`);
    if (!response.ok) throw new Error('無法載入範例');
    const source = await response.text();
    if (version !== loadVersion) return;
    editor.value = source;
    if (name === 'streams' && !$('input').value) { $('input').value = '3 4\n'; savePreference('itoulang.input', $('input').value); }
    editor.scrollTop = 0; editor.setSelectionRange(0, 0);
    filename = `${name}.itou`; $('filename').textContent = filename;
    lineCount = editor.value.split('\n').length; breakpoints.clear();
    savePreference('itoulang.source', editor.value);
    $('save-state').textContent = '已儲存到此瀏覽器';
    badge('READY'); status('準備好了。寫點程式，或直接執行範例。'); cursor(); drawGutter();
  } catch (error) { if (version === loadVersion) status(error.message, 'error'); }
}

document.documentElement.dataset.theme = readPreference('itoulang.theme') ?? 'dark';
$('theme').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme; savePreference('itoulang.theme', theme);
});
$('run').addEventListener('click', () => start('run'));
$('check').addEventListener('click', () => start('check'));
$('compile').addEventListener('click', () => start('compile'));
$('debug').addEventListener('click', () => start('debug'));
$('stop').addEventListener('click', () => { resetWorker(); badge('STOPPED'); status('已停止執行；程式碼保留在工作區。'); });
for (const type of ['step-line', 'step-instruction', 'continue']) $(type).addEventListener('click', () => debugCommand(type));
$('example').addEventListener('change', event => loadExample(event.target.value));
editor.addEventListener('input', changed);
$('input').addEventListener('input', () => {
  if (busy || debugging) resetWorker();
  savePreference('itoulang.input', $('input').value);
  badge('READY'); status('標準輸入已更新。');
});
editor.addEventListener('scroll', drawGutter);
editor.addEventListener('click', cursor);
editor.addEventListener('keyup', cursor);
editor.addEventListener('select', cursor);
new ResizeObserver(drawGutter).observe(editor);
$('gutter').addEventListener('click', event => {
  const line = Number(event.target.closest('button')?.dataset.line);
  if (!line) return;
  if (breakpoints.has(line)) breakpoints.delete(line); else breakpoints.add(line);
  drawGutter();
});
for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[data-tab]')];
    const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
    selectTab(next.dataset.tab); next.focus();
  });
}
editor.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    event.preventDefault();
    if (!event.shiftKey) editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    else {
      const start = editor.value.lastIndexOf('\n', editor.selectionStart - 1) + 1;
      if (editor.value.slice(start, start + 2) === '  ') editor.setRangeText('', start, start + 2, 'preserve');
    }
    changed();
  }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!busy) start('run'); }
  if (event.key === 'F10') { event.preventDefault(); debugCommand('step-line'); }
  if (event.key === 'F8') { event.preventDefault(); if (debugging) debugCommand('continue'); else if (!busy) start('debug'); }
  if (event.key === 'F9' && document.activeElement === editor) {
    event.preventDefault();
    const line = editor.value.slice(0, editor.selectionStart).split('\n').length;
    if (breakpoints.has(line)) breakpoints.delete(line); else breakpoints.add(line);
    drawGutter();
  }
});
$('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([editor.value], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
const saved = readPreference('itoulang.source');
$('input').value = readPreference('itoulang.input') ?? '';
if (saved !== null) {
  editor.value = upgradeHelloBrand(saved); filename = 'custom.itou'; $('filename').textContent = filename; $('example').value = 'custom';
  if (editor.value !== saved) savePreference('itoulang.source', editor.value);
  lineCount = editor.value.split('\n').length;
  $('save-state').textContent = '已恢復上次內容'; status('已恢復上次編輯的程式。'); cursor(); drawGutter();
} else await loadExample('hello');
controls();
