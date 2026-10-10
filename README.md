# itouLang

一個可以實際執行、編譯與除錯的小型程式語言。**0.2.0** 包含手寫 lexer / parser、詞法作用域解析、漸進式型別檢查、tree-walk 直譯器、stack-based bytecode VM，以及瀏覽器 playground／除錯器。

執行核心使用原生 JavaScript ES modules，沒有 runtime 套件依賴；相同核心可跑在 Node.js 和瀏覽器。Playwright 是唯一的開發相依套件。

## 立即開始

需求：Node.js 22+。

```sh
# CLI 不需要 npm install
node bin/itou.mjs examples/hello.itou
node bin/itou.mjs --engine tree examples/closures.itou
node bin/itou.mjs --disassemble examples/fibonacci.itou
node bin/itou.mjs --check examples/loops.itou
node bin/itou.mjs --check --json examples/typed.itou
node bin/itou.mjs examples/typed.itou

# 開啟瀏覽器 playground（同樣不需要安裝套件）
npm start
```

瀏覽 <http://127.0.0.1:8788>。伺服器只提供靜態檔案；使用者程式在瀏覽器的獨立 Worker 中執行。可用 `PORT` 環境變數換連接埠。

## 一小段語言

中文關鍵字、型別註記與「喵」內建可以混著用，兩個引擎輸出相同：

```text
函式 計數器(起始: 數字): 函式(數字) -> 數字 {
  令 值: 數字 = 起始;
  回傳 函式(增加: 數字): 數字 {
    值 = 值 + 增加;
    回傳 值;
  };
}

令 數 = 計數器(10);
喵(數(1));                        // 11
喵(數(5));                        // 16

令 i = 0;
當 (i < 5) {
  i = i + 1;
  若 (i == 3) { 繼續; }           // 跳過 3
  喵(喵重複("喵", i));            // 喵 / 喵喵 / 喵喵喵喵 / 喵喵喵喵喵
}

喵("完成：", 喵選(數(0) > 20, "大隻貓", "小隻貓"));  // 完成： 小隻貓
```

英文關鍵字完全等價，可自由混用：`let`＝`令`、`fn`＝`函式`、`if`＝`如果`、`else`＝`否則`、`while`＝`當`、`return`＝`回傳`、`break`＝`中斷`、`continue`＝`繼續`、`and`／`or`＝`且`／`或`、`true`／`false`／`null`＝`真`／`假`／`空`；型別另有 `數字`、`字串`、`布林`、`任意`。

### 已實作

- `let`、賦值、區塊、`if/else`、`while`、`break/continue`、`return`。
- 具名函式、匿名函式、遞迴、互相遞迴、first-class functions、可修改捕獲變數的閉包。
- number / string / boolean / null，嚴格執行期型別檢查，不做隱式型別轉換。
- 可選的 `: number` / `: string` / `: boolean` / `: null` / `: any` 註記，以及結構式 `fn(number) -> number` 型別。
- 靜態檢查初始化、賦值、參數、回傳值、運算子與 return 控制流程；`any` 邊界另有執行期檢查。
- 四則運算、餘數、比較、相等判斷、短路 `and/or`。
- `print`、`len`、`str`、`number`、`type`、`sqrt`、`assert`，以及一整組「喵」內建：`喵`（`print` 別名）、`喵喵`（加喵前綴輸出）、`喵長`／`喵字`／`喵數`／`喵型`／`喵根`／`喵驗`（對應英文別名）、`喵黏`（串接）、`喵重複`（重複字串）、`喵選`（三元運算）、`喵叫`。
- 英文與中文關鍵字可混用：`令`＝`let`、`函式`＝`fn`、`如果`＝`if`、`當`＝`while`、`回傳`＝`return`、`喵` 輸出。識別字也接受中文。
- 行註解、可巢狀區塊註解、JSON 風格字串 escape、Unicode 字串。
- 靜態名稱解析：未宣告變數、重複 binding、不合法的 return/break/continue。
- 原始碼 offset、行／列位置、錯誤摘要與函式呼叫堆疊。

完整語法見 [docs/LANGUAGE.md](docs/LANGUAGE.md)，型別規則見 [docs/TYPES.md](docs/TYPES.md)。程式含任何型別註記時，自動在執行前檢查整份程式；未註記的變數／參數保留 `any`，原有無註記程式採動態語意。可用 `--check` 明確檢查任何程式。

## Playground／除錯器

- 切換 **Tree interpreter / Bytecode VM**，執行相同原始碼。
- 「檢查型別」顯示 binding／函式簽章；`typed.itou` 示範高階函式與帶註記的 closure。
- 查看所有函式的 bytecode、constant pool 參照與詞法位址。
- 點行號設定中斷點，開始除錯後可「下一行」、「單步指令」、「繼續」。
- 即時檢查函式堆疊、區域／外層作用域、捕獲變數與 operand stack。
- Ctrl / Cmd + Enter：執行；F8：開始／繼續除錯；F10：下一行；編輯器內 F9：切換當前行中斷點。
- 保存原始碼及明暗主題到此瀏覽器，下載 `.itou`，支援手機尺寸。
- 「停止」會終止 Worker；重新執行建立新 Worker。修改程式也會結束舊的除錯狀態。

