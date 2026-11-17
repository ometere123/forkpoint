import ast

import pytest

from scripts.build_contract import build


@pytest.fixture(scope="module")
def evidence_module():
    path = build()
    source = path.read_text(encoding="utf-8")
    parsed = ast.parse(source, filename=str(path))
    wanted = {"_python_block", "_python_blocks", "_substantive_python_node", "_line_marker_match"}
    selected = [node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name in wanted]
    namespace = {
        "ast": ast,
        "EvidenceUnavailable": type("EvidenceUnavailable", (Exception,), {}),
    }
    code = compile(ast.fix_missing_locations(ast.Module(body=selected, type_ignores=[])), str(path), "exec")
    exec(code, namespace)
    return type("EvidenceHelpers", (), namespace)


def test_python_block_stops_after_terminator_and_handles_empty(evidence_module):
    assert list(evidence_module._python_block([])) == []
    module = ast.parse("def run():\n    return value\n    value = other\n")
    blocks = list(evidence_module._python_blocks(module))
    assert any(len(block) == 1 and isinstance(block[0], ast.Return) for block in blocks)


def test_decorated_function_marker_is_a_complete_substantive_block(evidence_module):
    source = "@feature_flag\ndef run(value):\n    return value\n"
    assert evidence_module._line_marker_match(
        "src/feature.py", source, "@feature_flag\ndef run(value):\n    return value"
    ) == (True, "python_statement_match")


def test_non_substantive_python_nodes_do_not_qualify(evidence_module):
    assert evidence_module._substantive_python_node(ast.parse("42").body[0]) is False
    assert evidence_module._substantive_python_node(ast.parse("pass").body[0]) is False
    assert evidence_module._substantive_python_node(ast.parse("value = 1").body[0]) is False
