import { fail } from './diagnostics.js';

const keywords = new Set(['let', 'fn', 'if', 'else', 'while', 'for', 'return', 'break', 'continue', 'true', 'false', 'null', 'and', 'or']);
const aliases = new Map([
  ['令', 'let'], ['設', 'let'],
  ['函式', 'fn'], ['函', 'fn'],
  ['如果', 'if'], ['若', 'if'], ['否則', 'else'],
  ['當', 'while'],
  ['迴圈', 'for'], ['對於', 'for'],
  ['回傳', 'return'], ['返回', 'return'],
  ['中斷', 'break'], ['跳出', 'break'], ['繼續', 'continue'],
  ['真', 'true'], ['假', 'false'], ['空', 'null'],
  ['且', 'and'], ['並且', 'and'], ['或', 'or'], ['或者', 'or'],
]);
const single = new Set('(){}[]&;,:+-*/%!=<>');
const double = new Set(['==', '!=', '<=', '>=', '->', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '<<', '>>']);
const digit = c => c !== undefined && c >= '0' && c <= '9';
const identifierStart = /[A-Za-z_\p{Script=Han}]/u;
const alpha = c => c !== undefined && identifierStart.test(c);

export function tokenize(source) {
  if (typeof source !== 'string') throw new TypeError('原始碼必須是字串');
  if (source.length > 262144) fail('原始碼超過 256 Ki 個 UTF-16 碼元', null, 'limit');
  const tokens = [];
  let offset = 0, line = 1, column = 1;
  const advance = () => {
    const char = source[offset++];
    if (char === '\n') { line++; column = 1; } else column++;
    return char;
  };
  const location = () => ({ start: offset, end: offset, line, column });
  const push = (kind, value, span) => {
    tokens.push({ kind, value, span: { ...span, end: offset } });
    if (tokens.length > 50000) fail('原始碼的 token 數量過多', span, 'limit');
  };

  while (offset < source.length) {
    const char = source[offset];
    if (/\s/.test(char)) { advance(); continue; }
    if (char === '/' && source[offset + 1] === '/') {
      while (offset < source.length && source[offset] !== '\n') advance();
      continue;
    }
    const span = location();
    if (char === '/' && source[offset + 1] === '*') {
      advance(); advance();
      let depth = 1;
      while (offset < source.length && depth > 0) {
        if (source[offset] === '/' && source[offset + 1] === '*') { advance(); advance(); depth++; }
        else if (source[offset] === '*' && source[offset + 1] === '/') { advance(); advance(); depth--; }
        else advance();
      }
      if (depth !== 0) fail('區塊註解沒有結束', span, 'lex');
      continue;
    }
    if (alpha(char)) {
      while (alpha(source[offset]) || digit(source[offset])) advance();
      const text = source.slice(span.start, offset);
      if (keywords.has(text)) push(text, text, span);
      else if (aliases.has(text)) push(aliases.get(text), text, span);
      else push('identifier', text, span);
      continue;
    }
    if (digit(char)) {
      while (digit(source[offset])) advance();
      if (source[offset] === '.' && digit(source[offset + 1])) {
        advance();
        while (digit(source[offset])) advance();
      }
      if (source[offset] === 'e' || source[offset] === 'E') {
        advance();
        if (source[offset] === '+' || source[offset] === '-') advance();
        if (!digit(source[offset])) fail('指數部分缺少數字', { ...span, end: offset }, 'lex');
        while (digit(source[offset])) advance();
      }
      const value = Number(source.slice(span.start, offset));
      if (!Number.isFinite(value)) fail('數字常值必須是有限的', { ...span, end: offset }, 'lex');
      push('number', value, span);
      continue;
    }
    if (char === '"') {
      advance();
      let closed = false;
      while (offset < source.length) {
        if (source[offset] === '"') { advance(); closed = true; break; }
        if (source[offset] === '\n' || source[offset] === '\r') fail('字串中出現換行；請使用 \\n', span, 'lex');
        if (advance() === '\\' && offset < source.length) {
          if (source[offset] === '\n' || source[offset] === '\r') fail('字串中出現換行；請使用 \\n', span, 'lex');
          advance();
        }
      }
      if (!closed) fail('字串沒有結束', span, 'lex');
      let value;
      try { value = JSON.parse(source.slice(span.start, offset)); }
      catch { fail('無效的字串跳脫序列（請使用 JSON 風格）', { ...span, end: offset }, 'lex'); }
      if (value.length > 65536) fail('字串超過 65536 個碼元', span, 'limit');
      push('string', value, span);
      continue;
    }
    const pair = source.slice(offset, offset + 2);
    if (double.has(pair)) { advance(); advance(); push(pair === '&&' ? 'and' : pair === '||' ? 'or' : pair, pair, span); continue; }
    if (single.has(char)) { advance(); push(char, char, span); continue; }
    advance();
    fail(`未預期的字元 ${JSON.stringify(char)}`, { ...span, end: offset }, 'lex');
  }
  push('eof', null, location());
  return tokens;
}
