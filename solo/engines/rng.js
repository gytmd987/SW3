/* Seeded random numbers shared by the puzzle generators, so the same seed gives the same puzzle on every device. */
(function (root) {
"use strict";
function hash(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
// mulberry32
function make(seed) {
  let a = hash(String(seed));
  const next = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = n => Math.floor(next() * n);
  const pick = arr => arr[int(arr.length)];
  const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = int(i + 1); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };
  return { next, int, pick, shuffle };
}
const api = { make, hash };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SoloRng = api;
})(typeof self !== "undefined" ? self : this);
