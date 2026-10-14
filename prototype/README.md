# 喵++ 第一版可執行原型

這個目錄是針對「喵++ → Python / C++」的最小轉譯器，不修改原始 GitHub 專案的既有 C++ 風格語言核心。

目前只承諾喵++ 核心語法：

```text
設 x = 10
設 y = x * 2 + 1
顯示 y
如果 x > 5:
    顯示 "大於 5"
否則:
    顯示 "小於或等於 5"
```

## 執行

使用 Python 3.10+：

```powershell
python prototype/meowpp.py prototype/examples/basic.meow --target python
python prototype/meowpp.py prototype/examples/basic.meow --target cpp
python prototype/meowpp.py prototype/examples/basic.meow --target python --run
```

也可以輸出檔案：

```powershell
python prototype/meowpp.py prototype/examples/basic.meow --target cpp -o work/basic.cpp
```

`--run` 的 Python 目標會直接執行；C++ 目標則尋找 `CXX`、`c++`、`g++` 或 `clang++`，以 C++17 編譯後執行。

## 語法判斷規則

1. `設`、`顯示`、`如果`、`否則` 明確屬於喵++。
2. `python:` 和 `cpp:` 開啟原始語言區塊；區塊內容依縮排收集，直到回到外層。
3. 少量無歧義的 `import`、`print(...)`、`def`、`#include`、C++ 型別宣告可以被辨識為原始語言行。
4. 像 `x = 10` 或 `if x > 5:` 這種可能屬於兩種語言的寫法會直接報錯，要求使用者改成喵++ 語法或加上語言區塊。
5. 第一版不混譯喵++ 核心語句與 Python/C++ 原始區塊；這能讓輸出語意可預期，跨語言函式與資料傳遞留到下一階段。

## 測試

```powershell
python -m unittest discover -s prototype -p 'test_*.py' -v
```

測試會執行生成的 Python，並檢查 Python/C++ 兩種輸出的基本結構。若之後提供 C++17 編譯器，可以再把 C++ 編譯執行加入差分測試。

