// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 227625989; external dependencies are not included.
function lme(e, n, r, s) {
  if (s !== void 0)
    return HYe(
      e,
      s.effectiveWindow,
      {
        enabled: s.enabled,
        precomputeBufferFraction: _Se,
        testPctOverride: void 0,
        testBlockingOverride: void 0,
      },
      aTr(n),
      s.threshold,
    );
  let h = kSe(n, r),
    y = h.enabled ? r : void 0;
  return HYe(e, VX(n, y), h, aTr(n));
}
