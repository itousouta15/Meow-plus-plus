#!/usr/bin/env python3
"""喵++ 第一期原型：將簡化語法轉譯成 Python 或 C++17。

這不是完整的 Python/C++ parser。它刻意使用行導向規則，讓語法衝突時能
明確報錯，而不是猜測使用者的意圖。
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


class MeowPPError(Exception):
    """可直接顯示給使用者的語法或轉譯錯誤。"""


@dataclass(frozen=True)
class Line:
    number: int
    indent: int
    text: str
    original: str


@dataclass(frozen=True)
class Node:
    kind: str
    line: int
    value: object = None
    body: tuple["Node", ...] = ()
    otherwise: tuple["Node", ...] = ()
    language: str | None = None


_IDENT = r"[A-Za-z_][A-Za-z0-9_]*|[\u3400-\u9fff][\w\u3400-\u9fff]*"
_EXPR_CHARS = re.compile(
    r"^[\w\s\u3400-\u9fff\u4e00-\u9fff.(),+\-*/%<>=!&|\"']+$"
)


def _indent_of(raw: str) -> int:
    prefix = raw[: len(raw) - len(raw.lstrip(" "))]
    if "\t" in prefix:
        raise MeowPPError("不支援 tab 縮排，請統一使用空白。")
    return len(prefix)


def _clean_lines(source: str) -> list[Line]:
    result: list[Line] = []
    for number, raw in enumerate(source.splitlines(), 1):
        indent = _indent_of(raw)
        text = raw[indent:].strip()
        result.append(Line(number, indent, text, raw))
    return result


def _validate_expr(expr: str, line: int) -> str:
    expr = expr.strip().rstrip(";").strip()
    if not expr or not _EXPR_CHARS.fullmatch(expr):
        raise MeowPPError(
            f"第 {line} 行的表達式超出第一期範圍：{expr!r}。"
        )
    if any(token in expr for token in ("__", "[", "]", "{", "}", ":")):
        raise MeowPPError(f"第 {line} 行的表達式包含尚未支援的語法。")
    return expr


def _is_python_line(text: str) -> bool:
    return bool(
        re.match(r"^(?:from\s+\S+\s+import\s+\S+|import\s+\S+)", text)
        or re.match(r"^def\s+[_A-Za-z]\w*\s*\(.*\)\s*:", text)
        or re.match(r"^print\s*\(", text)
        or re.match(r"^(?:elif|else|for|while|return)\b", text)
    )


def _is_cpp_line(text: str) -> bool:
    return bool(
        text.startswith("#include")
        or re.match(r"^(?:int|double|float|bool|char|string|auto)\s+", text)
        or re.match(r"^(?:std::)?(?:cout|cin|cerr|clog)\b", text)
        or text.startswith("std::")
        or re.match(r"^(?:int|void)\s+main\s*\(", text)
        or re.match(r"^(?:return|using\s+namespace)\b", text)
        or text in {"{", "}"}
    )


def _looks_ambiguous(text: str) -> bool:
    # x = 1 和 if x > 1: 都可能是不同語言的合法寫法；第一期拒絕猜測。
    return bool(
        re.match(rf"^(?:{_IDENT})\s*[+\-*/]?=", text)
        or re.match(r"^(?:if|while)\b.*:", text)
    )


def _raw_block(lines: list[Line], start: int, marker: Line) -> tuple[Node, int]:
    language = marker.text[:-1]
    index = start + 1
    children: list[Line] = []
    while index < len(lines):
        current = lines[index]
        if current.text and current.indent <= marker.indent:
            break
        if current.text:
            children.append(current)
        index += 1
    if not children:
        raise MeowPPError(f"第 {marker.number} 行的 {language}: 區塊不可為空。")
    base = min(line.indent for line in children)
    content = tuple(line.original[base:] for line in children)
    return Node("raw", marker.number, content, language=language), index


def _auto_raw_block(lines: list[Line], start: int, language: str) -> tuple[Node, int]:
    """收集無標記但已被明確辨識的語言行及其縮排子區塊。"""
    first = lines[start]
    content = [first.original]
    index = start + 1
    while index < len(lines):
        current = lines[index]
        if current.text and current.indent <= first.indent:
            break
        if current.text:
            content.append(current.original)
        index += 1
    return Node("raw", first.number, tuple(content), language=language), index


def parse(source: str) -> tuple[Node, ...]:
    lines = _clean_lines(source)

    def block(index: int, indent: int) -> tuple[tuple[Node, ...], int]:
        nodes: list[Node] = []
        while index < len(lines):
            line = lines[index]
            if not line.text:
                index += 1
                continue
            if line.indent < indent:
                break
            if line.indent > indent:
                raise MeowPPError(
                    f"第 {line.number} 行縮排多了一層；請把它放在上一個區塊之下。"
                )

            if line.text in {"python:", "cpp:"}:
                node, index = _raw_block(lines, index, line)
                nodes.append(node)
                continue

            if line.text.endswith(":") and line.text.startswith("如果 "):
                expr = _validate_expr(line.text[3:-1], line.number)
                if index + 1 >= len(lines) or lines[index + 1].indent <= indent:
                    raise MeowPPError(f"第 {line.number} 行的 如果 缺少縮排區塊。")
                child_indent = lines[index + 1].indent
                body, index = block(index + 1, child_indent)
                otherwise: tuple[Node, ...] = ()
                if index < len(lines) and lines[index].text == "否則:":
                    else_line = lines[index]
                    if index + 1 >= len(lines) or lines[index + 1].indent <= indent:
                        raise MeowPPError(f"第 {else_line.number} 行的 否則 缺少縮排區塊。")
                    otherwise, index = block(index + 1, lines[index + 1].indent)
                nodes.append(Node("if", line.number, expr, body, otherwise))
                continue

            if line.text == "否則:":
                raise MeowPPError(f"第 {line.number} 行的 否則 沒有對應的 如果。")

            match = re.match(rf"^設\s+({_IDENT})\s*=\s*(.+)$", line.text)
            if match:
                nodes.append(
                    Node("set", line.number, (match.group(1), _validate_expr(match.group(2), line.number)))
                )
                index += 1
                continue

            if line.text.startswith("顯示"):
                expr = line.text[2:].strip()
                nodes.append(Node("display", line.number, _validate_expr(expr, line.number)))
                index += 1
                continue

            if _is_python_line(line.text):
                node, index = _auto_raw_block(lines, index, "python")
                nodes.append(node)
                continue
            if _is_cpp_line(line.text):
                node, index = _auto_raw_block(lines, index, "cpp")
                nodes.append(node)
                continue
            if _looks_ambiguous(line.text):
                raise MeowPPError(
                    f"第 {line.number} 行可能同時屬於 Python/C++：{line.text!r}。"
                    " 請改用 `設`、`如果`、`顯示`，或放入 `python:`／`cpp:` 區塊。"
                )
            raise MeowPPError(
                f"第 {line.number} 行無法判斷語法：{line.text!r}。"
                " 第一版只接受變數、顯示、如果，或明確的 Python/C++ 區塊。"
            )
        return tuple(nodes), index

    nodes, end = block(0, 0)
    if end != len(lines):
        raise MeowPPError("程式結構無法完成解析。")
    _validate_language_mix(nodes)
    return nodes


def _flatten(nodes: Iterable[Node]) -> Iterable[Node]:
    for node in nodes:
        yield node
        if node.kind == "if":
            yield from _flatten(node.body)
            yield from _flatten(node.otherwise)


def _validate_language_mix(nodes: tuple[Node, ...]) -> None:
    raw = [node for node in _flatten(nodes) if node.kind == "raw"]
    if not raw:
        return
    languages = {node.language for node in raw}
    has_meow = any(node.kind != "raw" for node in _flatten(nodes))
    if len(languages) > 1 or has_meow:
        raise MeowPPError(
            "第一期不支援把喵++ 語句和 Python/C++ 原始區塊混在同一個輸入檔。"
            " 請先拆成純喵++ 程式，或只保留單一語言的 raw 區塊。"
        )


def _replace_words(expr: str, replacements: dict[str, str]) -> str:
    parts = re.split(r'("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\')', expr)
    for index in range(0, len(parts), 2):
        for source, target in replacements.items():
            parts[index] = re.sub(rf"(?<![\w\u3400-\u9fff]){re.escape(source)}(?![\w\u3400-\u9fff])", target, parts[index])
    return "".join(parts)


def _python_expr(expr: str) -> str:
    return _replace_words(expr, {"且": "and", "或": "or", "非": "not", "真": "True", "假": "False"})


def _cpp_expr(expr: str) -> str:
    return _replace_words(expr, {"且": "&&", "或": "||", "非": "!", "真": "true", "假": "false"})


def _raw_output(nodes: tuple[Node, ...], target: str) -> str | None:
    raw = [node for node in _flatten(nodes) if node.kind == "raw"]
    if not raw:
        return None
    language = raw[0].language
    if language != target:
        raise MeowPPError(
            f"輸入是 {language} 區塊，不能直接輸出成 {target}。"
            " 請改用相同的 --target，或改寫成喵++ 核心語法。"
        )
    return "\n".join(line for node in raw for line in node.value) + "\n"


def _infer_cpp_type(expr: str, variables: dict[str, str]) -> str:
    value = expr.strip()
    if re.fullmatch(r"(?:\"(?:\\.|[^\"])*\"|'(?:\\.|[^'])*')", value):
        return "std::string"
    if value in {"真", "假", "true", "false", "True", "False"}:
        return "bool"
    if re.fullmatch(r"[0-9]+", value):
        return "double"
    for name, kind in variables.items():
        if re.search(rf"\b{re.escape(name)}\b", value):
            return kind
    return "double"


def _render_python_nodes(nodes: Iterable[Node], level: int = 0) -> list[str]:
    output: list[str] = []
    prefix = "    " * level
    for node in nodes:
        if node.kind == "set":
            name, expr = node.value
            output.append(f"{prefix}{name} = {_python_expr(expr)}")
        elif node.kind == "display":
            output.append(f"{prefix}print({_python_expr(node.value)})")
        elif node.kind == "if":
            output.append(f"{prefix}if {_python_expr(node.value)}:")
            output.extend(_render_python_nodes(node.body, level + 1))
            if node.otherwise:
                output.append(f"{prefix}else:")
                output.extend(_render_python_nodes(node.otherwise, level + 1))
    return output


def _render_cpp_nodes(nodes: Iterable[Node], level: int = 1, variables: dict[str, str] | None = None) -> list[str]:
    variables = {} if variables is None else variables
    output: list[str] = []
    prefix = "    " * level
    for node in nodes:
        if node.kind == "set":
            name, expr = node.value
            kind = _infer_cpp_type(expr, variables)
            variables[name] = kind
            output.append(f"{prefix}{kind} {name} = {_cpp_expr(expr)};")
        elif node.kind == "display":
            output.append(f"{prefix}std::cout << {_cpp_expr(node.value)} << std::endl;")
        elif node.kind == "if":
            output.append(f"{prefix}if ({_cpp_expr(node.value)}) {{")
            output.extend(_render_cpp_nodes(node.body, level + 1, variables))
            if node.otherwise:
                output.append(f"{prefix}}} else {{")
                output.extend(_render_cpp_nodes(node.otherwise, level + 1, variables))
            output.append(f"{prefix}}}")
    return output


def translate(source: str, target: str) -> str:
    if target not in {"python", "cpp"}:
        raise ValueError("target 必須是 python 或 cpp")
    nodes = parse(source)
    raw = _raw_output(nodes, target)
    if raw is not None:
        return raw
    if target == "python":
        return "\n".join(_render_python_nodes(nodes)) + "\n"
    body = _render_cpp_nodes(nodes)
    return "#include <iostream>\n#include <string>\n\nint main() {\n" + "\n".join(body) + "\n    return 0;\n}\n"


def _find_cpp() -> str | None:
    for candidate in ("CXX", "c++", "g++", "clang++"):
        path = shutil.which(candidate) if candidate != "CXX" else shutil.which(__import__("os").environ.get("CXX", ""))
        if path:
            return path
    return None


def _run_generated(code: str, target: str) -> int:
    if target == "python":
        # 直接走 stdin，避免受限環境不允許從系統暫存目錄啟動檔案。
        completed = subprocess.run(
            [sys.executable, "-"], input=code, text=True, check=False
        )
        return completed.returncode
    with tempfile.TemporaryDirectory(prefix="meowpp-") as directory:
        root = Path(directory)
        compiler = _find_cpp()
        if compiler is None:
            raise MeowPPError("找不到 C++ 編譯器；請安裝 g++/clang++，或設定 CXX。")
        source = root / "generated.cpp"
        binary = root / ("generated.exe" if sys.platform == "win32" else "generated")
        source.write_text(code, encoding="utf-8")
        subprocess.run([compiler, "-std=c++17", str(source), "-o", str(binary)], check=True)
        return subprocess.run([str(binary)], check=False).returncode


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="喵++ 第一版原型轉譯器")
    parser.add_argument("source", type=Path, help=".meow 原始檔；使用 - 代表標準輸入")
    parser.add_argument("--target", choices=("python", "cpp"), required=True)
    parser.add_argument("-o", "--output", type=Path, help="輸出檔；省略時輸出到 stdout")
    parser.add_argument("--run", action="store_true", help="轉譯後立即執行")
    args = parser.parse_args(argv)
    try:
        source = sys.stdin.read() if str(args.source) == "-" else args.source.read_text(encoding="utf-8")
        code = translate(source, args.target)
        if args.output:
            args.output.write_text(code, encoding="utf-8")
        elif not args.run:
            sys.stdout.write(code)
        if args.run:
            return _run_generated(code, args.target)
        return 0
    except (OSError, MeowPPError, subprocess.CalledProcessError) as error:
        print(f"喵++ 錯誤：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

