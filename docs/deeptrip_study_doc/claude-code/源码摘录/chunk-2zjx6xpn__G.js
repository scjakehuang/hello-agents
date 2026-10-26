// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 242176695; external dependencies are not included.
function G(e) {
  if (!e.includeFirstPartyBetas) return null;
  if (!e.querySource.startsWith("repl_main_thread")) return null;
  let n = c(),
    o = !1,
    s = !1,
    d = !1;
  return {
    active: n,
    buildRequestParams(r) {
      if (((s = !1), !n || o)) return null;
      s = !0;
      let u = JFo(r, _).tokensSaved >= E8n,
        a = m();
      return {
        beta: i6o,
        body: u
          ? { context_hint: { enabled: !0, ...(a > 0 && { target_tokens_saved: a }) } }
          : null,
      };
    },
    async onRequestError(r, u) {
      if (!s || o) return null;
      let a = y(r);
      if (p(r))
        return (
          (o = !0),
          S({
            messages: u,
            querySource: e.querySource,
            agentId: e.agentId,
            requestId: a,
            storageV5: e.storageV5,
          })
        );
      if (T(r)) return ((o = !0), l(a, 400), { messages: u, clearedIds: I, clearedContent: x });
      if (E(r)) return ((o = !0), l(a, 409), null);
      if (e.is529Error(r)) return ((o = !0), l(a, 529), null);
      return null;
    },
    classifyStreamError(r) {
      if (((d = !1), !s || o)) return !1;
      if (!f(r)) return !1;
      return ((d = !0), !0);
    },
    async onStreamFallback(r, u) {
      let a = d;
      if (((o = !0), !a)) return null;
      return S({
        messages: r,
        querySource: e.querySource,
        agentId: e.agentId,
        requestId: u,
        storageV5: e.storageV5,
      });
    },
    strip() {
      o = !0;
    },
  };
}
