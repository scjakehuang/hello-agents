// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228508177; external dependencies are not included.
function xur(e) {
  let n = yXe(e),
    r = e.findLastIndex((s, h) => h >= n && kXe(s));
  return r === -1
    ? { toSummarize: e, toKeep: [] }
    : { toSummarize: e.slice(0, r), toKeep: e.slice(r) };
}
