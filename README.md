# itouLang

**0.3.0：中文語法、C++ 風格結構、C++17 執行核心與 WebAssembly 遊樂場。**

itouLang 是一個可以用中文撰寫、執行、編譯與單步除錯的小型語言。詞法分析器、語法分析器、名稱解析、漸進式型別檢查、語法樹直譯器、位元組碼編譯器與虛擬機都由 C++ 實作；CLI 執行原生程式，瀏覽器 Worker 執行同一份核心編譯出的 WebAssembly。

## 一小段程式

```cpp
整數 平方(整數 數值) {
  回傳 數值 * 數值;
}

整數 主程式() {
  整數 總和 = 0;
  迴圈 (整數 索引 = 1; 索引 <= 5; ++索引) {
    如果 (索引 == 3) 繼續;
    總和 += 平方(索引);
  }
  布林 完成 = 總和 > 0 且 總和 < 100;
  如果 (完成) 喵out << "平方和： " << 總和 << 喵endl;  // 平方和： 46
  回傳 0;
}
```

型別寫在變數、參數與函式名稱前面。支援 `迴圈`、`++`／`--`、`+=` 等複合賦值、`且`／`或`，以及 `函式<整數(整數)>` 與 `[&](整數 數值) -> 整數 { ... }` 閉包。頂層的型別前置 `主程式()` 在全域初始化完成後自動執行；沒有主程式的程式仍可直接寫頂層敘述。

### 中文寫法

| 中文 | 等價英文／符號 | 用途 |
| --- | --- | --- |
| `整數`、`浮點數`、`小數`、`數字` | `int`、`double`、`float`、`number` | 數值型別 |
| `字串`、`布林` | `string`、`bool` | 文字與布林型別 |
| `自動`、`任意` | `auto`、`any` | 漸進式動態型別 |
| `無值`、`空` | `void`、`null` | 無回傳值／空值型別 |
| `主程式` | `main` | 自動呼叫的入口 |
| `迴圈`、`當` | `for`、`while` | 迴圈 |
| `如果`、`否則` | `if`、`else` | 條件分支 |
| `回傳`、`中斷`、`繼續` | `return`、`break`、`continue` | 控制流程 |
| `真`、`假`、`且`、`或` | `true`、`false`、`&&`、`||` | 布林值與邏輯運算 |
| `函式<整數(整數)>` | `function<int(int)>` | 結構式函式型別 |
| `喵in`、`喵out` | `cin`、`cout` | 串流輸入／輸出 |
| `喵err`、`喵log` | `cerr`、`clog` | 標準錯誤／紀錄輸出 |
| `喵endl`、`喵getline` | `endl`、`getline` | 換行／整行輸入 |

### 喵串流輸入輸出

```text
整數 主程式() {
  整數 左邊;
  整數 右邊;
  喵in >> 左邊 >> 右邊;
  喵out << "總和：" << 左邊 + 右邊 << 喵endl;
  喵log << "讀取完成" << 喵endl;
  回傳 0;
}
```

輸入 `3 4`，標準輸出為 `總和：7`，標準錯誤輸出為 `讀取完成`。
`喵out <<` 不會自動加空白或換行；空白寫在字串裡，換行使用 `喵endl`。
`喵err`／`喵log` 都寫到標準錯誤，不會混進標準輸出。

`喵in >>` 依目標的宣告型別讀入數字、字串或布林值；`自動`／`任意` 接收字串。
`喵getline(喵in, 文字);` 讀取剩餘的一整行並保留空白。輸入不足或內容不符合型別時會回報語言錯誤。
型別前置的基本變數可省略初始值：數字預設為 `0`、字串為 `""`、布林為 `假`、空值為 `空`；`自動` 與函式型別仍須給初始值。

CLI 檔案模式從重導向的標準輸入讀取；遊樂場使用「標準輸入」欄位。完整示範見 [examples/streams.itou](examples/streams.itou)。

目前的數值模型仍是有限的 binary64：`整數`、`浮點數`、`小數` 都對應 `number`，所以 `5 / 2` 是 `2.5`。`自動` 對應漸進式的 `any`，尚未做 C++ 的型別推論。這是 C++ 風格的小型語言，尚未支援類別、指標、標頭檔或 C++ 標準函式庫。

## 建置與執行

