import { ANY, typeName } from './types.js';

class Compiler {
  constructor(name, params, layout, span, ids, types = [], parameterTypes = [], returnType = ANY) {
    this.ids = ids;
    this.proto = { id: ids.next++, name, params, layout, span, types, parameterTypes, returnType, constants: [], code: [] };
    this.scopeDepth = 0;
    this.loops = [];
  }
  emit(op, arg, span) {
    this.proto.code.push({ op, arg, span });
    return this.proto.code.length - 1;
  }
  patch(index, target = this.proto.code.length) { this.proto.code[index].arg = target; }
  constant(value, span) {
    let index = this.proto.constants.findIndex(item => Object.is(item, value));
    if (index === -1) { index = this.proto.constants.length; this.proto.constants.push(value); }
    this.emit('CONST', index, span);
  }
  function(node) {
    const child = new Compiler(node.name, node.params.map(p => p.name), node.body.layout, node.span, this.ids,
      node.body.types, node.params.map(param => param.annotation ?? ANY), node.returnType ?? ANY);
    child.body(node.body.body);
    child.constant(null, node.body.span);
    child.emit('RETURN', null, node.body.span);
    return child.proto;
  }
  body(statements) {
    for (const node of statements) {
      if (node.type === 'FunctionDecl') {
        this.emit('CLOSURE', this.function(node.fn), node.span);
        this.emit('INIT', node.slot, node.span);
      }
    }
    for (const node of statements) this.statement(node);
  }
  statement(node) {
    switch (node.type) {
      case 'Let': this.expression(node.init); this.emit('INIT', node.slot, node.init.span); break;
      case 'FunctionDecl': case 'Empty': break;
      case 'ExpressionStmt': this.expression(node.expression); this.emit('POP', null, node.span); break;
      case 'StreamOut':
        for (const value of node.values) { this.expression(value); this.emit('WRITE', node.channel, value.span); }
        break;
      case 'StreamIn':
        for (const target of node.targets) this.emit('READ', { address: target.address, mode: node.mode }, target.span);
        break;
      case 'Block':
        this.emit('ENTER', { names: node.layout, types: node.types }, node.span);
        this.scopeDepth++;
        this.body(node.body);
        this.scopeDepth--;
        this.emit('LEAVE', null, node.span);
        break;
      case 'If': {
        this.expression(node.test);
        const otherwise = this.emit('JUMP_FALSE', null, node.test.span);
        this.statement(node.then);
        if (node.otherwise) {
          const end = this.emit('JUMP', null, node.span);
          this.patch(otherwise);
          this.statement(node.otherwise);
          this.patch(end);
        } else this.patch(otherwise);
        break;
      }
      case 'While': case 'For': {
        const start = this.proto.code.length;
        this.expression(node.test);
        const end = this.emit('JUMP_FALSE', null, node.test.span);
        const loop = { start, scopeDepth: this.scopeDepth, breaks: [], continues: [] };
        this.loops.push(loop);
        this.statement(node.body);
        this.loops.pop();
        for (const jump of loop.continues) this.patch(jump);
        if (node.update) { this.expression(node.update); this.emit('POP', null, node.update.span); }
        this.emit('JUMP', start, node.span);
        this.patch(end);
        for (const jump of loop.breaks) this.patch(jump);
        break;
      }
      case 'Break': case 'Continue': {
        const loop = this.loops.at(-1);
        const unwind = this.scopeDepth - loop.scopeDepth;
        if (unwind > 0) this.emit('UNWIND', unwind, node.span);
        const jump = this.emit('JUMP', null, node.span);
        if (node.type === 'Break') loop.breaks.push(jump);
        else loop.continues.push(jump);
        break;
      }
      case 'Return':
        if (node.value) this.expression(node.value);
        else this.constant(null, node.span);
        this.emit('RETURN', null, node.span);
        break;
      default: throw new Error(`cannot compile statement ${node.type}`);
    }
  }
  expression(node) {
    switch (node.type) {
      case 'Literal': this.constant(node.value, node.span); break;
      case 'Variable': this.emit('LOAD', node.address, node.span); break;
      case 'Assign': this.expression(node.value); this.emit('STORE', node.address, node.nameSpan); break;
      case 'Update':
        this.emit('LOAD', node.address, node.nameSpan);
        if (!node.prefix) this.emit('DUP', null, node.span);
        this.constant(1, node.span);
        this.emit('BINARY', node.op === '++' ? '+' : '-', node.span);
        this.emit('STORE', node.address, node.nameSpan);
        if (!node.prefix) this.emit('POP', null, node.span);
        break;
      case 'Unary': this.expression(node.value); this.emit('UNARY', node.op, node.opSpan); break;
      case 'Binary': this.expression(node.left); this.expression(node.right); this.emit('BINARY', node.op, node.opSpan); break;
      case 'Logical': {
        this.expression(node.left);
        this.emit('DUP', null, node.opSpan);
        const jump = this.emit(node.op === 'and' ? 'JUMP_FALSE' : 'JUMP_TRUE', null, node.opSpan);
        this.emit('POP', null, node.opSpan);
        this.expression(node.right);
        this.emit('BOOL', null, node.opSpan);
        this.patch(jump);
        break;
      }
      case 'Function': this.emit('CLOSURE', this.function(node), node.span); break;
      case 'Call':
        this.expression(node.callee);
        for (const arg of node.args) this.expression(arg);
        this.emit('CALL', node.args.length, node.span);
        break;
      default: throw new Error(`cannot compile expression ${node.type}`);
    }
  }
}

export function compileAst(program) {
  const compiler = new Compiler('<script>', [], program.layout, program.span, { next: 0 }, program.types);
  compiler.body(program.body);
  compiler.emit('HALT', null, program.span);
  return compiler.proto;
}

export function prototypes(root) {
  const result = [root];
  for (const instruction of root.code) {
    if (instruction.op === 'CLOSURE') result.push(...prototypes(instruction.arg));
  }
  return result;
}

export function disassemble(root) {
  return prototypes(root).map(proto => {
    const parameters = proto.params.map((name, i) => `${name}: ${typeName(proto.parameterTypes[i])}`).join(', ');
    const slots = proto.layout.map((name, i) => `${name}: ${typeName(proto.types[i] ?? ANY)}`).join(', ');
    const lines = [`fn #${proto.id} ${proto.name}(${parameters}) -> ${typeName(proto.returnType)}`, `  slots: ${slots || '(none)'}`];
    for (let i = 0; i < proto.code.length; i++) {
      const instruction = proto.code[i];
      let arg = '';
      if (instruction.op === 'CONST') arg = `${instruction.arg} (${JSON.stringify(proto.constants[instruction.arg])})`;
      else if (instruction.op === 'CLOSURE') arg = `#${instruction.arg.id} ${instruction.arg.name}`;
      else if (instruction.op === 'LOAD' || instruction.op === 'STORE') arg = `${instruction.arg.name} @ ${instruction.arg.depth}:${instruction.arg.slot}`;
      else if (instruction.op === 'ENTER') arg = instruction.arg.names.map((name, i) => `${name}: ${typeName(instruction.arg.types[i])}`).join(', ');
      else if (instruction.arg !== null) arg = typeof instruction.arg === 'object' ? JSON.stringify(instruction.arg) : String(instruction.arg);
      lines.push(`  ${String(i).padStart(4, '0')}  L${String(instruction.span.line).padEnd(4)} ${instruction.op.padEnd(12)} ${arg}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}
