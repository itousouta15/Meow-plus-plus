import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location("meowpp", ROOT / "meowpp.py")
meowpp = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = meowpp
spec.loader.exec_module(meowpp)


class MeowPPTests(unittest.TestCase):
    def test_core_translates_to_both_targets(self):
        source = (ROOT / "examples" / "basic.meow").read_text(encoding="utf-8")
        python = meowpp.translate(source, "python")
        cpp = meowpp.translate(source, "cpp")
        self.assertIn("x = 10", python)
        self.assertIn("if x > 5:", python)
        self.assertIn("double x = 10;", cpp)
        self.assertIn("if (x > 5)", cpp)

    def test_python_output_matches_expected(self):
        source = (ROOT / "examples" / "basic.meow").read_text(encoding="utf-8")
        code = meowpp.translate(source, "python")
        result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout, "21\n大於 5\n")

    def test_explicit_raw_block_requires_matching_target(self):
        source = (ROOT / "examples" / "python_block.meow").read_text(encoding="utf-8")
        self.assertIn("import math", meowpp.translate(source, "python"))
        with self.assertRaisesRegex(meowpp.MeowPPError, "不能直接輸出成 cpp"):
            meowpp.translate(source, "cpp")

    def test_ambiguous_assignment_is_rejected(self):
        with self.assertRaisesRegex(meowpp.MeowPPError, "可能同時屬於"):
            meowpp.parse("x = 10\n")

    def test_cpp_raw_lines_are_preserved(self):
        source = "#include <iostream>\nint main() {\n    std::cout << 1 << std::endl;\n    return 0;\n}\n"
        code = meowpp.translate(source, "cpp")
        self.assertEqual(code, source)

    def test_mixed_raw_and_core_is_rejected(self):
        with self.assertRaisesRegex(meowpp.MeowPPError, r"不支援把喵\+\+ 語句"):
            meowpp.parse("設 x = 1\npython:\n    print(x)\n")


if __name__ == "__main__":
    unittest.main()