需求：**CMake 3.20+、C++17 編譯器**。Node.js 22+ 用於建置腳本、JavaScript API 和 playground 伺服器。第一次 CMake configure 會下載固定版本的 [nlohmann/json 3.11.3](https://github.com/nlohmann/json)，用於 AST、bytecode 與 host protocol。

```sh
npm run build
node bin/itou.mjs examples/cpp.itou
node bin/itou.mjs --engine tree examples/closures.itou
node bin/itou.mjs --check examples/typed.itou
node bin/itou.mjs --disassemble examples/fibonacci.itou
```

也可直接使用原生 CLI，不需要 Node.js：

```sh
# Linux / macOS
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
./build/itou examples/cpp.itou

# Windows / Visual Studio
cmake -S . -B build
cmake --build build --config Release
build\Release\itou.exe examples/cpp.itou
```

Windows 的 npm 建置腳本也會尋找 Visual Studio 附帶的 CMake。可用 `CMAKE` 指定 CMake 執行檔，`ITOU_BINARY` 指定 host API／Node launcher 使用的原生 CLI。

### 瀏覽器遊樂場

安裝並啟用 [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)（已驗證 4.0.23）與 Ninja 後：

```sh
# 在已載入 emsdk_env 的 shell 中
npm run build:wasm
npm start
```

瀏覽 <http://127.0.0.1:8788>。`web/native/itou.js` 與 `itou.wasm` 是建置產物，不納入 Git；在新 checkout 或重新編譯核心後需重建。可用 `NINJA` 指定 Ninja 執行檔，`PORT` 設定伺服器連接埠。

瀏覽器需支援 WebAssembly exception handling；已以桌面與手機 Chromium 驗證。

- 切換 C++ 的語法樹直譯器／位元組碼虛擬機。
- 中文型別報告、所有函式的位元組碼與詞法位址。
- 標準輸入測資欄位；標準輸出與標準錯誤分開顯示。
- 點行號設中斷點；下一行、單步指令、繼續。
- 檢查呼叫堆疊、區域／捕獲變數與運算元堆疊。
- Ctrl／Cmd + Enter 執行，F8 開始／繼續，F10 下一行，F9 切換中斷點。
- 保留原始碼、明暗主題、下載 `.itou`，支援手機。
- 停止會終止 Worker，下一次執行建立新的 WebAssembly instance。

伺服器只提供靜態檔案；程式在瀏覽器 Worker 中執行。除錯器使用 VM，中斷點以行號保存。

## 語言能力

- 型別前置宣告、區塊、`如果/否則`、`當`、`迴圈`、`回傳`、`中斷/繼續`。
- 具名函式、遞迴／互相遞迴、高階函式，以及可修改捕獲變數的閉包。
- 數字／字串／布林／空值；初始化、賦值、參數與回傳值的靜態及執行期檢查。
- 結構式函式型別、`任意` 邊界、高階函式契約與回傳控制流程分析。
- 四則運算、餘數、比較、嚴格相等、短路邏輯與 prefix／postfix 更新。
- `喵in`／`喵out` 串流，以及 `喵長`、`喵字`、`喵數`、`喵型`、`喵根`、`喵驗` 等內建。
- 標準輸入：`讀行()`、`讀()`／`喵吃()`、`讀數()`。
- 中文識別字、中文關鍵字、行註解、巢狀區塊註解、JSON 字串 escape。
- UTF-16 原始碼位置、錯誤摘要、函式呼叫堆疊、執行步數與資源上限。

英文寫法與原有 `令 數值: 數字 = 1;`、`函式 加上(數值: 數字): 數字 { ... }` 可混用。完整語法見 [docs/LANGUAGE.md](docs/LANGUAGE.md)，型別規則見 [docs/TYPES.md](docs/TYPES.md)。

## CLI

```sh
itou [--engine vm|tree] [--max-steps N] [--json] file.itou
itou --check file.itou
itou --disassemble file.itou
itou --no-typecheck file.itou
```

`itou` 代表原生執行檔，也可換成 `node bin/itou.mjs`。檔名 `-` 從標準輸入讀取程式；檔案模式將重導向的標準輸入提供給輸入內建。`--json` 回傳結果或結構化診斷，保留錯誤前的輸出。成功回傳 0，程式／I/O 錯誤回傳 1，參數錯誤回傳 64；主程式的值目前不作為程序結束代碼。

`--check` 不執行程式。`--no-typecheck` 只跳過靜態 pass，明確型別的 runtime contracts 仍生效。

預設上限：1,000,000 execution steps、100 層呼叫、100,000 UTF-16 code units 輸出、65,536 code units 單一字串、256 Ki code units 原始碼。Tree 的 AST step 與 VM 的 instruction step 是不同單位。

## JavaScript host API

```js
import { run, check, compile, VM } from './src/index.js';

console.log(run('整數 數值 = 6; 喵out << 數值 * 7;').stdout); // '42'
console.log(check('整數 數值 = 42;').globals); // [{ name: '數值', type: 'number' }]

const vm = new VM(compile('整數 數值 = 1; 喵out << ++數值;'));
try {
  vm.step();
  console.log(vm.snapshot());
  vm.run();
} finally {
  vm.dispose();
}
```

公開 API 保持同步。Node.js 透過背景 Worker 與持續運作的原生核心交換 JSON；瀏覽器模組初始化時載入 WebAssembly，之後同步呼叫 C++。`run()` 的 `onOutput` 在此次執行回傳時依序通知，錯誤前的輸出也會通知。`LangError.toJSON()` 提供 phase、message、span、frames。`VM.dispose()` 可立即釋放原生除錯 session。

執行結果與 VM 快照另提供 `stdout`／`stderr` 原始字串，保留精確的空白與換行；`output` 是標準輸出的文字紀錄，串流以換行分筆，`喵()`／`print()` 每次呼叫為一筆。串流最後一段沒有換行的文字，在結束或錯誤時也會加入 `output`。`LangError.stdout`／`.stderr` 保留錯誤前的串流文字。

API、JSON 與 `喵型()` 使用 `number`、`string` 等標準型別名稱，遊樂場的型別報告與除錯器則顯示「數字」、「字串」等中文名稱。

AST／bytecode API 預期使用本套 parser、resolver、compiler 產生的資料。架構詳見 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 測試

```sh
npm run build
npm test
npm run check

# 建置 WebAssembly 後
npm ci
npx playwright install chromium --no-shell
npm run test:browser
```

測試涵蓋語意與診斷、700 個固定 seed 生成程式、300 個 malformed sources、型別契約、原生 CLI、靜態伺服器、C++ 語法及獨立 JavaScript reference 的 frontend／bytecode 比較，另有桌面／手機 Chromium 的 WebAssembly 與除錯器驗證。CI 建置 Windows／Ubuntu 原生版與 Ubuntu WebAssembly 版。

`npm run bench` 與 `npm run bench:types` 現在量測 C++ 核心連同 Node host 通訊的端到端時間；[docs/EXPERIMENTS.md](docs/EXPERIMENTS.md) 的 0.1／0.2 數據是舊 JavaScript 核心的歷史紀錄。

MIT License.
