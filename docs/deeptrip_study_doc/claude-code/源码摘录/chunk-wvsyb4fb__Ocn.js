// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228661298; external dependencies are not included.
function Ocn(e, n, r, s) {
  let h = (e?.consecutiveFailures ?? 0) + 1;
  if (h >= Dcn)
    (t(
      `autocompact: circuit breaker tripped after ${h} consecutive failures${n ? " (reactive path)" : ""} \u2014 skipping future attempts this session`,
      { level: "warn" },
    ),
      i("tengu_auto_compact_circuit_breaker", {
        consecutiveFailures: h,
        ...(n && { routedThroughReactive: n }),
        ...(r && { thresholdSource: c(r) }),
      }));
  return {
    kind: "failed",
    consecutiveFailures: h,
    routedThroughReactive: n,
    thresholdSource: r,
    compactFailure: s,
  };
}
