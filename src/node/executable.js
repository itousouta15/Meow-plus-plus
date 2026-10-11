import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function executable() {
  if (process.env.ITOU_BINARY) return process.env.ITOU_BINARY;
  const names = process.platform === 'win32' ? ['build/Release/itou.exe', 'build/itou.exe'] : ['build/itou'];
  for (const name of names) {
    const path = fileURLToPath(new URL(`../../${name}`, import.meta.url));
    if (existsSync(path)) return path;
  }
  throw new Error('找不到喵++ C++ 核心。請先執行 npm run build，或設定 ITOU_BINARY。');
}
