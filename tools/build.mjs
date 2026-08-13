#!/usr/bin/env node
/* =========================================================================
   Map Forge build  (B2)

   The single self-contained HTML file is a good product decision — it is why
   someone can save the tool to a USB stick and open it in ten years. It is a
   terrible EDITING surface, and that asymmetry caused most of the defects in
   the review: MF7 was written against an interface its author had in their
   head, with no compile step and no integration check to confirm the
   interface was real.

   So: source lives in src/, the HTML file is an output.

   The MF7 layer already had half of this — its banner says "Source of truth:
   src/mf7/*.js (edit there, not here)" — for 38% of the file. This extends
   the same discipline to the new layer and gives it a checkable build.

     node tools/build.mjs [--in file] [--out file] [--check]

   --check verifies the bundle parses and that the marker block is well
   formed, without writing anything.
   ========================================================================= */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "src", "mf9");

const BEGIN = "/* ===== MF9 LAYER — GENERATED, DO NOT EDIT HERE ===== */";
const END = "/* ===== END MF9 LAYER ===== */";

const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const IN = argOf("--in", join(ROOT, "map-forge_9.html"));
const OUT = argOf("--out", IN);
const CHECK = args.includes("--check");

/* ------------------------------------------------------------------ bundle */
function bundle() {
  const files = readdirSync(SRC).filter(f => f.endsWith(".js")).sort();
  if (!files.length) throw new Error("No source modules found in " + SRC);
  const parts = [
    BEGIN,
    "/* Built " + new Date().toISOString(),
    "   Source of truth: src/mf9/*.js  — edit there, then run tools/build.mjs.",
    "   Modules, in load order:",
    ...files.map(f => "     · " + f),
    "*/",
    "",
  ];
  for (const f of files) {
    parts.push("/* ===== MF9 module: " + f + " ===== */");
    parts.push(readFileSync(join(SRC, f), "utf8").trimEnd());
    parts.push("");
  }
  parts.push(END);
  return parts.join("\n");
}

/* ------------------------------------------------------------------- inject */
function inject(html, layer) {
  const b = html.indexOf(BEGIN);
  const e = html.indexOf(END);
  if (b >= 0 && e > b) {
    /* replace an existing layer — idempotent rebuilds */
    return html.slice(0, b) + layer + html.slice(e + END.length);
  }
  const tail = html.lastIndexOf("</script>");
  if (tail < 0) throw new Error("No closing </script> found in the host file");
  return html.slice(0, tail) + "\n" + layer + "\n" + html.slice(tail);
}

/* -------------------------------------------------------------------- check */
function checkSyntax(html) {
  const open = html.indexOf("<script>", html.indexOf("</style>"));
  const close = html.lastIndexOf("</script>");
  const js = html.slice(open + "<script>".length, close);
  const tmp = join(ROOT, ".build-check.js");
  writeFileSync(tmp, js);
  try {
    execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
    return { ok: true, bytes: js.length };
  } catch (err) {
    return { ok: false, error: (err.stderr || err.stdout || "").toString().slice(0, 2000) };
  }
}

/* --------------------------------------------------------------------- main */
try {
  const html = readFileSync(IN, "utf8");
  const layer = bundle();
  const out = inject(html, layer);
  const res = checkSyntax(out);
  if (!res.ok) {
    console.error("Bundle does not parse:\n" + res.error);
    process.exit(1);
  }
  if (CHECK) {
    console.log("check ok — " + (layer.length / 1024).toFixed(1) + " KB layer, " +
      (res.bytes / 1024).toFixed(1) + " KB total script");
    process.exit(0);
  }
  writeFileSync(OUT, out);
  console.log("built " + basename(OUT) +
    "  ·  MF9 layer " + (layer.length / 1024).toFixed(1) + " KB" +
    "  ·  total " + (out.length / 1024).toFixed(1) + " KB");
} catch (err) {
  console.error("build failed: " + err.message);
  process.exit(1);
}
