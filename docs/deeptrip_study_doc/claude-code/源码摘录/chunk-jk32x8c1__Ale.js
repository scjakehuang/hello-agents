// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 224510990; external dependencies are not included.
function Ale(e, n, r = FD, s = !1) {
  if (!Number.isFinite(n)) return n;
  if (s) return Math.min(n, r);
  let o = k(Z, {})?.[e];
  if (typeof o === "number" && Number.isFinite(o) && o > 0) return o;
  return Math.min(n, r);
}
