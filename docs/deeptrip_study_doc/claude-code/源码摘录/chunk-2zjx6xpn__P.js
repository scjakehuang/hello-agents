// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 242175849; external dependencies are not included.
async function P(e, n, o, s) {
  let d = Og(e),
    r = await KKs(e, n, { keepRecent: _, persist: (R, A) => H(R, A, o), agentId: s }),
    u = r ? r.messages : e,
    a = Og(u);
  return (
    t(`[CONTEXT_HINT_REJECT] mc=${!!r} tokensSaved=${r?.tokensSaved ?? 0}`),
    {
      messages: u,
      clearedIds: r?.clearedIds ?? I,
      clearedContent: r?.clearedContent ?? x,
      applied: { mcApplied: !!r, mcTokensSaved: r?.tokensSaved ?? 0 },
      preCompactTokenEstimate: d,
      postCompactTokenEstimate: a,
    }
  );
}
