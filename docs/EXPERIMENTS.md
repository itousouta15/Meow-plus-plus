# 驗收與效能紀錄

## 0.2.0：漸進式型別系統驗收（2026-10-10）

- 核心、CLI、server、型別系統測試合計 **108 項通過**。
- 差異測試包含 **500 個既有生成程式 + 200 個帶型別註記的生成程式**，比對兩個引擎的輸出與 globals。
- 型別案例涵蓋函式簽章、return 控制流程、`any` 邊界、高階函式參數／結果、assignment expression、wrapper identity、contract 深度限制，以及關閉靜態 pass 後仍保留 runtime guards。
- 真實 Chromium **18 項桌面／手機測試通過**；新增 type report、typed 範例與副作用發生前的靜態診斷。調整手機工具列後另重跑桌面／手機版面案例，兩者通過。
- **24 個 JavaScript modules** 完成語法檢查；新增 benchmark 腳本也已實際執行。

兩個引擎共用 type checker 與 primitive contracts。這些共用邏輯以明確的規格案例驗證；差異測試特別驗證兩條執行路徑有沒有遺失或錯置 guard。

### Dynamic / annotated 配對 benchmark

```sh
npm run bench:types
```

Windows x64、Intel Core i5-12450HX、Node.js v24.16.0。同樣以函式迴圈加總 0..4999，
每次驗證輸出 12,497,500。每個引擎／模式各 warm-up 5 次，再交錯量測 20 對；
每一對交換先跑 dynamic 或 annotated，減少固定執行順序帶來的 host-JIT 暖機偏差。
每個樣本包含 frontend、執行及結果整理。

| 引擎 | 模式 | Median | p95 | Steps |
| --- | --- | --- | --- | --- |
| Tree | dynamic | 3.47395 ms | 5.7900 ms | 70,017 |
| Tree | annotated | 3.71700 ms | 6.0655 ms | 70,017 |
| VM | dynamic | 2.44635 ms | 4.6850 ms | 85,019 |
| VM | annotated | 3.81260 ms | 5.1385 ms | 85,019 |

此 workload 的 annotated 模式有可量測成本；差值同時包含更大的 frontend、靜態
pass 與 runtime guards，不能當成單一階段的純開銷。這是開發機小樣本，JIT、GC
及背景負載仍可能影響結果。相同 steps 也不代表相同 CPU 工作量。

```json
{
  "node": "v24.16.0", "platform": "win32", "includes_frontend": true,
  "sample_order": "alternating-pairs", "warmup_runs_per_mode": 5,
  "results": [
    {"engine":"tree","mode":"dynamic","samples":20,"median_ms":3.4739499999999737,"p95_ms":5.789999999999992,"steps":70017},
    {"engine":"tree","mode":"annotated","samples":20,"median_ms":3.7169999999999987,"p95_ms":6.065500000000014,"steps":70017},
    {"engine":"vm","mode":"dynamic","samples":20,"median_ms":2.4463499999999954,"p95_ms":4.685000000000002,"steps":85019},
    {"engine":"vm","mode":"annotated","samples":20,"median_ms":3.8126000000000317,"p95_ms":5.138500000000022,"steps":85019}
  ]
}
```

## 0.1.0 歷史基線

日期：2026-10-10。版本：itouLang 0.1.0。

## 驗收

- 核心、CLI、server 測試合計 **65 項通過**。
- 差異測試在其中一個 test case 執行 **500 個固定 seed 生成程式**，比較 tree interpreter 與 VM 的 stdout／globals。
- 另有 **300 個 malformed sources**，比對語言診斷，檢查是否洩漏宿主 runtime 錯誤。
- 真實 Chromium **14 項瀏覽器測試通過**：桌面 1440×1040、手機 390×844，各 7 項。
- 瀏覽器驗證包含實際 Worker、兩個引擎、closure、bytecode、中斷點、單步與變數、錯誤、local storage、明暗主題、停止後再執行，以及延遲範例回應不覆蓋使用者新編輯。
- 20 個 JavaScript modules 通過 `node --check`。Playwright 固定為 1.64.0。

差異測試共用 lexer／parser／resolver／primitive operations，所以不能用這 500 個案例證明共用部分沒有問題。手寫規格案例另外檢查型別、初始化、scope、錯誤位置等語意。

CI 定義已包含 Windows／Ubuntu 核心驗證與 Ubuntu Chromium；本次記錄是本機測量，遠端 CI 需在推送後另行確認。

## Benchmark

```sh
npm run bench
```

環境：Intel Core i5-12450HX、Windows x64、Node.js v24.16.0。每個引擎 warm-up 3 次，再取 10 個樣本。工作量：函式內以 while 迴圈加總 0..4999，檢查結果必須為 12,497,500。每個樣本包含 lex／parse／resolve，以及 VM 路徑的 bytecode compilation。

| 引擎 | Median | p95（10 個樣本的 nearest-rank） | 引擎步數 |
| --- | --- | --- | --- |
| Tree interpreter | 6.5775 ms | 10.278 ms | 70,017 AST steps |
| Bytecode VM | 5.94125 ms | 10.2958 ms | 85,019 instructions |

兩者在這個 workload 的時間接近。宿主 JavaScript JIT、GC、OS 排程及其他應用程式都可能影響結果；這份單機小樣本不支持對所有程式做效能排名。兩個引擎的 step 單位不同，步數本身不能作為速度比較。

瀏覽器顯示的時間另外包含 Worker 啟動與 messaging，不應直接與這個 Node.js benchmark 比較。

```json
{
  "node": "v24.16.0",
  "platform": "win32",
  "includes_frontend": true,
  "results": [
    {"engine":"tree","samples":10,"median_ms":6.577500000000001,"p95_ms":10.27800000000002,"steps":70017},
    {"engine":"vm","samples":10,"median_ms":5.941250000000025,"p95_ms":10.295799999999986,"steps":85019}
  ]
}
```

## 可以繼續研究的題目

1. 將 frontend 與 execution 分開量測，分辨 parse/compile 成本與執行成本。
2. 以不同工作量測量：遞迴、closure 存取、字串、長迴圈與大量函式呼叫。
3. 加入 bytecode verifier、constant folding 或 local-slot 專用指令，再用同一組差異測試驗證。
4. 生成更多 AST 形狀，當兩個引擎不一致時自動縮小反例。
5. Optional type annotations 與靜態／執行期邊界已於 0.2.0 完成，見 [TYPES.md](TYPES.md)；接下來可研究推論與 union types。
