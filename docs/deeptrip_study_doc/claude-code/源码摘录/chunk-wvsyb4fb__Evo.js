// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228681563; external dependencies are not included.
function Evo(e) {
  if (e.autocompactRan) return !1;
  if (e.isPreFirstCompactFork) return !1;
  if (e.hasAttemptedReactiveCompact) return !1;
  if (e.lastTransitionReason === "precomputed_compact_swap") return !1;
  if (!EBe()) return !1;
  return I5t(
    e.contextTokens,
    e.facts,
    e.autoCompactWindow,
    e.querySource,
    e.messagesCounted ? F1e(e.messagesCounted) : 0,
  );
}
