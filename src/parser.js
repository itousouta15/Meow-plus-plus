import { tokenize } from './lexer.js';
import { fail } from './diagnostics.js';
import { primitiveTypes, functionType } from './types.js';

const spanBetween = (first, last) => ({ ...first.span, end: last.span.end });

class Parser {
  constructor(tokens) { this.tokens = tokens; this.at = 0; this.depth = 0; }
  peek() { return this.tokens[this.at]; }
  previous() { return this.tokens[this.at - 1]; }
  check(kind) { return this.peek().kind === kind; }
  match(...kinds) {
    if (!kinds.includes(this.peek().kind)) return false;
    this.at++;
    return true;
  }
  expect(kind, message = `預期 '${kind}'`) {
    if (this.match(kind)) return this.previous();
    fail(message, this.peek().span, 'parse');
  }
  guard(fn) {
    if (++this.depth > 80) fail('語法巢狀層級過深', this.peek().span, 'limit');
    try { return fn(); } finally { this.depth--; }
  }
  program() {
    const first = this.peek();
    const body = [];
    while (!this.check('eof')) body.push(this.declaration());
    const entries = body.filter(node => node.type === 'FunctionDecl' && node.entry);
    if (entries.length > 1) fail('只能宣告一個主程式入口（主程式或 main）', entries[1].nameSpan, 'type');
    const entry = entries[0];
    if (entry) {
      if (entry.fn.params.length || !['number', 'null'].includes(entry.fn.returnType.kind)) fail('主程式入口必須是 整數 主程式() 或 無值 主程式()（亦可使用 main）', entry.nameSpan, 'type');
      body.push({ type: 'ExpressionStmt', expression: { type: 'Call', callee: { type: 'Variable', name: entry.name, span: entry.nameSpan }, args: [], span: entry.nameSpan }, span: entry.nameSpan });
    }
    return { type: 'Program', body, span: spanBetween(first, this.peek()) };
  }
  declaration() {
    const leadingType = (this.check('identifier') || this.check('null')) && Object.hasOwn(primitiveTypes, this.peek().value) && this.tokens[this.at + 1].kind === 'identifier';
    const callableType = ((this.check('identifier') && this.peek().value === 'function') || this.check('fn')) && this.tokens[this.at + 1].kind === '<';
    if (leadingType || callableType) {
      const first = this.peek();
      const annotation = this.typeAnnotation();
      const name = this.expect('identifier');
      if (this.check('(')) {
        const fn = this.functionBody(first, name.value, annotation, true);
        return { type: 'FunctionDecl', name: name.value, nameSpan: name.span, fn, entry: ['主程式', 'main'].includes(name.value), span: fn.span };
      }
      if (this.check(';') && !['any', 'function'].includes(annotation.kind)) {
        const last = this.expect(';');
        const value = { number: 0, string: '', boolean: false, null: null }[annotation.kind];
        return { type: 'Let', name: name.value, nameSpan: name.span, annotation, init: { type: 'Literal', value, span: name.span }, span: spanBetween(first, last) };
      }
      this.expect('=', '變數需要初始值：整數 名稱 = 值;');
      const init = this.expression();
      const last = this.expect(';');
      return { type: 'Let', name: name.value, nameSpan: name.span, annotation, init, span: spanBetween(first, last) };
    }
    if (this.match('let')) {
      const first = this.previous();
      const name = this.expect('identifier', '預期變數名稱');
      const annotation = this.match(':') ? this.typeAnnotation() : null;
      this.expect('=', '變數需要初始值：令 名稱 = 值;');
      const init = this.expression();
      const last = this.expect(';');
      return { type: 'Let', name: name.value, nameSpan: name.span, annotation, init, span: spanBetween(first, last) };
    }
    if (this.check('fn') && this.tokens[this.at + 1].kind === 'identifier') {
      const first = this.expect('fn');
      const name = this.expect('identifier');
      const fn = this.functionBody(first, name.value);
      return { type: 'FunctionDecl', name: name.value, nameSpan: name.span, fn, span: fn.span };
    }
    return this.statement();
  }
  statement() {
    return this.guard(() => {
      if (this.check('identifier')) {
        const name = this.peek().value;
        if (['喵out', 'cout', '喵err', 'cerr', '喵log', 'clog'].includes(name) && this.tokens[this.at + 1].kind === '<<') {
          const first = this.tokens[this.at++];
          const values = [];
          do {
            this.expect('<<');
            if (this.check('identifier') && ['喵endl', 'endl'].includes(this.peek().value)) {
              const token = this.tokens[this.at++];
              values.push({ type: 'Literal', value: '\n', span: token.span });
            } else values.push(this.expression());
            if (values.length > 64) fail('串流敘述最多只允許 64 個值', this.peek().span, 'parse');
          } while (this.check('<<'));
          const last = this.expect(';');
          return { type: 'StreamOut', channel: ['喵out', 'cout'].includes(name) ? 'stdout' : 'stderr', values, span: spanBetween(first, last) };
        }
        if (['喵in', 'cin'].includes(name) && this.tokens[this.at + 1].kind === '>>') {
          const first = this.tokens[this.at++];
          const targets = [];
          do {
            this.expect('>>');
            const target = this.expect('identifier', '喵in 的讀取目標必須是變數');
            targets.push({ type: 'Variable', name: target.value, span: target.span });
            if (targets.length > 64) fail('串流敘述最多只允許 64 個值', this.peek().span, 'parse');
          } while (this.check('>>'));
          const last = this.expect(';');
          return { type: 'StreamIn', mode: 'token', targets, span: spanBetween(first, last) };
        }
        if (['喵getline', 'getline'].includes(name) && this.tokens[this.at + 1].kind === '(') {
          const first = this.tokens[this.at++];
          this.expect('(');
          const stream = this.expect('identifier', '喵getline 第一個參數必須是 喵in');
          if (!['喵in', 'cin'].includes(stream.value)) fail('喵getline 第一個參數必須是 喵in', stream.span, 'parse');
          this.expect(',');
          const target = this.expect('identifier', '喵getline 的讀取目標必須是變數');
          this.expect(')');
          const last = this.expect(';');
          return { type: 'StreamIn', mode: 'line', targets: [{ type: 'Variable', name: target.value, span: target.span }], span: spanBetween(first, last) };
        }
      }
      if (this.match('{')) return this.block(this.previous());
      if (this.match('if')) {
        const first = this.previous();
        this.expect('('); const test = this.expression(); this.expect(')');
        const then = this.statement();
        const otherwise = this.match('else') ? this.statement() : null;
        return { type: 'If', test, then, otherwise, span: spanBetween(first, otherwise ?? then) };
      }
      if (this.match('while')) {
        const first = this.previous();
        this.expect('('); const test = this.expression(); this.expect(')');
        const body = this.statement();
        return { type: 'While', test, body, span: spanBetween(first, body) };
      }
      if (this.match('for')) {
        const first = this.previous();
        this.expect('(');
        const init = this.check(';') ? (this.at++, null) : this.declaration();
        if (init && !['Let', 'ExpressionStmt'].includes(init.type)) fail('迴圈初始部分必須是變數宣告或運算式', init.span, 'parse');
        const test = this.check(';') ? { type: 'Literal', value: true, span: this.peek().span } : this.expression();
        this.expect(';');
        const update = this.check(')') ? null : this.expression();
        this.expect(')');
        const body = this.statement();
        return { type: 'Block', body: [...(init ? [init] : []), { type: 'For', test, update, body, span: spanBetween(first, body) }], span: spanBetween(first, body) };
      }
      if (this.match('return')) {
        const first = this.previous();
        const value = this.check(';') ? null : this.expression();
        const last = this.expect(';');
        return { type: 'Return', value, span: spanBetween(first, last) };
      }
      if (this.match('break', 'continue')) {
        const first = this.previous();
        const last = this.expect(';');
        return { type: first.kind === 'break' ? 'Break' : 'Continue', span: spanBetween(first, last) };
      }
      if (this.match(';')) return { type: 'Empty', span: this.previous().span };
      const expression = this.expression();
      const last = this.expect(';');
      return { type: 'ExpressionStmt', expression, span: spanBetween(expression, last) };
    });
  }
  block(first) {
    const body = [];
    while (!this.check('}') && !this.check('eof')) body.push(this.declaration());
    const last = this.expect('}', "預期 '}' 以結束區塊");
    return { type: 'Block', body, span: spanBetween(first, last) };
  }
  functionBody(first, name = '<anonymous>', leadingReturn = null, cpp = false) {
    return this.guard(() => {
      this.expect('(');
      const params = [];
      if (!this.check(')')) {
        do {
          const leading = cpp ? this.typeAnnotation() : null;
          const param = this.expect('identifier', '預期參數名稱');
          const annotation = leading ?? (this.match(':') ? this.typeAnnotation() : null);
          params.push({ name: param.value, span: param.span, annotation });
          if (params.length > 64) fail('最多只允許 64 個參數', param.span, 'parse');
        } while (this.match(','));
      }
      this.expect(')');
      const returnType = leadingReturn ?? (this.match(cpp ? '->' : ':') ? this.typeAnnotation() : null);
      const body = this.block(this.expect('{', "函式主體前預期 '{'"));
      return { type: 'Function', name, params, returnType, body, span: spanBetween(first, body) };
    });
  }
  typeAnnotation() {
    return this.guard(() => {
      if (((this.check('identifier') && this.peek().value === 'function') || this.check('fn')) && this.tokens[this.at + 1].kind === '<') {
        this.at++; this.expect('<');
        const returns = this.typeAnnotation();
        this.expect('(');
        const params = [];
        if (!this.check(')')) do {
          params.push(this.typeAnnotation());
          if (params.length > 64) fail('函式型別最多只允許 64 個參數', this.peek().span, 'parse');
        } while (this.match(','));
        this.expect(')'); this.expect('>');
        return functionType(params, returns);
      }
      if (this.match('fn')) {
        this.expect('(');
        const params = [];
        if (!this.check(')')) {
          do {
            params.push(this.typeAnnotation());
            if (params.length > 64) fail('函式型別最多只允許 64 個參數', this.peek().span, 'parse');
          } while (this.match(','));
        }
        this.expect(')'); this.expect('->', "函式回傳型別前預期 '->'");
        return functionType(params, this.typeAnnotation());
      }
      const token = this.peek();
      if (!this.match('identifier', 'null')) fail('預期型別註記', token.span, 'parse');
      if (!Object.hasOwn(primitiveTypes, token.value)) fail(`未知的型別 '${token.value}'`, token.span, 'type');
      return primitiveTypes[token.value];
    });
  }
  expression() { return this.guard(() => this.assignment()); }
  assignment() {
    const left = this.or();
    if (this.match('=', '+=', '-=', '*=', '/=', '%=')) {
      const op = this.previous();
      let value = this.expression();
      if (left.type !== 'Variable') fail('賦值目標必須是變數', op.span, 'parse');
      if (op.kind !== '=') value = { type: 'Binary', left: { ...left }, op: op.kind[0], opSpan: op.span, right: value, span: spanBetween(left, value) };
      return { type: 'Assign', name: left.name, value, span: spanBetween(left, value), nameSpan: left.span };
    }
    return left;
  }
  binary(next, operators, logical = false) {
    let node = next.call(this);
    let count = 0;
    while (this.match(...operators)) {
      const op = this.previous();
      if (++count > 100) fail('語法樹過深', op.span, 'limit');
      const right = next.call(this);
      node = { type: logical ? 'Logical' : 'Binary', left: node, op: op.kind, opSpan: op.span,
        right, span: spanBetween(node, right) };
    }
    return node;
  }
  or() { return this.binary(this.and, ['or'], true); }
  and() { return this.binary(this.equality, ['and'], true); }
  equality() { return this.binary(this.comparison, ['==', '!=']); }
  comparison() { return this.binary(this.term, ['<', '<=', '>', '>=']); }
  term() { return this.binary(this.factor, ['+', '-']); }
  factor() { return this.binary(this.unary, ['*', '/', '%']); }
  unary() {
    if (this.match('++', '--')) {
      const op = this.previous();
      return this.update(this.guard(() => this.unary()), op, true);
    }
    if (this.match('!', '-')) {
      const op = this.previous();
      const value = this.guard(() => this.unary());
      return { type: 'Unary', op: op.kind, opSpan: op.span, value, span: spanBetween(op, value) };
    }
    return this.call();
  }
  call() {
    let node = this.primary();
    while (true) {
      if (this.match('++', '--')) { node = this.update(node, this.previous(), false); continue; }
      if (!this.match('(')) break;
      const args = [];
      if (!this.check(')')) {
        do {
          args.push(this.expression());
          if (args.length > 64) fail('最多只允許 64 個引數', this.peek().span, 'parse');
        } while (this.match(','));
      }
      const last = this.expect(')');
      node = { type: 'Call', callee: node, args, span: spanBetween(node, last) };
    }
    return node;
  }
  update(value, op, prefix) {
    if (value.type !== 'Variable') fail('遞增／遞減目標必須是變數', op.span, 'parse');
    return { type: 'Update', name: value.name, op: op.kind, prefix, nameSpan: value.span, span: prefix ? spanBetween(op, value) : spanBetween(value, op) };
  }
  primary() {
    if (this.match('[')) {
      const first = this.previous();
      this.expect('&', 'lambda 使用 [&] 捕獲外層變數'); this.expect(']');
      return this.functionBody(first, '<anonymous>', null, true);
    }
    if (this.match('number', 'string')) return { type: 'Literal', value: this.previous().value, span: this.previous().span };
    if (this.match('true', 'false', 'null')) {
      const token = this.previous();
      return { type: 'Literal', value: token.kind === 'null' ? null : token.kind === 'true', span: token.span };
    }
    if (this.match('identifier')) return { type: 'Variable', name: this.previous().value, span: this.previous().span };
    if (this.match('fn')) return this.functionBody(this.previous());
    if (this.match('(')) {
      const node = this.expression(); this.expect(')'); return node;
    }
    fail('預期一個運算式', this.peek().span, 'parse');
  }
}

export function parse(source) { return new Parser(tokenize(source)).program(); }
