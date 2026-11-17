"""Run targeted security mutations through the unmodified SDK test harness."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile

from build_contract import build


MUTANTS = [
    ("permit-indirect-wallet", "if sender != gl.message.origin_address:", "if False:", "wrong_network"),
    ("remove-chain-check", "if int(gl.message.chain_id) != 61999:", "if False:", "wrong_network"),
    ("permit-cutoff-timestamp", 'now < spec["cutoff"]', 'now <= spec["cutoff"]', "replay_and_boundary"),
    ("accept-incorrect-stake", "if int(gl.message.value) != stake:", "if False:", "replay_and_boundary"),
    ("allow-double-position", "if key in self.positions:", "if False:", "replay_and_boundary"),
    ("allow-double-claim", "if int(pos.dispatched_amount) != 0:", "if False:", "expire_and_native"),
    ("reuse-assessment-slot", "if slot <= last_slot:", "if False:", "trigger_retry"),
    ("early-expiration", "if now < _window_start(spec, trigger) + _WINDOW_SECONDS:", "if False:", "expire_and_native"),
    ("allow-path-traversal", 'part in ("", ".", "..")', 'part in ("", ".")', "spec_rejection"),
    ("skip-trigger-identity", '_github_id(pr["base"]["repo"]["id"]) == repo_id', "True", "wrong_repository"),
    ("ignore-late-merge", 'if merged_at > spec["trigger_deadline"]:', "if False:", "trigger_github_deadline"),
    ("confiscate-void-funds", 'if market.phase in ("VOID", "INCONCLUSIVE"):\n        return stake',
     'if market.phase in ("VOID", "INCONCLUSIVE"):\n        return 0', "void_pool_conservation"),
    ("drop-remainder", "amount + (remainder if int(pos.side_rank) == 0 else 0)", "amount", "entitlement_conservation"),
    ("permit-mutable-release", 'release["immutable"] is True', "True", "incomplete_release"),
    ("accept-incomplete-tree", 'tree["truncated"] is False', "True", "incomplete_release"),
    ("ignore-blob-integrity", "hashlib.sha1(git_bytes).hexdigest() == sha", "True", "incomplete_release"),
    ("trust-leader-verdict", "leader.calldata == propose()", "True", "validator_rejects"),
    ("accept-dead-code", "if isinstance(node, (ast.If, ast.While)) and isinstance(node.test, ast.Constant):",
     "if False:", "python_evidence"),
    ("accept-late-release", 'merged_at < published_at <= spec["outcome_deadline"]',
     "merged_at < published_at", "release_timestamps"),
]


def run_tests(path, *args):
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-xq", *args],
        env={**os.environ, "FORKPOINT_TEST_CONTRACT": str(path)},
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )


def main():
    original = build()
    baseline = run_tests(original)
    if baseline.returncode != 0:
        print(baseline.stdout + baseline.stderr)
        raise SystemExit("Baseline failed, no mutants counted")
    source = original.read_text(encoding="utf-8")
    survivors = []
    with tempfile.TemporaryDirectory(prefix="forkpoint-mutants-") as directory:
        for name, before, after, exercise in MUTANTS:
            if source.count(before) != 1:
                raise SystemExit(f"Mutation {name} is missing or ambiguous")
            path = Path(directory) / f"{name}.py"
            path.write_bytes(source.replace(before, after, 1).encode("utf-8"))
            result = run_tests(path, "-k", exercise)
            # Setup, collection, and tool errors never count as kills.
            summary = result.stdout
            killed = result.returncode == 1 and " failed" in summary and "ERROR" not in summary
            print(f"{'KILLED' if killed else 'SURVIVED OR INVALID'} {name}", flush=True)
            if not killed:
                survivors.append(name)
                print(summary + result.stderr)
    print(f"{len(MUTANTS) - len(survivors)}/{len(MUTANTS)} security mutants killed")
    if survivors:
        raise SystemExit("Surviving or invalid mutations: " + ", ".join(survivors))


if __name__ == "__main__":
    main()
