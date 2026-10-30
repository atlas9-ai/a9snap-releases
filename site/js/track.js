/* The website's own count of where visits come from, on every page of a9snap.com. Nothing here runs in the app.
 *
 * What it does, with no cookies and no IDs:
 *  - keeps the first page's UTMs, the first external referrer's host and the landing path for the tab session
 *    (sessionStorage; gone when the tab closes) and sends ONE `visit` beacon to the license server's /e endpoint;
 *  - tags the installer links ([data-dl], which go through /download/snap/go there) with those facts;
 *  - tags the Microsoft Store links ([data-store]) with a campaign id (cid), so the Store's own acquisitions report
 *    can be read by it, and sends a `store_click` beacon when one is clicked (the navigation is never delayed);
 *  - the internal switch: ?a9v-internal=1 once per browser (=0 clears it) marks this browser's visits int=1,
 *    so the owner's own visits are marked, not counted.
 * It never throws and never blocks the page (it is deferred, and every step is guarded). The same rules as
 * A9 Voice's js/chrome.js, so one Worker reads both sites.
 *
 * A plain script (no module system): it runs itself on load and leaves its pure functions on self.a9track for
 * site/track.test.mjs, which runs it in a sandbox.
 */
(function (root, factory) {
  var api = factory();
  root.a9track = api;
  try { api.run(root); } catch (e) { /* a broken browser must never break the page */ }
})(self, function () {
  "use strict";

  var ENDPOINT = "https://a9voice.com/e";
  var OWN = /(^|\.)a9snap\.com$/;
  var KEY = "a9s-campaign";
  var SWITCH = "a9v-internal";
  var KEYS = ["src", "med", "ct", "cmp", "ref", "land"];

  // Tags are lower case a-z 0-9 _ . : - and 1 to 40 long; anything else is dropped (the Worker drops it too).
  function tag(v) {
    v = String(v == null ? "" : v).trim().toLowerCase();
    return /^[a-z0-9_.:-]{1,40}$/.test(v) ? v : "";
  }

  // Lower case, runs of anything but a-z 0-9 become one "-", trimmed of "-".
  function sanitize(v) {
    return String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  // The Store's campaign id: source, then "_" and the campaign when there is one; "direct" with no source. At most 60 long.
  // Built from the tags the beacon carries, so the id the Store reports is the id the visit rows show.
  function cid(seen) {
    seen = seen || {};
    var s = sanitize(seen.src) || "direct";
    var c = sanitize(seen.cmp);
    return (c ? s + "_" + c : s).slice(0, 60).replace(/[-_]+$/, "");
  }

  // The first external referrer's host (not a9snap.com), or "".
  function refHost(referrer) {
    var h = "";
    try { h = new URL(referrer).hostname.toLowerCase().slice(0, 60); } catch (e) { h = ""; }
    return /^[a-z0-9.-]+$/.test(h) && !OWN.test(h) ? h : "";
  }

  function landPath(pathname) {
    var p = String(pathname || "/").toLowerCase();
    return /^\/[a-z0-9/_.~%-]*$/.test(p) ? p.slice(0, 60) : "";
  }

  // What the first page of a session knows about the visit.
  function capture(search, referrer, pathname) {
    var q = new URLSearchParams(search || "");
    return {
      src: tag(q.get("utm_source")), med: tag(q.get("utm_medium")), ct: tag(q.get("utm_content")), cmp: tag(q.get("utm_campaign")),
      ref: refHost(referrer), land: landPath(pathname)
    };
  }

  // The query tags for a beacon or a link: the visit's facts, int=1 for an internal browser, dv=ios for iPadOS asking as a Mac.
  function tags(seen, flags) {
    var p = new URLSearchParams();
    KEYS.forEach(function (k) { if (seen && seen[k]) p.set(k, seen[k]); });
    if (flags && flags.internal) p.set("int", "1");
    if (flags && flags.ipad) p.set("dv", "ios");
    return p;
  }

  // The beacon's address for an event; `extra` (e.g. { pl: "hero" }) rides along, tag-checked.
  function beaconUrl(ev, seen, flags, extra) {
    var p = tags(seen, flags);
    p.set("product", "a9snap");
    if (extra && extra.pl) { var pl = tag(extra.pl); if (pl) p.set("pl", pl); }
    return ENDPOINT + "?ev=" + ev + "&" + p.toString();
  }

  // An installer link with the visit's tags added (its own pl stays).
  function dlHref(href, seen, flags) {
    var u = new URL(href);
    tags(seen, flags).forEach(function (v, k) { u.searchParams.set(k, v); });
    return u.toString();
  }

  // A Store link with the campaign id.
  function storeHref(href, seen) {
    var u = new URL(href);
    u.searchParams.set("cid", cid(seen));
    return u.toString();
  }

  // The session's stored facts and whether this is its first page: { seen, first }. `store` is sessionStorage or
  // anything shaped like it. When the facts can't be stored (private mode) first is false: sending a visit on every
  // page would count one person many times.
  function session(store, make) {
    var seen = null;
    try { seen = JSON.parse(store.getItem(KEY) || "null"); } catch (e) { seen = null; }
    if (seen && typeof seen === "object") return { seen: seen, first: false };
    seen = make();
    try { store.setItem(KEY, JSON.stringify(seen)); } catch (e) { return { seen: seen, first: false }; }
    return { seen: seen, first: true };
  }

  function send(win, url) {
    try { if (win.navigator && win.navigator.sendBeacon && win.navigator.sendBeacon(url)) return; } catch (e) { /* fall through */ }
    try { new win.Image().src = url; } catch (e) { /* nothing to do */ }
  }

  function run(win) {
    var doc = win && win.document;
    if (!doc || !win.location) return false;
    var ua = (win.navigator && win.navigator.userAgent) || "";
    var flags = { internal: false, ipad: /Macintosh/.test(ua) && win.navigator.maxTouchPoints > 1 };
    var sw = new URLSearchParams(win.location.search).get("a9v-internal");
    try {
      if (sw === "1") win.localStorage.setItem(SWITCH, "1");
      else if (sw === "0") win.localStorage.removeItem(SWITCH);
      flags.internal = win.localStorage.getItem(SWITCH) === "1";
    } catch (e) { flags.internal = sw === "1"; }
    if (flags.internal) {
      var foot = doc.querySelector("footer .wrap");
      if (foot) {
        var chip = doc.createElement("span");
        chip.className = "mono";
        chip.textContent = "Internal: not counted";
        chip.style.color = "#9A9DA4";
        foot.appendChild(chip);
      }
    }

    var s = session(win.sessionStorage, function () { return capture(win.location.search, doc.referrer, win.location.pathname); });
    var seen = s.seen;

    Array.prototype.forEach.call(doc.querySelectorAll("a[data-dl]"), function (a) {
      try { a.href = dlHref(a.href, seen, flags); } catch (e) { /* the static link stays */ }
    });
    Array.prototype.forEach.call(doc.querySelectorAll("a[data-store]"), function (a) {
      try { a.href = storeHref(a.href, seen); } catch (e) { /* the static link stays */ }
    });

    if (s.first) send(win, beaconUrl("visit", seen, flags));

    // A click on a Store badge: one store_click with the badge's placement. The link goes on as it is; sendBeacon
    // outlives the page leaving. Delegated, so a badge added later counts too.
    doc.addEventListener("click", function (e) {
      try {
        if (e.button > 0) return;
        var a = e.target && e.target.closest ? e.target.closest("a[data-store]") : null;
        if (a) send(win, beaconUrl("store_click", seen, flags, { pl: a.getAttribute("data-pl") }));
      } catch (err) { /* never get in the way of the link */ }
    });
    return true;
  }

  return { ENDPOINT: ENDPOINT, tag: tag, sanitize: sanitize, cid: cid, refHost: refHost, landPath: landPath, capture: capture, tags: tags, beaconUrl: beaconUrl, dlHref: dlHref, storeHref: storeHref, session: session, run: run };
});
