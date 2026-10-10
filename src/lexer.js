import { fail } from './diagnostics.js';

const keywords = new Set(['let', 'fn', 'if', 'else', 'while', 'return', 'break', 'continue', 'true', 'false', 'null', 'and', 'or']);
const single = new Set('(){};,:+-*/%!=<>');
const double = new Set(['==', '!=', '<=', '>=', '->']);
const digit = c => c !== undefined && c >= '0' && c <= '9';
const alpha = c => c !== undefined && /[A-Za-z_]/.test(c);

export function tokenize(source) {
  if (typeof source !== 'string') throw new TypeError('source must be a string');
  if (source.length > 262144) fail('source exceeds 256 Ki UTF-16 code units', null, 'limit');
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
    if (tokens.length > 50000) fail('source has too many tokens', span, 'limit');
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
      if (depth !== 0) fail('unterminated block comment', span, 'lex');
      continue;
    }
    if (alpha(char)) {
      while (alpha(source[offset]) || digit(source[offset])) advance();
      const text = source.slice(span.start, offset);
      push(keywords.has(text) ? text : 'identifier', text, span);
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
        if (!digit(source[offset])) fail('expected digits in exponent', { ...span, end: offset }, 'lex');
        while (digit(source[offset])) advance();
      }
      const value = Number(source.slice(span.start, offset));
      if (!Number.isFinite(value)) fail('number literal must be finite', { ...span, end: offset }, 'lex');
      push('number', value, span);
      continue;
    }
    if (char === '"') {
      advance();
      let closed = false;
      while (offset < source.length) {
        if (source[offset] === '"') { advance(); closed = true; break; }
        if (source[offset] === '\n' || source[offset] === '\r') fail('newline in string; use \\n', span, 'lex');
        if (advance() === '\\' && offset < source.length) {
          if (source[offset] === '\n' || source[offset] === '\r') fail('newline in string; use \\n', span, 'lex');
          advance();
        }
      }
      if (!closed) fail('unterminated string', span, 'lex');
      let value;
      try { value = JSON.parse(source.slice(span.start, offset)); }
      catch { fail('invalid string escape (use JSON-style escapes)', { ...span, end: offset }, 'lex'); }
      if (value.length > 65536) fail('string exceeds 65536 code units', span, 'limit');
      push('string', value, span);
      continue;
    }
    const pair = source.slice(offset, offset + 2);
    if (double.has(pair)) { advance(); advance(); push(pair, pair, span); continue; }
    if (single.has(char)) { advance(); push(char, char, span); continue; }
    advance();
    fail(`unexpected character ${JSON.stringify(char)}`, { ...span, end: offset }, 'lex');
  }
  push('eof', null, location());
  return tokens;
}
