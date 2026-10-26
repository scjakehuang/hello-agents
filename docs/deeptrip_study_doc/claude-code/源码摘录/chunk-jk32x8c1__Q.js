// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 224515000; external dependencies are not included.
async function Q(e, n, r, s, a) {
  let o = e.content;
  if (LIo(o))
    return (
      i("tengu_tool_empty_result", { toolName: Dn(n) }),
      { ...e, content: `(${n} completed with no output)` }
    );
  if (!o) return e;
  let l = s ?? IZs;
  if (!NIo(o, l)) return e;
  let u = await H9(o, e.tool_use_id, r, a);
  if (D9(u)) {
    if (tS() !== void 0) {
      let f = uHr(o, l);
      if (f === null) return e;
      return (
        i("tengu_tool_result_persisted", {
          toolName: Dn(n),
          originalSizeBytes: f.originalSize,
          persistedSizeBytes: f.message.length,
          estimatedOriginalTokens: Math.ceil(f.originalSize / u6e),
          estimatedPersistedTokens: Math.ceil(f.message.length / u6e),
          thresholdUsed: l,
          stored: !1,
        }),
        { ...e, content: f.message }
      );
    }
    return e;
  }
  let h = gMe(u);
  return (
    i("tengu_tool_result_persisted", {
      toolName: Dn(n),
      originalSizeBytes: u.originalSize,
      persistedSizeBytes: h.length,
      estimatedOriginalTokens: Math.ceil(u.originalSize / u6e),
      estimatedPersistedTokens: Math.ceil(h.length / u6e),
      thresholdUsed: l,
      truncatedAtCap: u.truncatedAtBytes !== void 0,
    }),
    { ...e, content: h }
  );
}
