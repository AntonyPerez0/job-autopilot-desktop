// The places the app looks for jobs. Each one turns the user's preferences into
// jobs in one shape (see freehire.js normalize). LinkUp is not here: it closed its
// public job search in 2024 and now sells data to companies only.
import * as freehire from "./freehire.js";
import * as hiringcafe from "./hiringcafe.js";
import * as simplify from "./simplify.js";
import * as google from "./google.js";

export const SOURCES = {
  freehire: { id: "freehire", name: "freehire", search: freehire.search },
  hiringcafe: { id: "hiringcafe", name: "HiringCafe", search: hiringcafe.search, needsBrowser: true },
  simplify: { id: "simplify", name: "Simplify lists", search: simplify.search },
  google: { id: "google", name: "Google Jobs", search: google.search },
};

// prefs.boards: { freehire: true, hiringcafe: true, simplify: false, google: false }
export function enabledSources(prefs) {
  const b = prefs.boards || {};
  return Object.values(SOURCES).filter((s) => b[s.id]);
}
