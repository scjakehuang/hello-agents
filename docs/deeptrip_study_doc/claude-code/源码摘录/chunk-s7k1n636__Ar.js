// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 216937453; external dependencies are not included.
function Ar(
  { thresholdTokens: e, windowTokens: t, liveTokens: o, madeFromTokens: r, summary: i, sizeOf: s },
  a,
  l,
) {
  let d = new Set(l.map((g) => g.uuid)),
    p = new Set(a.map((g) => g.uuid)),
    y = a.filter((g) => !d.has(g.uuid)),
    u = a.filter((g) => d.has(g.uuid)),
    f = l.filter((g) => !p.has(g.uuid)),
    h = Math.max(o - s(y), s(u)) + s([...i, ...f]);
  return {
    sizes: { postSwapTokens: h, thresholdTokens: e, windowTokens: t },
    givesWay: h >= e && r < t,
  };
}
