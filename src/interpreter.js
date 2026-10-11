import { LangError, fail } from './diagnostics.js';
import { Environment, Context, builtins, boolean, unary, binary, prepareCall, finishCall, globalValues, display } from './runtime.js';
import { ANY } from './types.js';

export class Interpreter {
  constructor(program, options = {}) {
    this.program = program;
    this.context = new Context(options);
    this.globals = new Environment(program.layout, builtins(this.context), program.types);
    this.calls = [];
  }
  closure(node, environment) {
    return { kind: 'function', engine: 'tree', name: node.name, arity: node.params.length, node, environment,
      parameterTypes: node.params.map(param => param.annotation ?? ANY), returnType: node.returnType ?? ANY };
  }
  body(statements, environment) {
    // Function declarations are initialized at scope entry (mutual recursion).
    for (const statement of statements) {
      if (statement.type === 'FunctionDecl') environment.initialize(statement.slot, this.closure(statement.fn, environment), statement.span);
    }
    for (const statement of statements) {
      const signal = this.statement(statement, environment);
      if (signal) return signal;
    }
    return null;
  }
  statement(node, env) {
    this.context.tick(node.span);
    switch (node.type) {
      case 'Let': env.initialize(node.slot, this.expression(node.init, env), node.init.span); return null;
      case 'FunctionDecl': case 'Empty': return null;
      case 'Block': return this.body(node.body, new Environment(node.layout, env, node.types));
      case 'ExpressionStmt': this.expression(node.expression, env); return null;
      case 'StreamOut':
        for (const value of node.values) this.context.write(node.channel, display(this.expression(value, env)), value.span);
        return null;
      case 'StreamIn':
        for (const target of node.targets) { this.context.tick(target.span); this.context.extract(env, target.address, node.mode, target.span); }
        return null;
      case 'If':
        if (boolean(this.expression(node.test, env), node.test.span)) return this.statement(node.then, env);
        return node.otherwise ? this.statement(node.otherwise, env) : null;
      case 'While': case 'For':
        while (boolean(this.expression(node.test, env), node.test.span)) {
          const signal = this.statement(node.body, env);
          if (signal?.type === 'Return') return signal;
          if (signal?.type === 'Break') break;
          if (node.update) this.expression(node.update, env);
        }
        return null;
      case 'Return': return { type: 'Return', value: node.value ? this.expression(node.value, env) : null, span: node.span };
      case 'Break': case 'Continue': return { type: node.type };
      default: throw new Error(`invalid statement ${node.type}`);
    }
  }
  expression(node, env) {
    this.context.tick(node.span);
    switch (node.type) {
      case 'Literal': return node.value;
      case 'Variable': return env.get(node.address, node.span);
      case 'Assign': {
        const value = this.expression(node.value, env);
        return env.set(node.address, value, node.nameSpan);
      }
      case 'Update': {
        const old = env.get(node.address, node.nameSpan);
        const value = env.set(node.address, binary(node.op === '++' ? '+' : '-', old, 1, node.span), node.nameSpan);
        return node.prefix ? value : old;
      }
      case 'Unary': return unary(node.op, this.expression(node.value, env), node.opSpan);
      case 'Binary': {
        const left = this.expression(node.left, env);
        const right = this.expression(node.right, env);
        return binary(node.op, left, right, node.opSpan);
      }
      case 'Logical': {
        const left = boolean(this.expression(node.left, env), node.opSpan);
        if (node.op === 'and' && !left) return false;
        if (node.op === 'or' && left) return true;
        return boolean(this.expression(node.right, env), node.opSpan);
      }
      case 'Function': return this.closure(node, env);
      case 'Call': {
        const target = this.expression(node.callee, env);
        const arguments_ = node.args.map(arg => this.expression(arg, env));
        const call = prepareCall(target, arguments_, node.span);
        const { callee, args } = call;
        if (callee.kind === 'builtin') return finishCall(call, callee.call(args, node.span), node.span);
        if (this.calls.length >= this.context.maxDepth) fail('呼叫深度超過上限', node.span, 'limit');
        this.calls.push({ name: callee.name, span: node.span });
        try {
          const local = new Environment(callee.node.body.layout, callee.environment, callee.node.body.types);
          for (let i = 0; i < args.length; i++) local.initialize(i, args[i], node.span);
          const signal = this.body(callee.node.body.body, local);
          return finishCall(call, signal?.value ?? null, signal?.span ?? callee.node.body.span);
        } catch (error) {
          if (error instanceof LangError && error.frames.length === 0) error.frames = [...this.calls];
          throw error;
        } finally { this.calls.pop(); }
      }
      default: throw new Error(`invalid expression ${node.type}`);
    }
  }
  run() {
    try { this.body(this.program.body, this.globals); }
    finally { this.context.finishOutput(); }
    return { output: [...this.context.output], stdout: this.context.stdout, stderr: this.context.stderr, globals: globalValues(this.globals), steps: this.context.steps, engine: 'tree' };
  }
}
