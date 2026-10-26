// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 227643435; external dependencies are not included.
function h8e(e) {
  let n = e.match(/prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i);
  return {
    actualTokens: n ? parseInt(n[1], 10) : void 0,
    limitTokens: n ? parseInt(n[2], 10) : void 0,
  };
}
