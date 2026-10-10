#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { run, check as checkTypes, compile, disassemble, LangError, formatDiagnostic } from '../src/index.js';

const usage = `itouLang 0.2.0
Usage: node bin/itou.mjs [options] <file.itou | ->
  --engine vm|tree     Execution engine (default: vm)
  --check              Resolve and statically type-check without executing
  --no-typecheck       Skip static checking (runtime contracts still apply)
  --disassemble        Print bytecode with source locations
  --json               Structured result or diagnostic
  --max-steps N        Execution fuel (default: 1000000)
  --help               Show this help
`;

function main(args) {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage); return 0;
  }
  let filename, engine = 'vm', maxSteps = 1000000, check = false, assembly = false, json = false, typecheck;
  try {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--engine') {
        engine = args[++i];
        if (!['vm', 'tree'].includes(engine)) throw new Error('--engine must be vm or tree');
      } else if (arg === '--max-steps') {
        const text = args[++i] ?? '';
        maxSteps = Number(text);
        if (!/^\d+$/.test(text) || !Number.isSafeInteger(maxSteps) || maxSteps < 1)
          throw new Error('--max-steps must be a positive safe integer');
      } else if (arg === '--check') check = true;
      else if (arg === '--no-typecheck') typecheck = false;
      else if (arg === '--disassemble') assembly = true;
      else if (arg === '--json') json = true;
      else if (arg.startsWith('-') && arg !== '-') throw new Error(`unknown option ${arg}`);
      else if (filename !== undefined) throw new Error('expected exactly one input file');
      else filename = arg;
    }
    if (filename === undefined) throw new Error('missing input file');
    if (check && assembly) throw new Error('--check and --disassemble cannot be combined');
    if (check && typecheck === false) throw new Error('--check and --no-typecheck cannot be combined');
  } catch (error) { process.stderr.write(`${error.message}\n${usage}`); return 64; }

  let source;
  const output = [];
  try {
    source = readFileSync(filename === '-' ? 0 : filename, 'utf8');
    let result;
    if (check) result = checkTypes(source);
    else if (assembly) result = { bytecode: disassemble(compile(source, { typecheck })) };
    else result = run(source, {
      engine, maxSteps, typecheck,
      onOutput: text => { output.push(text); if (!json) process.stdout.write(`${text}\n`); },
    });
    if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (assembly) process.stdout.write(`${result.bytecode}\n`);
    else if (check) process.stdout.write('OK\n');
    return 0;
  } catch (error) {
    if (json) process.stdout.write(`${JSON.stringify({ error: error instanceof LangError ? error.toJSON() : { phase: 'io', message: error.message }, output })}\n`);
    else process.stderr.write(`${error instanceof LangError ? formatDiagnostic(error, source, filename) : error.message}\n`);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
