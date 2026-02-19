#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
schema_sql="$repo_root/ops/0.schema.sql"
out_dir="$repo_root/.github/image"

tmp_dir="$(mktemp -d)"
dot_file="$tmp_dir/schema.dot"

SCHEMA_SQL="$schema_sql" DOT_FILE="$dot_file" python3 - <<'PY'
import os
import re
from pathlib import Path

schema_sql = Path(os.environ["SCHEMA_SQL"]).read_text(encoding="utf-8")

create_table_re = re.compile(r"CREATE\s+TABLE\s+([A-Za-z0-9_]+)\s*\(", re.IGNORECASE)
references_re = re.compile(r"REFERENCES\s+([A-Za-z0-9_]+)", re.IGNORECASE)

tables = set(create_table_re.findall(schema_sql))
blocks = re.split(r"CREATE\s+TABLE\s+", schema_sql, flags=re.IGNORECASE)[1:]

edges = set()
for block in blocks:
    name_match = re.match(r"([A-Za-z0-9_]+)", block)
    if not name_match:
        continue
    table_name = name_match.group(1)
    for ref in references_re.findall(block):
        edges.add((table_name, ref))

lines = []
lines.append("digraph schema {")
lines.append("  rankdir=LR;")
lines.append("  splines=true;")
lines.append("  overlap=false;")
lines.append("")
for table in sorted(tables):
    lines.append(f'  "{table}";')
lines.append("")
for src, dst in sorted(edges):
    lines.append(f'  "{src}" -> "{dst}";')
lines.append("}")

Path(os.environ["DOT_FILE"]).write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

mkdir -p "$out_dir"

dot -Tsvg -o "$out_dir/schema.svg" \
  -Gbgcolor="#ffffff" \
  -Nshape="box" -Nstyle="filled" -Nfillcolor="#f8f8f8" -Ncolor="#444444" -Nfontcolor="#111111" -Nfontname="Helvetica" -Nfontsize="12" \
  -Ecolor="#666666" \
  "$dot_file"

dot -Tsvg -o "$out_dir/schema-dark.svg" \
  -Gbgcolor="#0b0b0b" \
  -Nshape="box" -Nstyle="filled" -Nfillcolor="#1f1f1f" -Ncolor="#777777" -Nfontcolor="#f5f5f5" -Nfontname="Helvetica" -Nfontsize="12" \
  -Ecolor="#aaaaaa" \
  "$dot_file"
