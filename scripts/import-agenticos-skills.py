"""Import the Apache-2.0 skill gallery from an explicitly pinned agenticos checkout."""
import argparse
import json
from pathlib import Path
import subprocess

import yaml

REVISION = "a8c16d6b30571c636462e99a7221cf3724861057"
PREFIX = "backend/app/core/catalog/skill_gallery/"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    args = parser.parse_args()
    def git(*command):
        return subprocess.check_output(["git", "-C", str(args.source_dir), *command])
    paths = git("ls-tree", "-r", "--name-only", REVISION, PREFIX).decode().splitlines()
    destination = Path(__file__).resolve().parents[1] / "server/botteam/skill_gallery"
    records = []
    for path in paths:
        relative = path.removeprefix(PREFIX)
        if not relative or len(Path(relative).parts) < 3:
            continue
        data = git("show", f"{REVISION}:{path}")
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        if target.name == "SKILL.md":
            _, header, _body = data.decode("utf8").split("---", 2)
            meta = yaml.safe_load(header)
            industry, folder = Path(relative).parts[:2]
            records.append({"key": f"{industry}/{folder}", "industry": industry, "name": meta["name"], "description": meta["description"], "category": meta.get("category", "")})
    if len(records) != 80:
        raise RuntimeError(f"Expected 80 gallery skills, found {len(records)}")
    destination.joinpath("catalog.json").write_text(json.dumps({"source": "https://github.com/vstorm-co/agenticos", "revision": REVISION, "skills": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    destination.joinpath("LICENSE").write_bytes(git("show", f"{REVISION}:LICENSE"))
    print(f"Imported {len(records)} skills and {len(paths) - len(records)} supporting files from agenticos {REVISION}.")


if __name__ == "__main__":
    main()
