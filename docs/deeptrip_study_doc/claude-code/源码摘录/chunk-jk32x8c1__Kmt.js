// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 224515913; external dependencies are not included.
function Kmt(e, n) {
  if (e.length <= n) return { preview: e, hasMore: !1 };
  let s = e.slice(0, n).lastIndexOf(`
`),
    a = s > n * 0.5 ? s : n;
  return { preview: e.slice(0, a), hasMore: !0 };
}
