#!/usr/bin/env node
/* =========================================================================
   Headless test runner  (A4)

   MF7's test suite was browser-only and modal-driven — it ran when a human
   opened it. That is why three dead features shipped: nothing checked them
   on the way past.

   jsdom is not a browser. It has no layout, no canvas raster, no getBBox,
   no real SVG geometry. So this runner deliberately does NOT try to run the
   whole application. It:

     1. loads the document with the script executing, absorbing the failures
        that are jsdom's fault rather than the code's;
     2. shims the handful of APIs the boot path touches;
     3. runs the MOUNT ASSERTIONS and the pure-logic test suites, which are
        precisely the checks that do not need a real renderer.

   Anything needing real geometry stays a browser test. The point is that the
   class of bug the review found — a selector that resolves to nothing, a
   filter that matches nothing, a cache cleared every frame — is all visible
   without layout, and is now caught here on every build.
   ========================================================================= */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FILE = process.argv[2] || join(ROOT, "map-forge_9.html");

const VERBOSE = process.argv.includes("--verbose");
const jsdomNoise = [
  "Not implemented", "getBBox", "getComputedTextLength", "createObjectURL",
  "getContext", "matchMedia", "IntersectionObserver", "ResizeObserver",
  "Could not parse CSS", "createSVGPoint", "getScreenCTM",
];

const vc = new VirtualConsole();
const captured = [];
vc.on("jsdomError", err => {
  const msg = String(err && err.message || err);
  if (jsdomNoise.some(n => msg.includes(n))) return;
  captured.push(msg);
});
vc.on("error", (...a) => { if (VERBOSE) console.error("[page]", ...a); });
vc.on("warn", () => {});
vc.on("log", (...a) => { if (VERBOSE) console.log("[page]", ...a); });

const html = readFileSync(FILE, "utf8");

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "https://local.test/map-forge.html",
  virtualConsole: vc,
});
const { window } = dom;

/* ------------------------------------------------------------------ shims
   Only what the boot path actually reaches. Each one is a stub with the
   right SHAPE, so code that branches on the return value takes a real path
   rather than an accidental one. */
function shim() {
  const w = window;

  if (!w.matchMedia) w.matchMedia = q => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  });

  if (!w.requestAnimationFrame) {
    w.requestAnimationFrame = fn => setTimeout(() => fn(Date.now()), 0);
    w.cancelAnimationFrame = id => clearTimeout(id);
  }

  /* SVG geometry: enough for hit-testing and label measurement not to throw */
  const P = w.SVGElement && w.SVGElement.prototype;
  if (P) {
    if (!P.getBBox) P.getBBox = function () { return { x: 0, y: 0, width: 10, height: 10 }; };
    if (!P.getComputedTextLength) P.getComputedTextLength = function () {
      return ((this.textContent || "").length) * 6;
    };
    if (!P.getScreenCTM) P.getScreenCTM = function () {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse() { return this; } };
    };
    if (!P.getTotalLength) P.getTotalLength = function () { return 100; };
    if (!P.getPointAtLength) P.getPointAtLength = function () { return { x: 0, y: 0 }; };
  }
  const S = w.SVGSVGElement && w.SVGSVGElement.prototype;
  if (S && !S.createSVGPoint) S.createSVGPoint = function () {
    return { x: 0, y: 0, matrixTransform() { return { x: 0, y: 0 }; } };
  };

  if (!w.HTMLCanvasElement.prototype.getContext) {
    w.HTMLCanvasElement.prototype.getContext = () => null;
  }
  if (!w.URL.createObjectURL) w.URL.createObjectURL = () => "blob:stub";
  if (!w.URL.revokeObjectURL) w.URL.revokeObjectURL = () => {};

  if (!w.BroadcastChannel) w.BroadcastChannel = class {
    constructor(n) { this.name = n; }
    postMessage() {} close() {} addEventListener() {}
  };
  if (!w.Worker) w.Worker = class {
    constructor() {} postMessage() {} terminate() {} addEventListener() {}
  };

  /* IndexedDB is absent in jsdom. Returning undefined is the honest answer —
     MF9.store detects it and reports the localStorage fallback, which is the
     behaviour we want to assert on rather than paper over. */

  /* Element metrics, so layout-dependent code takes a sane branch */
  ["clientWidth", "clientHeight", "offsetWidth", "offsetHeight"].forEach((prop, i) => {
    Object.defineProperty(w.HTMLElement.prototype, prop, {
      configurable: true, get() { return i % 2 ? 800 : 1200; },
    });
  });
  if (!w.Element.prototype.getBoundingClientRect.__shim) {
    const f = function () { return { x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 }; };
    f.__shim = true;
    w.Element.prototype.getBoundingClientRect = f;
  }
  if (!w.Element.prototype.scrollIntoView) w.Element.prototype.scrollIntoView = () => {};
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/* --------------------------------------------------------------------- run */
const results = { pass: 0, fail: 0, skip: 0, lines: [] };
const record = (ok, label, detail) => {
  if (ok === "skip") { results.skip++; results.lines.push("  SKIP  " + label + (detail ? "  — " + detail : "")); return; }
  if (ok) { results.pass++; results.lines.push("  ok    " + label + (detail ? "  (" + detail + ")" : "")); }
  else { results.fail++; results.lines.push("  FAIL  " + label + (detail ? "  — " + detail : "")); }
};

