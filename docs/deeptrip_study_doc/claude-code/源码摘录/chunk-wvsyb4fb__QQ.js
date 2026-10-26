// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 227618344; external dependencies are not included.
function QQ(e, n) {
  let r = e - 13000,
    s = n.testPctOverride;
  if (s !== void 0 && !isNaN(s) && s > 0 && s <= 100) return Math.min(Math.floor(e * (s / 100)), r);
  return r;
}
