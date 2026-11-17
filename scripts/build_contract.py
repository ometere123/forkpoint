"""Assemble the exact, platform-independent source deployed to GenVM."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "contracts"
ARTIFACT = ROOT / "build" / "forkpoint.py"


def build(destination: Path = ARTIFACT) -> Path:
    header, core = (SOURCE / "forkpoint.py").read_text(encoding="utf-8").split("\n", 1)
    if not header.startswith('# { "Depends":'):
        raise ValueError("Contract must pin a GenVM runner in its first line")
    evidence = (SOURCE / "evidence.py").read_text(encoding="utf-8").strip()
    assembled = f"{header}\n\n{evidence}\n\n{core.strip()}\n"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(assembled.encode("utf-8"))
    return destination


if __name__ == "__main__":
    from hashlib import sha256

    artifact = build()
    print(f"{artifact.relative_to(ROOT)}  {sha256(artifact.read_bytes()).hexdigest()}")