除錯器使用 VM。中斷點依行號儲存；修改前面的行數後，請重新確認中斷點位置。單步規則為遇到行號變更、函式進出或往回跳躍就停下，因此同一行的迴圈也能逐步觀察。

## CLI

```sh
node bin/itou.mjs [--engine vm|tree] [--max-steps N] [--json] file.itou
node bin/itou.mjs --check file.itou
node bin/itou.mjs --disassemble file.itou
node bin/itou.mjs --no-typecheck file.itou
```

檔名 `-` 代表從 stdin 讀取。`--json` 輸出結果、全域變數與步數；發生錯誤時包含 structured diagnostic 及錯誤前的輸出。成功回傳 0，程式／I/O 錯誤回傳 1，CLI 參數錯誤回傳 64。

`--check` 執行名稱解析與靜態型別檢查，`--check --json` 回傳型別報告。`--no-typecheck` 只跳過靜態檢查；明確註記的初始化、賦值、參數與回傳值仍會在執行期檢查。高階函式透過 wrapper 檢查後續呼叫，不能藉由 `any` 擦掉既有 contract。

預設上限：1,000,000 execution steps、100 層函式呼叫、100,000 code units 輸出、65,536 code units 單一字串、256 Ki code units 原始碼。VM 的 instruction step 與直譯器的 AST step 單位不同，不能直接拿步數判斷哪個引擎較快。

## 嵌入其他程式

```js
import { run, check, compile, VM } from './src/index.js';

const result = run('print(6 * 7);', { engine: 'vm' });
console.log(result.output); // ['42']
console.log(check('let n: number = 42;').globals); // [{ name: 'n', type: 'number' }]

const vm = new VM(compile('let n = 1; print(n + 2);'));
vm.step();
console.log(vm.snapshot());
vm.run();
```

`run()` 拋出 `LangError`；`error.toJSON()` 提供 phase、message、span、frames。公開 compiler／VM API 預期使用由本套 parser/resolver 產生的 AST／bytecode，沒有對外部手造 bytecode 的驗證器。

## 測試

```sh
npm test
npm run check

# 安裝開發相依套件與 Chromium 後驗證真實瀏覽器
npm ci
npx playwright install chromium --no-shell
npm run test:browser
```

測試涵蓋：

- 語意、錯誤位置、閉包、互相遞迴、宣告前存取、short-circuit、巢狀 break/continue。
- **500 個固定 seed 的生成程式**：比較兩個引擎的 stdout 與最終全域變數。
- **200 個帶型別註記的生成程式**，以及靜態診斷、高階函式 contract、`any` 邊界與 return 分析。
- 300 個生成的 malformed sources：必須回傳語言診斷，避免洩漏 JavaScript stack overflow 等內部錯誤。
- fuel、遞迴、字串與輸出上限；CLI 真實程序；靜態伺服器路徑範圍。
- 桌面與手機 Chromium：Worker 執行、範例、bytecode、breakpoint、單步與變數、錯誤、儲存、明暗主題、停止後重啟。

兩個引擎的**控制流程與執行堆疊是分開實作**，frontend、type checker、primitive operations、contracts 與 built-ins 則共用。差異測試特別用來抓 compiler／VM 的 scope、stack、jump 與 contract 傳遞問題；共用部分另外用規格導向案例驗證。

## Benchmark 與架構

```sh
npm run bench
npm run bench:types
```

包含解析／編譯的端到端微型測量，先 warm-up，再比較同一段加總程式的 10 次樣本，輸出 JSON。瀏覽器顯示的時間還包含 Worker 啟動／通訊，與 CLI benchmark 不同。

`bench:types` 另外比較 dynamic／annotated 版本在兩個引擎上的 20 次樣本，包含 frontend 與 runtime contracts；不把型別檢查成本假設為零。

本次驗收結果、實測數據與測量限制見 [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md)。

```text
Source → Lexer → Parser → AST → Resolver → Optional type checker
                                            ├─ Tree interpreter + contracts
                                            └─ Compiler → VM + contracts → Debug snapshots
```

關閉頁面或釋放執行個體後，由 JavaScript GC 回收 environments／closures；本版沒有自製 GC、JIT、native code generation 或 host FFI。語言程式無法直接呼叫 JavaScript、檔案或網路 API；這是語言能力限制，不能取代部署不可信程式時的 OS 隔離。架構細節見 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

後續可以加入型別推論、union／generic types、陣列與資料型別、LSP、bytecode verifier，再把 CLI runner 接到 itouOJ。

MIT License.
