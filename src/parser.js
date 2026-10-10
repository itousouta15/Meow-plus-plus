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
  expect(kind, message = `expected '${kind}'`) {
    if (this.match(kind)) return this.previous();
    fail(message, this.peek().span, 'parse');
  }
  guard(fn) {
    if (++this.depth > 180) fail('syntax nesting is too deep', this.peek().span, 'limit');
    try { return fn(); } finally { this.depth--; }
  }
  program() {
    const first = this.peek();
    const body = [];
    while (!this.check('eof')) body.push(this.declaration());
    return { type: 'Program', body, span: spanBetween(first, this.peek()) };
  }
  declaration() {
    if (this.match('let')) {
      const first = this.previous();
      const name = this.expect('identifier', 'expected a variable name');
      const annotation = this.match(':') ? this.typeAnnotation() : null;
      this.expect('=', "variables require an initializer: let name = value;");
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
    const last = this.expect('}', "expected '}' to close block");
    return { type: 'Block', body, span: spanBetween(first, last) };
  }
  functionBody(first, name = '<anonymous>') {
    return this.guard(() => {
      this.expect('(');
      const params = [];
      if (!this.check(')')) {
        do {
          const param = this.expect('identifier', 'expected parameter name');
          const annotation = this.match(':') ? this.typeAnnotation() : null;
          params.push({ name: param.value, span: param.span, annotation });
          if (params.length > 64) fail('at most 64 parameters are allowed', param.span, 'parse');
        } while (this.match(','));
      }
      this.expect(')');
      const returnType = this.match(':') ? this.typeAnnotation() : null;
      const body = this.block(this.expect('{', "expected '{' before function body"));
      return { type: 'Function', name, params, returnType, body, span: spanBetween(first, body) };
    });
  }
  typeAnnotation() {
    return this.guard(() => {
      if (this.match('fn')) {
        this.expect('(');
        const params = [];
        if (!this.check(')')) {
          do {
            params.push(this.typeAnnotation());
            if (params.length > 64) fail('at most 64 function type parameters are allowed', this.peek().span, 'parse');
          } while (this.match(','));
        }
        this.expect(')'); this.expect('->', "expected '->' before function result type");
        return functionType(params, this.typeAnnotation());
      }
      const token = this.peek();
      if (!this.match('identifier', 'null')) fail('expected a type annotation', token.span, 'parse');
      if (!Object.hasOwn(primitiveTypes, token.value)) fail(`unknown type '${token.value}'`, token.span, 'type');
      return primitiveTypes[token.value];
    });
  }
  expression() { return this.guard(() => this.assignment()); }
  assignment() {
    const left = this.or();
    if (this.match('=')) {
      const op = this.previous();
      const value = this.expression();
      if (left.type !== 'Variable') fail('assignment target must be a variable', op.span, 'parse');
      return { type: 'Assign', name: left.name, value, span: spanBetween(left, value), nameSpan: left.span };
    }
    return left;
  }
  binary(next, operators, logical = false) {
    let node = next.call(this);
    while (this.match(...operators)) {
      const op = this.previous();
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
    if (this.match('!', '-')) {
      const op = this.previous();
      const value = this.guard(() => this.unary());
      return { type: 'Unary', op: op.kind, opSpan: op.span, value, span: spanBetween(op, value) };
    }
    return this.call();
  }
  call() {
    let node = this.primary();
    while (this.match('(')) {
      const args = [];
      if (!this.check(')')) {
        do {
          args.push(this.expression());
          if (args.length > 64) fail('at most 64 arguments are allowed', this.peek().span, 'parse');
        } while (this.match(','));
      }
      const last = this.expect(')');
      node = { type: 'Call', callee: node, args, span: spanBetween(node, last) };
    }
    return node;
  }
  primary() {
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
    fail('expected an expression', this.peek().span, 'parse');
  }
}

export function parse(source) { return new Parser(tokenize(source)).program(); }
