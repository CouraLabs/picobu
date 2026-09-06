import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const H = join(process.env.HOME, "Library/Application Support/Code/User/History");
const ROOT = "/Users/rodcoura/Projects/CouraLabs/picobu";

function stripComments(text) {
  try {
    const sf = ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const ranges = [];
    function visit(node) {
      const l = ts.getLeadingCommentRanges(sf.text, node.getFullStart());
      if (l) ranges.push(...l);
      const t = ts.getTrailingCommentRanges(sf.text, node.end);
      if (t) ranges.push(...t);
      ts.forEachChild(node, visit);
    }
    visit(sf);
    if (!ranges.length) return text;
    ranges.sort((a, b) => a.pos - b.pos);
    let out = "", last = 0;
    for (const r of ranges) { out += text.slice(last, r.pos); last = r.end; }
    out += text.slice(last);
    return out.split("\n").filter((l, i, a) => l.trim() !== "" || (i > 0 && a[i-1].trim() !== "")).join("\n");
  } catch { return text; }
}

const results = [];
for (const dir of readdirSync(H)) {
  const ep = join(H, dir, "entries.json");
  let entries;
  try { entries = JSON.parse(readFileSync(ep, "utf8")); } catch { continue; }
  if (!entries.resource || !entries.resource.includes("/picobu/")) continue;
  const filePath = entries.resource.replace("file://", "");
  if (!filePath.startsWith(ROOT + "/src/") && filePath !== ROOT + "/AGENTS.md") continue;
  if (!/\.tsx?$/.test(filePath)) continue;
  const sorted = [...entries.entries].sort((a, b) => b.timestamp - a.timestamp);
  for (const e of sorted) { // newest first
    let snap;
    try { snap = readFileSync(join(H, dir, e.id), "utf8"); } catch { continue; }
    let cur;
    try { cur = readFileSync(filePath, "utf8"); } catch { cur = null; }
    if (cur === null) {
      results.push({ file: filePath, ts: new Date(e.timestamp).toISOString(), status: "MISSING (file absent)", snap: join(H, dir, e.id), snapRaw: join(H, dir, e.id) });
      break;
    }
    const snapStripped = stripComments(snap);
    const curStripped = stripComments(cur);
    if (snapStripped !== curStripped) {
      const curLines = new Set(curStripped.split("\n"));
      const missing = snapStripped.split("\n").filter(l => l.trim() && !curLines.has(l));
      results.push({
        file: filePath, ts: new Date(e.timestamp).toISOString(),
        status: missing.length > 3 ? `DIFFERS (${missing.length} lines not in current)` : "minor diff",
        missingPreview: missing.slice(0, 3),
        snap: join(H, dir, e.id),
      });
    }
    break; // only newest snapshot per file
  }
}
for (const r of results) {
  console.log(`\n${r.file}\n  saved: ${r.ts}  [${r.status}]`);
  if (r.missingPreview) for (const m of r.missingPreview) console.log(`    lost: ${m.slice(0, 100)}`);
}
console.log(`\n${results.length} files with differences`);
