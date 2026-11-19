#!/usr/bin/env bun
// zy-models: a few upstream files are forked into our own cn-* copies so the
// upstream originals stay verbatim (and never conflict on merge). This reports
// which upstream originals changed since we last ported them, so the change can
// be carried over by hand. It never fails the run.
//
//   bun scripts/check-upstream-forks.ts            # markdown report on stdout
//   bun scripts/check-upstream-forks.ts --update   # record the current upstream blobs as ported
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const file = path.join(root, "scripts", "upstream-forks.json");
type Entry = { upstream: string; ported_from_blob: string; ported_from_commit?: string };
const forks = (await Bun.file(file).json()) as Record<string, Entry>;

const blob = async (p: string) => (await Bun.$`git -C ${root} hash-object ${p}`.quiet().text()).trim();
const changed: string[] = [];
for (const [fork, entry] of Object.entries(forks)) {
  const now = await blob(entry.upstream);
  if (now === entry.ported_from_blob) continue;
  if (process.argv.includes("--update")) {
    entry.ported_from_blob = now;
    entry.ported_from_commit = (await Bun.$`git -C ${root} rev-parse HEAD`.quiet().text()).trim();
    continue;
  }
  changed.push(
    `- \`${entry.upstream}\` changed upstream → port into \`${fork}\` (\`git diff ${entry.ported_from_blob} ${now}\`)`,
  );
}
if (process.argv.includes("--update")) {
  await Bun.write(file, JSON.stringify(forks, null, 2) + "\n");
} else if (changed.length > 0) {
  console.log("上游改动了我们 fork 过的文件（不影响合并，但需要手工移植到 cn-* 版本，移植后运行 `bun scripts/check-upstream-forks.ts --update`）：\n");
  console.log(changed.join("\n"));
}
