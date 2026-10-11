import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { upgradeHelloBrand } from '../src/branding.js';

const hello = readFileSync(new URL('../examples/hello.itou', import.meta.url), 'utf8');
const previous = `// 中文型別、識別字與喵內建。
字串 問候 = "你好，itouLang！";
喵out << 問候 << 喵endl;
喵out << "字元數： " << 喵長(問候) << 喵endl;
喵out << "6 × 7 = " << 6 * 7 << 喵endl;
喵驗(喵型(問候) == "string");`;

const normalize = text => text.replace(/\r\n/g, '\n').trim();
test('played-out former hello example is rebranded in place', () => {
  assert.equal(normalize(upgradeHelloBrand(previous)), normalize(hello));
  assert.equal(normalize(upgradeHelloBrand(previous.replaceAll('\n', '\r\n'))), normalize(hello));
  assert.equal(upgradeHelloBrand(hello), hello);
});

test('arbitrary programs are never rewritten, including the old greeting string alone', () => {
  for (const source of [
    '喵out << "你好，itouLang！";',
    previous + '\n喵out << 42;',
    '字串 問候 = "你好，itouLang！";\n喵out << 問候;',
    '',
  ]) assert.equal(upgradeHelloBrand(source), source);
});
