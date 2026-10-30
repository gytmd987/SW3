/* Builds puzzles off the main thread, so the page stays responsive while a hard one is being made. */
const v = self.location.search;
importScripts("engines/rng.js" + v, "engines/stars.js" + v, "engines/code.js" + v);
const ENGINES = { stars: self.Stars, code: self.Code };
self.onmessage = e => {
  const { game, level, seed } = e.data;
  try { self.postMessage({ ok: true, puzzle: ENGINES[game].generate(level, seed) }); }
  catch (err) { self.postMessage({ ok: false, error: String(err) }); }
};
