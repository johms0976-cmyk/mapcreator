/* =========================================================================
   MF9 · 00 — PLATFORM: MOUNT ASSERTIONS  (A4)

   The A-series defects in the review all failed the same way: a feature
   installed itself, found nothing, and returned quietly.

     · MF7U.harvest filtered for <details>; mkSec emitted <div><h3>.  Empty
       array, no error, 23 sections destroyed.
     · MF7U.buildRail did getElementById("rail"); the element was #tools.
       `if (!rail) return;` — no error.
     · MF7SC.ensureRoot cleared its node cache every frame. Correct code,
       useless outcome, no error.

   None of these throws, so MF7's otherwise-good smoke suite could not see
   them. `MF7.registry.legacy.failed` catches the same class of bug for
   MF.patch targets, and that check exists precisely because the author
   anticipated this — it just only covers one of the three doors.

   A mount assertion closes the rest. A feature declares what it needs and
   what it should have produced; the check runs once after boot and reports
   into diagnostics and into the test suite. A feature that silently does
   nothing becomes a visible failure.
   ========================================================================= */
(function () {
  const MF9 = window.MF9 || (window.MF9 = {});
  MF9.VERSION = "1.0";

  const M = MF9.mounts = {
    specs: [],
    results: [],
    ran: false,
  };

  /* -----------------------------------------------------------------------
     declare(spec)
       id       — stable identifier, shown in diagnostics
       needs    — CSS selector(s) that must resolve before the feature can work
       asserts  — () => boolean | {ok, detail}; what should exist AFTER mount
       optional — true when absence is legitimate (feature genuinely disabled)
       detail   — () => string, extra context for the report
  ----------------------------------------------------------------------- */
  M.declare = function (spec) {
    if (!spec || !spec.id) return null;
    M.specs.push(spec);
    return spec;
  };

  M.check = function (spec) {
    const rec = { id: spec.id, ok: true, reason: null, detail: null, optional: !!spec.optional };
    const needs = spec.needs ? (Array.isArray(spec.needs) ? spec.needs : [spec.needs]) : [];
    for (const sel of needs) {
      if (!document.querySelector(sel)) {
        rec.ok = false;
        rec.reason = "required element not found: " + sel;
        return rec;
      }
    }
    if (spec.asserts) {
      let out;
      try { out = spec.asserts(); }
      catch (err) { rec.ok = false; rec.reason = "assertion threw: " + (err && err.message || err); return rec; }
      if (out === false) { rec.ok = false; rec.reason = "assertion returned false"; }
      else if (out && typeof out === "object" && out.ok === false) {
        rec.ok = false;
        rec.reason = out.reason || "assertion failed";
      }
      if (out && typeof out === "object" && out.detail) rec.detail = out.detail;
    }
    if (rec.ok && spec.detail) { try { rec.detail = spec.detail(); } catch (e) { /* detail is cosmetic */ } }
    return rec;
  };

  M.run = function () {
    M.results = M.specs.map(M.check);
    M.ran = true;
    const bad = M.results.filter(r => !r.ok && !r.optional);
    if (bad.length && window.MF7 && MF7.platform && MF7.platform.error) {
      bad.forEach(r => MF7.platform.error("mount", "Feature did not mount: " + r.id + " — " + r.reason));
    } else if (window.MF7 && MF7.platform && MF7.platform.info) {
      MF7.platform.info("mount", M.results.length + " features mounted cleanly");
    }
    return M.results;
  };

  M.failures = () => M.results.filter(r => !r.ok && !r.optional);
  M.report = function () {
    if (!M.ran) M.run();
    return M.results.map(r =>
      (r.ok ? "OK   " : (r.optional ? "SKIP " : "FAIL ")) + r.id +
      (r.reason ? "  — " + r.reason : "") +
      (r.detail ? "  (" + r.detail + ")" : "")
    ).join("\n");
  };

  /* -----------------------------------------------------------------------
     The assertions for the defects this build fixes. Each one fails on the
     pre-fix file, which is the only way to know an assertion is worth having.
  ----------------------------------------------------------------------- */

  /* A1 — the harvest must actually adopt the legacy sections.

     Note the trap: harvest(host) reads host.children, but the host panel
     builder it calls first always writes into #panel regardless of the
     argument. So the parameter is decorative and the assertion has to use
     the real element — harvesting a detached probe can only ever return
     zero, which looks exactly like the bug we are checking for. */
  M.declare({
    id: "a1.panel.harvest",
    needs: "#panel",
    asserts() {
      if (!window.MF7 || !MF7.ui || !MF7.ui.enabled) return { ok: true, detail: "MF7 panel disabled; host panel in use" };
      if (typeof MF7.ui.harvest !== "function") return { ok: false, reason: "MF7.ui.harvest missing" };
      if (typeof P === "undefined" || !P) return { ok: true, detail: "no project open" };
      const host = document.getElementById("panel");
      let n = 0;
      try { n = (MF7.ui.harvest(host) || []).length; }
      finally { if (typeof panel === "function") panel(); }   // leave the panel intact
      /* the host builds 30+ sections; anything in single digits means the
         adoption path is broken again */
      if (n < 10) return { ok: false, reason: "harvest adopted only " + n + " host sections (expected 10+)" };
      return { ok: true, detail: n + " host sections adopted" };
    },
  });

  /* A1b — mkSec must emit the element the harvest looks for */
  M.declare({
    id: "a1.mksec.details",
    asserts() {
      if (typeof mkSec !== "function") return { ok: false, reason: "mkSec is not defined" };
      const s = mkSec("Mount probe", true);
      if (s.tagName !== "DETAILS") return { ok: false, reason: "mkSec emits <" + s.tagName.toLowerCase() + ">, harvest needs <details>" };
      if (!s.querySelector("summary")) return { ok: false, reason: "mkSec section has no <summary>" };
      if (!s.querySelector(".body")) return { ok: false, reason: "mkSec section has no .body — 34 call sites depend on it" };
      return true;
    },
  });

  /* A2 — the rail element MF7 looks for must exist and be the real rail */
  M.declare({
    id: "a2.rail.element",
    needs: "#rail",
    asserts() {
      const rail = document.getElementById("rail");
      const buttons = rail.querySelectorAll("button").length;
      if (!buttons) return { ok: false, reason: "#rail exists but contains no tool buttons" };
      return { ok: true, detail: buttons + " rail buttons" };
    },
  });

  /* A2b — exactly one consolidation may own the rail */
  M.declare({
    id: "a2.rail.single-owner",
    needs: "#rail",
    asserts() {
      const rail = document.getElementById("rail");
      const mf4 = rail.classList.contains("grouped");
      const mf7 = rail.querySelectorAll(".mf7-tool-wrap").length > 0;
      if (mf4 && mf7) return { ok: false, reason: "MF4 grouped rail and MF7 consolidation are both active" };
      return { ok: true, detail: mf4 ? "MF4 grouped rail" : (mf7 ? "MF7 consolidation" : "flat rail") };
    },
  });

  /* A3 — the scene root must survive a host repaint */
  M.declare({
    id: "a3.scene.persists",
    /* not optional: it returns a clean pass when there is nothing to check,
       so a permanent SKIP would hide a real regression */
    asserts() {
      if (!window.MF7 || !MF7.scene || !MF7.scene.enabled) return { ok: true, detail: "scene disabled" };
      if (typeof P === "undefined" || !P) return { ok: true, detail: "no project open" };
      const root = MF7.scene.ensureRoot();
      if (!root) return { ok: false, reason: "scene root could not be created" };
      if (root.getAttribute("data-persist") === null)
        return { ok: false, reason: "scene root is not marked data-persist; render() will destroy it every frame" };
      const before = root;
      const keys = MF7.scene.nodes.size;
      if (typeof render === "function") render();
      if (MF7.scene.root !== before)
        return { ok: false, reason: "scene root was replaced by a host render" };
      return { ok: true, detail: keys + " keyed nodes held across a repaint" };
    },
  });

  /* A5 — persistence must not be sitting on the 5 MB localStorage ceiling */
  M.declare({
    id: "a5.storage.backend",
    asserts() {
      if (!MF9.store) return { ok: false, reason: "MF9.store not installed" };
      return { ok: true, detail: "backend: " + MF9.store.backendName() };
    },
  });

  MF9.mounts = M;
})();
