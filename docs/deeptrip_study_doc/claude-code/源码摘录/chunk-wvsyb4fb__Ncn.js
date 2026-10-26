// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228663266; external dependencies are not included.
function Ncn(e, n, r, s) {
  let h = oc(r),
    y = ff() ? s : void 0,
    { window: b, source: w } = mb(h, y);
  if (w === "auto") return;
  return {
    thresholdTokens: Az(h, y),
    windowTokens: b,
    liveTokens: qf(n, h.bytesPerToken) + F1e(n),
    madeFromTokens: e.preCompactTokens,
    summary: e.result.summaryMessages,
    sizeOf: (H) => Og(H, h.bytesPerToken),
  };
}
