import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const wasm = process.argv.includes('--wasm');
function cmake() {
  if (process.env.CMAKE) return process.env.CMAKE;
  if (spawnSync('cmake', ['--version']).status === 0) return 'cmake';
  if (process.platform === 'win32') {
    const base = join(process.env.ProgramFiles ?? 'C:/Program Files', 'Microsoft Visual Studio');
    if (existsSync(base)) for (const version of readdirSync(base).sort().reverse()) {
      for (const edition of ['Community', 'Professional', 'Enterprise', 'BuildTools']) {
        const path = join(base, version, edition, 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe');
        if (existsSync(path)) return path;
      }
    }
  }
  throw new Error('找不到 CMake。請安裝 CMake 3.20+ 與 C++17 編譯器，或設定 CMAKE。');
}
function execute(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && /\.(bat|cmd)$/.test(command) });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const tool = cmake();
const directory = wasm ? 'build-wasm' : 'build';
const configure = ['-S', '.', '-B', directory];
if (wasm || process.platform !== 'win32') configure.push('-DCMAKE_BUILD_TYPE=Release');
if (wasm) {
  if (!process.env.EMSDK) throw new Error('請先啟用 Emscripten SDK（emsdk_env），再執行 npm run build:wasm。');
  configure.push('-G', 'Ninja', `-DCMAKE_TOOLCHAIN_FILE=${join(process.env.EMSDK, 'upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake')}`);
  if (process.env.NINJA) configure.push(`-DCMAKE_MAKE_PROGRAM=${process.env.NINJA}`);
  else if (process.platform === 'win32') {
    const bundled = join(tool, '../../..', 'Ninja/ninja.exe');
    if (existsSync(bundled)) configure.push(`-DCMAKE_MAKE_PROGRAM=${bundled}`);
  }
}
execute(tool, configure);
execute(tool, ['--build', directory, '--config', 'Release', '--parallel']);
