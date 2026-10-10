#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { run, check as checkTypes, compile, disassemble, LangError, formatDiagnostic } from '../src/index.js';

const usage = `itouLang 0.2.0
用法：node bin/itou.mjs [選項] <檔案.itou | ->
  --engine vm|tree     執行引擎（預設：vm）
  --check              只做名稱解析與靜態型別檢查，不執行
  --no-typecheck       略過靜態檢查（執行期契約仍會生效）
  --disassemble        輸出帶原始碼位置的 bytecode
  --json               以 JSON 輸出結果或診斷
  --max-steps N        執行步數上限（預設：1000000）
  --help               顯示本說明
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
        if (!['vm', 'tree'].includes(engine)) throw new Error('--engine 必須是 vm 或 tree');
      } else if (arg === '--max-steps') {
        const text = args[++i] ?? '';
        maxSteps = Number(text);
        if (!/^\d+$/.test(text) || !Number.isSafeInteger(maxSteps) || maxSteps < 1)
          throw new Error('--max-steps 必須是正的安全整數');
      } else if (arg === '--check') check = true;
      else if (arg === '--no-typecheck') typecheck = false;
      else if (arg === '--disassemble') assembly = true;
      else if (arg === '--json') json = true;
      else if (arg.startsWith('-') && arg !== '-') throw new Error(`未知的選項 ${arg}`);
      else if (filename !== undefined) throw new Error('只接受一個輸入檔案');
      else filename = arg;
    }
    if (filename === undefined) throw new Error('缺少輸入檔案');
    if (check && assembly) throw new Error('--check 與 --disassemble 不能併用');
    if (check && typecheck === false) throw new Error('--check 與 --no-typecheck 不能併用');
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
