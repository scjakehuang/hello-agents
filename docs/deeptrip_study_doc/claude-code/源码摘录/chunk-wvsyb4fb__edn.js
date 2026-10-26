// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228507247; external dependencies are not included.
function edn(e, n, r) {
  let s = 0,
    h = 0;
  for (let y = n - 1; y >= 0; y--) if (((s += e[y]), h++, s >= r)) break;
  if (h >= n - 1) return Math.max(1, Math.floor(n / 2));
  return h;
}
