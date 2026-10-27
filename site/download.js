/* The Download buttons always point at the newest Dev build, with no site redeploy.
 *
 * index.html ships a working static link (the newest release's version-less installer) and a static
 * "Free · Early access · v… · … MB" line. This script only upgrades them from the Dev channel manifest, the same file
 * the app's update check reads. If the fetch fails, or the manifest is not what we expect, nothing changes: the
 * static link stays, so the button is never dead.
 *
 * Marked in the page: [data-dl] (a link: its href), [data-dl-meta] (an element: its text), [data-ver] (the footer's "v0.3.2" badge).
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
  var ASSET = "A9Snap-Setup-x64.exe";
  // Only ever link to a release of our own releases repo, whatever the manifest says.
  var RELEASE = /^(https:\/\/github\.com\/atlas9-ai\/a9snap-releases\/releases\/download\/v\d+\.\d+\.\d+[0-9A-Za-z.-]*\/)[^/]+$/;
  var VERSION = /^\d+\.\d+\.\d+[0-9A-Za-z.-]*$/;

  // The manifest to { href, text }, or null when it is not usable.
  function describe(manifest) {
    try {
      var p = manifest.platforms["windows-x86_64"];
      var rel = RELEASE.exec(p.url);
      if (!rel || !VERSION.test(manifest.version)) return null;
      var text = "Free · Early access · v" + manifest.version;
      var size = manifest.installer_size;
      if (typeof size === "number" && size > 0) text += " · " + (size / 1048576).toFixed(1) + " MB";
      return { href: rel[1] + ASSET, text: text, version: "v" + manifest.version };
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
        Array.prototype.forEach.call(doc.querySelectorAll("[data-dl]"), function (a) { a.href = d.href; });
        Array.prototype.forEach.call(doc.querySelectorAll("[data-dl-meta]"), function (el) { el.textContent = d.text; });
        Array.prototype.forEach.call(doc.querySelectorAll("[data-ver]"), function (el) { el.textContent = d.version; });
        return true;
      })
      .catch(function () { return false; })
      .then(function (ok) { if (timer) clearTimeout(timer); return ok; });
  }

  return { MANIFEST: MANIFEST, describe: describe, run: run };
});