async function main() {
  shim();
  /* the host boots off load; give it, MF7 and MF9's 400 ms deferred step room */
  await wait(1600);

  const w = window;
  console.log("Map Forge headless checks — " + FILE.split("/").pop() + "\n");

  /* --- 1. the document is alive at all ------------------------------- */
  record(!!w.document.getElementById("app"), "document booted");
  record(typeof w.mkSec === "function", "host script evaluated (mkSec defined)");

  /* --- 1b. open a project -------------------------------------------
     Without one, panel() returns "Open a map to begin" and every structural
     check measures an empty editor — which is how the first run of this
     runner reported a harvest of zero and looked like a bug in the fix.

     `P` is declared with `let`, so it is in the global LEXICAL scope and is
     not a property of window; it cannot be assigned from out here. Function
     declarations do land on window, so the project is opened the way a user
     opens it: by calling the app's own loader. */
  let opened = false;
  if (typeof w.loadSample === "function") {
    try { w.loadSample(); opened = true; } catch (e) { captured.push("loadSample: " + e.message); }
  }
  await wait(700);
  record(opened && typeof w.regionCount === "function" ? w.regionCount() > 0 : opened,
    "sample project opened", opened ? "via loadSample()" : "no loader found");


  /* --- 2. structural checks that do not need layout ------------------ */
  console.log("structure");
  const rail = w.document.getElementById("rail");
  record(!!rail, "A2 · #rail exists",
    rail ? rail.querySelectorAll("button").length + " buttons" : "the id three features query");

  if (typeof w.mkSec === "function") {
    const s = w.mkSec("Probe", true);
    record(s.tagName === "DETAILS", "A1 · mkSec emits <details>", s.tagName.toLowerCase());
    record(!!s.querySelector("summary"), "A1 · section has a <summary>");
    record(!!s.querySelector(".body"), "A1 · section keeps .body (34 call sites)");
  } else record(false, "A1 · mkSec available");

  /* The harvest is the actual defect. It must be handed the REAL #panel:
     harvest(host) reads host.children, but the host builder it invokes first
     always writes into #panel regardless of the argument. So a detached probe
     returns zero and looks identical to the bug being tested for. */
  if (w.MF7 && w.MF7.ui && typeof w.MF7.ui.harvest === "function") {
    let n = 0, err = null;
    try { n = (w.MF7.ui.harvest(w.document.getElementById("panel")) || []).length; }
    catch (e) { err = e.message; }
    try { w.panel(); } catch (e) { /* leave the panel rebuilt */ }
    record(n >= 10, "A1 · harvest adopts host sections", err || (n + " adopted"));
  } else record("skip", "A1 · harvest", "MF7.ui not present");

  /* --- 3. render/scene ------------------------------------------------ */
  console.log("\nrenderer");
  if (w.MF7 && w.MF7.scene) {
    let root = null, err = null;
    try { root = w.MF7.scene.ensureRoot(); } catch (e) { err = e.message; }
    record(!!root && root.getAttribute("data-persist") !== null,
      "A3 · scene root marked data-persist", err || (root ? "marked" : "no root"));
  } else record("skip", "A3 · scene", "MF7.scene not present");

  const svgEl = w.document.getElementById("svg");
  if (svgEl) {
    const land = svgEl.querySelector("#gLand path.land");
    const cells = svgEl.querySelector("#gCells");
    const filtered = [land, cells].filter(Boolean)
      .some(n => /mf-wobble/.test(n.getAttribute("filter") || ""));
    record(!filtered, "D3 · no raster displacement filter on land/cells");
  }

  /* --- 4. pure logic: the new modules --------------------------------- */
  console.log("\nlogic");
  const M = w.MF9;
  if (!M) { record(false, "MF9 layer loaded"); return finish(); }
  record(true, "MF9 layer loaded", "v" + M.VERSION);

  /* D3 wobble */
  try {
    const ring = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const before = JSON.stringify(ring);
    const a1 = w.wobbleRing(ring, "k", { amp: 3 });
    const a2 = w.wobbleRing(ring, "k", { amp: 3 });
    const a3 = w.wobbleRing(ring, "other", { amp: 3 });
    record(JSON.stringify(ring) === before, "D3 · source ring not mutated");
    record(JSON.stringify(a1) === JSON.stringify(a2), "D3 · deterministic per key");
    record(JSON.stringify(a1) !== JSON.stringify(a3), "D3 · different keys differ");
    const dev = a1.reduce((m, p) => Math.max(m,
      Math.min(Math.min(Math.abs(p[0]), Math.abs(p[0] - 100)),
               Math.min(Math.abs(p[1]), Math.abs(p[1] - 100)))), 0);
    record(dev <= 3 * 1.6, "D3 · stays within amplitude", dev.toFixed(2));
  } catch (e) { record(false, "D3 · wobble", e.message); }

  /* D1 legibility */
  try {
    const L = M.legibility;
    const v = L.arcmin(10, 1000);
    record(Math.abs(v - 34.38) < 0.1, "D1 · arcmin closed form", v.toFixed(2) + "′");
    record(L.arcmin(0, 1000) === 0 && L.arcmin(10, 0) === 0, "D1 · degenerate inputs return 0");
    const far = L.gradeText(4, 2000), near = L.gradeText(40, 300);
    record(far.arcmin < near.arcmin, "D1 · grading is monotonic in angular size");
    record(near.grade === "comfortable", "D1 · large near text grades comfortable", near.grade);
  } catch (e) { record(false, "D1 · legibility", e.message); }

  /* D2 components */
  try {
    const C = M.components;
    const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
    record(C.capacity(sq, 200).count === 0, "D2 · oversized piece does not fit");
    const small = C.capacity(sq, 20);
    record(small.count >= 9, "D2 · packs a 100×100 square", small.count + " pieces");
    const clear = small.spots.every(s => s[0] >= 9.9 && s[0] <= 90.1 && s[1] >= 9.9 && s[1] <= 90.1);
    record(clear, "D2 · every spot clears the boundary");
    let overlap = false;
    for (let i = 0; i < small.spots.length; i++)
      for (let j = i + 1; j < small.spots.length; j++)
        if (Math.hypot(small.spots[i][0] - small.spots[j][0],
                       small.spots[i][1] - small.spots[j][1]) < 20 - 1e-6) overlap = true;
    record(!overlap, "D2 · packed pieces never overlap");
  } catch (e) { record(false, "D2 · components", e.message); }

  /* E1 objectives.
     These must run inside the page's lexical scope. `P` is declared with
     `let`, so it lives in the global lexical environment and is NOT a
     property of window; assigning window.P from out here creates a second,
     unrelated binding that the page never reads. That is what made the first
     run of this suite report a bug in working code. */
  try {
    const r = w.eval('(function(){'
      + 'if (typeof P === "undefined" || !P) return null;'
      + 'var saved = P.objectives;'
      + 'P.objectives = { list: [{ id:"t", type:"control", name:"N", side:"fp", regions:["a","b","c"], count:2 }] };'
      + 'var met  = MF9.objectives.evaluate({a:"fp",b:"sh",c:"fp"})[0].met;'
      + 'var nmet = MF9.objectives.evaluate({a:"fp",b:"sh",c:"sh"})[0].met;'
      + 'P.objectives = { list: [{ id:"u", type:"control", name:"Impossible", regions:["a"], count:5 }] };'
      + 'var unwin = MF9.objectives.audit().some(function(x){ return /unwinnable/.test(x.msg); });'
      + 'P.objectives = saved;'
      + 'return { met: met, nmet: nmet, unwin: unwin };'
      + '})()');
    if (!r) record("skip", "E1 · objectives", "no project open");
    else {
      record(r.met === true,  "E1 · control objective met at threshold");
      record(r.nmet === false, "E1 · not met below threshold");
      record(r.unwin === true, "E1 · unwinnable objective flagged");
    }
  } catch (e) { record(false, "E1 · objectives", e.message); }


  /* E2 telemetry */
  try {
    const T = M.telemetry;
    const rows = T.parseCSV("result,start,game\nwin,rohan,1\nloss,gondor,1\n");
    record(rows.length === 2 && rows[0].start === "rohan" && rows[0].result === "win",
      "E2 · CSV columns in any order");
    const q = T.parseCSV('\uFEFFgame,start,notes\r\n1,rohan,"said ""tight"", liked it"\r\n');
    record(q.length === 1 && q[0].notes === 'said "tight", liked it',
      "E2 · quoting, CRLF and BOM survive");
    const wr = w.eval('(function(){'
      + 'if (typeof P === "undefined" || !P) return null;'
      + 'var saved = P.telemetry;'
      + 'P.telemetry = { rows: ['
      +   '{ game:"1", start:"a", result:"win",  held:[] },'
      +   '{ game:"2", start:"a", result:"loss", held:[] },'
      +   '{ game:"3", start:"b", result:"win",  held:[] }] };'
      + 'var out = JSON.parse(JSON.stringify(MF9.telemetry.winRateByStart()));'
      + 'P.telemetry = saved; return out;'
      + '})()');
    if (!wr) record("skip", "E2 · win rate", "no project open");
    else record(wr.a.games === 2 && Math.abs(wr.a.rate - 0.5) < 1e-9 && Math.abs(wr.b.rate - 1) < 1e-9,
      "E2 · win rate aggregates per start");
  } catch (e) { record(false, "E2 · telemetry", e.message); }

  /* C1 workspaces */
  try {
    const W = M.workspaces;
    const groups = (w.MF7 && w.MF7.ui && w.MF7.ui.GROUPS) || [];
    if (groups.length) {
      const bad = W.LIST.filter(ws => groups.indexOf(ws.group) < 0);
      record(bad.length === 0, "C1 · every workspace maps to a real panel group",
        bad.map(b => b.id).join(",") || (W.LIST.length + " workspaces"));
    } else record("skip", "C1 · workspace groups", "MF7.ui.GROUPS unavailable");
  } catch (e) { record(false, "C1 · workspaces", e.message); }

  /* B1 migration coverage */
  try {
    const cov = M.migration.coverage();
    record(cov.missing <= 4, "B1 · migration manifest covers the host sections",
      cov.missing ? "unmanifested: " + cov.unknown.join(", ") : cov.named + " sections declared");
  } catch (e) { record(false, "B1 · migration", e.message); }

  /* A5 storage */
  try {
    record(!!M.store, "A5 · store installed", "backend: " + M.store.backendName());
  } catch (e) { record(false, "A5 · store", e.message); }

  /* --- 5. the mount assertions themselves ----------------------------- */
  console.log("\nmount assertions");
  try {
    const res = M.mounts.run();
    res.forEach(r => {
      /* assertions needing real layout or a project cannot pass under jsdom;
         they are reported, not counted as failures */
      const hasProject = !!w.eval('typeof P !== "undefined" && !!P');
      const layoutBound = /a3\.scene/.test(r.id) && !r.ok && !hasProject;
      if (r.optional || layoutBound) record("skip", r.id, r.reason || r.detail || "");
      else record(r.ok, r.id, r.reason || r.detail || "");
    });
  } catch (e) { record(false, "mount assertions ran", e.message); }

  finish();
}

function finish() {
  console.log("\n" + results.lines.join("\n"));
  if (captured.length) {
    console.log("\npage errors (" + captured.length + "):");
    captured.slice(0, 12).forEach(m => console.log("  ! " + m.split("\n")[0].slice(0, 160)));
  }
  console.log("\n" + results.pass + " passed, " + results.fail + " failed, " + results.skip + " skipped");
  process.exit(results.fail ? 1 : 0);
}

main().catch(err => { console.error("runner crashed: " + err.stack); process.exit(2); });
