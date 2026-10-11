# 漸進式型別系統（0.3.0）

## 寫法

```text
整數 次數 = 0;
字串 標題 = "itouLang";
布林 啟用 = 真;
空 沒有 = 空;
自動 動態 = "可以在執行期再確認";

整數 加上(整數 左邊, 整數 右邊) {
  回傳 左邊 + 右邊;
}

函式<整數(整數, 整數)> 操作 = 加上;
喵(操作(1, 2));
```

型別支援 `number`、`string`、`boolean`、`null`、`any`，以及可巢狀的結構式
function types。函式型別只看參數／結果型別，不看參數名稱。沒有 union、泛型、
使用者定義 type alias 或 nominal types。

中文拼法的 `整數`／`小數`／`浮點數` 對應 `int`／`float`／`double`，都是 `number`
別名；`布林` 是 `boolean`，`無值`／`空` 是 `null`，`自動`／`任意` 是 `any`。
`函式<整數(整數)>`、`function<int(int)>` 與 `函式(數字) -> 數字` 等價，
不代表實作了 C++ template。API 型別報告使用標準名稱，遊樂場將名稱顯示為中文。
目前 `自動` 不推論初始值型別，仍可改存其他型別；明確的 `整數` 等型別則有契約。
原有冒號註記與 `fn` 寫法仍可使用。

型別前置的基本宣告可省略初始值，使用各型別的預設值；`自動`／`任意` 與函式型別
仍需初始值。`喵in >> 目標;` 依宣告型別讀入數字、字串或布林，任意型別讀入字串。
`喵getline(喵in, 目標);` 只接受字串或任意型別。兩種輸入都禁止修改內建函式、
尚未初始化的變數，或將輸入寫入函式／空值型別。輸出串流沿用內建的值顯示規則。

## 什麼時候檢查

- 程式含任何註記（含明確的 `any`），預設在執行任何副作用前檢查整份程式。
- 無註記程式保留原有動態執行語意。
- CLI `--check` / playground「檢查型別」會明確檢查任意來源，但不執行它。
- Host API：`check(source)` 回傳 globals／functions 型別報告；
  `run(source, {typecheck: true})` 強制檢查。
- `--no-typecheck` / `{typecheck:false}` 跳過靜態 pass，**明確註記的 runtime
  contracts 仍然生效**。名稱解析、操作碼型別限制與資源上限也仍然存在。

未註記的 let、參數、回傳型別是 `any`。此版本刻意沒有從 let initializer 推論
一個不可再改變的型別，所以 `let x = 1; x = "text";` 仍合法。Named function
declarations 則有已知 arity／signature；在經過 type checker 的程式中，重新
賦值給這種 binding 也會保留 callable contract。

## 靜態規則

- 初始化／賦值需與宣告型別相容。
- 函式呼叫檢查 arity、參數型別與結果型別；built-ins 也有簽章。
- 比較、算術、布林運算與條件使用語言原本的嚴格型別限制。
- `+` 接受兩個 number 或兩個 string；混合已知型別會報錯。
- 函式型別採參數逆變、結果協變；`any` 允許漸進式相容，交由 runtime 邊界補上檢查。
- 所有原始碼都會檢查，包括 unreachable statements。
- 沒有數值常數折疊、資料流式 narrowing 或完整型別推論。除以零仍是執行期錯誤。

錯誤 phase 為 `type`，附來源位置。例如：

```text
喵("這行不會執行");
整數 數值 = "錯誤";
```

預設會在執行前報出 initializer 型別不相容，因此前面的 print 也不會發生。

## Return 控制流程

有明確非 null／非 any 結果的函式，正常離開時必須有相容的 return：

```text
整數 選擇(布林 條件) {
  如果 (條件) 回傳 1;
  否則 回傳 2;
}
```

分析會追蹤 normal completion、break、continue；巢狀迴圈消耗自己的 break。
字面 `true` 迴圈若沒有可到達的 break，可視為不會 fall through。其他迴圈採保守
判斷；不會把 `while (!false)` 當成經過常數折疊的無限迴圈。Return 後不可到達的
break 不會使無限迴圈誤判為可離開，但該段原始碼仍須通過型別檢查。

`: null` 可以隱式 return null，`: any` 也允許。這不是終止性證明；遞迴／無限
迴圈仍受 execution budget 和 call-depth limit 控制。

## `any` 邊界與執行期契約

靜態階段允許 `any` 指派給已知型別，執行時必須檢查實際值：

```text
自動 動態 = "錯誤";
整數 已檢查 = 動態; // 靜態可通過，執行到這裡會失敗
```

初始化、賦值、函式參數及回傳都套用契約。錯誤 phase 為 `runtime`，訊息以
`type contract:` 標示。關閉靜態 pass 也不會讓 `number` cell 保存 string。

### 高階函式

函式回傳型別不能只靠「這是一個 function」就保證。因此將動態函式放進
`fn(number) -> number` 時，runtime 會建立透明 wrapper：

```text
自動 動態 = [&](自動 數值) { 回傳 "錯誤"; };
函式<整數(整數)> 已檢查 = 動態;
已檢查(1); // 參數通過，回傳值觸發執行期契約錯誤
```

Wrapper 會在之後每次呼叫檢查參數，再在回傳時檢查結果；函式參數／結果本身也
可以是函式，因此這個機制會保護 callback 與回傳的 closure。透過 assignment
expression 取得函式時，也會回傳經過 guard 的值。

- 轉成 `any` 不會擦掉已建立的 function contract。
- `==` 比較底層函式 identity，不因多一層 wrapper 改變結果。
- Call stack 顯示實際函式名稱，不增加假的 wrapper frame。
- 重複套用相同最外層契約會重用 wrapper；混合契約鏈最多 64 層，超過回報 `limit`。
- Variadic built-in 可適配固定 arity 的函式型別；呼叫與結果仍受固定契約檢查。

## 實作位置

| 檔案 | 職責 |
| --- | --- |
| `native/src/checker.cpp` | Type representation、signatures、assignability、AST type pass、return flow |
| `native/src/frontend.cpp` | Parser／resolver，記錄各 scope slot 的 annotation metadata |
| `native/src/runtime.cpp` | Cell guards、call/return guards、function wrappers |
| `native/src/interpreter.cpp` / `native/src/vm.cpp` | 在各自的執行路徑保留 guards 與來源位置 |
| `src/reference.js` 與對應 JS modules | 獨立 JavaScript reference，供差異驗證 |
| `test/types.test.mjs` | 靜態／動態邊界、控制流程、高階函式與 200 個生成程式 |

Compiler 把型別資訊放在 function prototype 與 ENTER scope metadata。INIT、STORE、
CALL、RETURN 在 runtime 執行檢查，不另引入供任意外部 bytecode 使用的 verifier。
