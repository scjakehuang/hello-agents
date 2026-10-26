// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 227643609; external dependencies are not included.
function Ien(e) {
  if (!dme(e) || !e.errorDetails) return;
  let { actualTokens: n, limitTokens: r } = h8e(e.errorDetails);
  if (n === void 0 || r === void 0) return;
  let s = n - r;
  return s > 0 ? s : void 0;
}
