// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228689403; external dependencies are not included.
async function kvo(e) {
  let { toolUseContext: n, messages: r, detectedAt: s, borrowFrom: h, querySource: y } = e,
    b = n.session.precompute,
    w = us(y),
    H = (Ge, Ye) => {
      let it = Math.round(performance.now() - s);
      return (
        Wfr(Ge, w, it, e.trigger),
        {
          outcome: Ge,
          swap: Ge.kind === "applied" ? Ge.swap : void 0,
          emittedEarlyCompactStart: Ye,
        }
      );
    },
    q =
      !PWn(y) &&
      (e.trigger === "idle" ||
        (EBe() &&
          (e.trigger === "threshold" ||
            (e.isWithheld413 === !0 && !e.hasAttemptedReactiveCompact))));
  if (q) HHt(b, kNe(n.agentId), y, r, n.options.mainLoopModel, n.storageV5);
  if (e.trigger === "idle") {
    let Ge = DHt(b, n.agentId),
      Ye = gSe() ?? 1 / 0;
    if (Ge?.status !== "ready" || Date.now() < Ye)
      OWn(b, n.agentId, "returned_early", y, n.storageV5);
  }
  if (!q || (e.trigger !== "ptl" && DHt(b, n.agentId) === void 0))
    return { outcome: { kind: "none" }, swap: void 0, emittedEarlyCompactStart: !1 };
  let K = n.abortController.signal,
    Q = (h !== void 0 ? b.get(h) : DHt(b, n.agentId))?.status === "pending";
  if (Q)
    (n.onCompactEvent?.({ type: "stream_mode", mode: "requesting" }),
      e.onResponseLength?.({ type: "response_length", op: "reset" }),
      n.onCompactEvent?.({ type: "compact_progress", event: { type: "compact_start" } }),
      n.onCompactEvent?.({ type: "sdk_status", status: "compacting" }));
  let Se = null,
    be = !1,
    we = Q ? HK(n.onCompactEvent) : void 0;
  try {
    if (h !== void 0) ((Se = await jfr(b, h, K)), (be = Se !== null));
    Se ??= await vvo(b, n.agentId, K, n.storageV5);
  } finally {
    we?.();
  }
  if (Se === null) return H({ kind: "none" }, Q);
  if (Se.kind === "turn_aborted") return H({ kind: "aborted" }, Q);
  if (Se.kind === "failed")
    return H({ kind: "failed", failure: Se.failure, statusAtPTL: Se.statusAtPTL }, Q);
  let { ready: ve } = Se,
    Ee = (Ge, Ye) => {
      if (be) {
        (i("tengu_precompute_borrow_boundary_miss", { querySource: w, reason: c(Ge), ...Ye }),
          t(`precomputed compact: borrow refused (${Ge})`));
        return;
      }
      rxr(ve, Ge, y, Ye);
    },
    Me = ynn(r),
    xe =
      Me === void 0
        ? { kind: "refuse", reason: "rows_unreadable" }
        : bvo(ve, { sent: Me, received: Me }, e.sizingModel, n.options.autoCompactWindow);
  if (xe.kind === "refuse")
    return (
      Ee(xe.reason, xe.reason === "would_not_fit" ? xe.sizes : void 0),
      H({ kind: "none" }, Q)
    );
  let $e = Se.statusAtPTL === "pending" ? "pending" : "ready";
  return H(
    {
      kind: "applied",
      swap: {
        compactResult: ve.result,
        coverage: ve.coverage,
        reportRefused: Ee,
        replacement: ve.replacement === !0,
        preCompactHookDisplay: ve.preCompactHookDisplay,
        statusAtPTL: $e,
        leadMs: s - ve.startedAt,
        totalMs: ve.readyDurationMs,
        borrowed: be,
        rehydrated: ve.rehydrated === !0,
        ...(ve.armTrigger === "idle" && { armTrigger: "idle" }),
        drift: ufn(ve, { messages: r, mainLoopModel: n.options.mainLoopModel }),
        sizes: xe.sizes,
      },
    },
    Q,
  );
}
