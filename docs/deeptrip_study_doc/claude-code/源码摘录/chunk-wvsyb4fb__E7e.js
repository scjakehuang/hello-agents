// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228628536; external dependencies are not included.
function E7e(e) {
  if (typeof e === "string") return ucn(e);
  if (Array.isArray(e)) {
    let n = e.map(E7e);
    return n.some((r, s) => r !== e[s]) ? n : e;
  }
  if (typeof e === "object" && e !== null) {
    let n = e,
      r = !1,
      s = {};
    for (let [h, y] of Object.entries(n)) {
      let b = E7e(y);
      if (b !== y) r = !0;
      s[h] = b;
    }
    return r ? s : e;
  }
  return e;
}
