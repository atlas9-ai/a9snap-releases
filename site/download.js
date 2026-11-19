/* The version text on the page follows the newest Dev build, with no site redeploy.
 *
 * index.html ships a static "Free · Windows 10 and 11 · v…" line and a static footer version, both written by the build
 * from the app's own version. This script only ever RAISES them from the Dev channel manifest, the same file the app's
 * update check reads: a manifest newer than the page's version replaces the version; one with the same version or an
 * older one changes nothing. If the fetch fails, or the manifest is not what we expect, nothing changes. It never touches
 * a link: the installer button ([data-dl], on the install page) points at the license server's /download/snap/go, which
 * counts the click and redirects to the newest installer (js/track.js tags it).
 *
 * Marked in the page: [data-dl-meta] (an element: its text), [data-ver] (the footer's "v0.3.2" badge).
 * A plain script (no module system): it runs itself on load and leaves its functions on self.a9download for
 * site/download.test.mjs, which runs it in a sandbox.
 */
(function (root, factory) {
  var api = factory();
  root.a9download = api;
  api.run(root.document, root.fetch && root.fetch.bind(root));
})(self, function () {
  // raw.githubusercontent.com answers with Access-Control-Allow-Origin: *, so a9snap.com may read it. (Pages does
  // not serve channels/ on this domain, and a copy there would go stale.)
  var MANIFEST = "https://raw.githubusercontent.com/atlas9-ai/a9snap-releases/main/channels/dev.json";
  // Only trust a manifest that points at a release of our own releases repo.
  var RELEASE = /^(https:\/\/github\.com\/atlas9-ai\/a9snap-releases\/releases\/download\/v\d+\.\d+\.\d+[0-9A-Za-z.-]*\/)[^/]+$/;
  var VERSION = /^\d+\.\d+\.\d+[0-9A-Za-z.-]*$/;

  // "0.13.6" or "v0.13.6-beta" to [0, 13, 6], or null when it does not start like a version.
  function parts(v) {
    var m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || ""));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }

  // 1 when a is a newer version than b, 0 when the numbers are equal, -1 when older, null when either can't be read.
  function compare(a, b) {
    var x = parts(a), y = parts(b);
    if (!x || !y) return null;
    for (var i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
    return 0;
  }

  // The manifest to { text, version }, or null when it is not usable.
  function describe(manifest) {
    try {
      var p = manifest.platforms["windows-x86_64"];
      var rel = RELEASE.exec(p.url);
      if (!rel || !VERSION.test(manifest.version)) return null;
      return { text: "Free · Windows 10 and 11 · v" + manifest.version, version: "v" + manifest.version };
    } catch (e) {
      return null;
    }
  }

  // Fetches the manifest and upgrades the page. Resolves true when it did, false when it left the page as it was.
  function run(doc, fetchFn, url) {
    if (!doc || !fetchFn) return Promise.resolve(false);
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 6000) : null;
    return fetchFn(url || MANIFEST, { cache: "no-cache", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (manifest) {
        var d = describe(manifest);
        if (!d) return false;
        var changed = false;
        // The version line: a newer version replaces it; the same, older or unreadable is left alone.
        Array.prototype.forEach.call(doc.querySelectorAll("[data-dl-meta]"), function (el) {
          var shown = /v\d+\.\d+\.\d+[0-9A-Za-z.-]*/.exec(el.textContent);
          var c = shown ? compare(manifest.version, shown[0]) : null;
          if (c === 1) { el.textContent = d.text; changed = true; }
        });
        Array.prototype.forEach.call(doc.querySelectorAll("[data-ver]"), function (el) {
          if (compare(manifest.version, el.textContent) === 1) { el.textContent = d.version; changed = true; }
        });
        return changed;
      })
      .catch(function () { return false; })
      .then(function (ok) { if (timer) clearTimeout(timer); return ok; });
  }

  return { MANIFEST: MANIFEST, describe: describe, compare: compare, run: run };
});
