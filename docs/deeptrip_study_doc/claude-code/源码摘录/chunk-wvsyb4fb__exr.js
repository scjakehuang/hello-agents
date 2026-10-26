// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228664052; external dependencies are not included.
async function* exr(e, n, r, s, h, y, b, w, H = !1) {
  let { model: q } = r,
    K = n.options.autoCompactWindow;
  if (
    w !== void 0 &&
    h !== void 0 &&
    Sre(h) &&
    n.session.precompute.get(kNe(n.agentId))?.armTrigger === "idle"
  ) {
    let ft = yield* bfr(e, n, r, s, h, y, w);
    if (ft !== void 0) return ft;
  }
  let Q = s.model !== void 0,
    Se = (y?.consecutiveFailures ?? 0) > 0,
    be = Q || Se || !AHs() ? void 0 : Sfr(e, n, r, b),
    we;
  if (be !== void 0) {
    let ft = yield* exr(
      e,
      { ...n, compactionApiAttemptsLeft: { count: 1 } },
      r,
      { ...s, model: be },
      h,
      y,
      b,
      w,
      H,
    );
    if (ft.kind === "compacted") g("compact_larger_model");
    else if (ft.kind === "failed")
      (p("compact_larger_model", ft.compactFailure?.reason ?? "failed"),
        (we = ft.consecutiveFailures));
    if (ft.kind === "compacted" || ft.kind === "hook_blocked" || n.abortController.signal.aborted)
      return ft;
  }
  let ve = Fe(process.env.DISABLE_COMPACT),
    Ee = Svo(h),
    Me = H && !tN(),
    xe = Me ? void 0 : vfr(n, e, Ee && !nBn(h, r, K));
  if (ve) return { kind: "not_needed" };
  if (xe === void 0 && y?.consecutiveFailures !== void 0 && y.consecutiveFailures >= Dcn)
    return { kind: "failure_breaker_open" };
  let $e = xe !== void 0 || (Me && Ee) || (await _fr(e, r, K, h, b, n.queryTracking, Q));
  if (Ee && iT(h, n.agentId)) M5t(n.session, r, K);
  if (!$e) return { kind: "not_needed", consecutiveFailures: we };
  let Ge = hfr(e, r, K, b);
  if (Ge)
    (t(
      `autocompact: fixed prefix ~${Ge.prefixTokens} > threshold ${Ge.thresholdTokens} \u2014 compaction cannot help`,
      { level: "warn" },
    ),
      p("compact_auto", "compact_auto_prefix_overflow"),
      i("tengu_auto_compact_prefix_overflow", { ...Ge, wouldHaveBlocked: !0 }));
  let Ye = lTr(y),
    { consecutiveRapidRefills: it } = Ye;
  if (Ye.action === "trip") {
    if (
      (t(
        `autocompact: rapid-refill breaker tripped \u2014 ${it} consecutive refills within <${D5t} turns each (last was ${y?.turnCounter} turns)`,
        { level: "warn" },
      ),
      p("compact_auto", "compact_auto_rapid_refill_breaker"),
      xe)
    )
      nee(n, xe, { kind: "skipped", reason: "rapid_refill" });
    return { kind: "rapid_refill_breaker_tripped" };
  }
  let at = Eae(r, K),
    mt = u0t(r, K),
    lt = wfr(r, K);
  if (h !== void 0 && (at !== "auto" || xe !== void 0 || Q) && tN()) {
    (t(
      `autocompact: routing through reactive (thresholdSource=${at}${xe ? ", classifier overflow" : ""})`,
    ),
      i("tengu_auto_compact_routed_reactive", {
        thresholdSource: c(at),
        autoCompactWindow: mt.window,
        autoCompactWindowOrigin: c(mt.origin),
        classifierOverflow: xe !== void 0,
      }));
    let ft = performance.now(),
      St = h,
      {
        result: Wt,
        hookBlocked: Gt,
        failure: on,
      } = yield* l0t(async (Kt, bn, Bn) => {
        let rn;
        if (w) {
          let dn = nf(Kt.abortController),
            wo = w6r(dn, ZRr(e), Kt.session.host.clock);
          try {
            rn = await w({
              toolUseContext: { ...Kt, abortController: dn },
              messages: e,
              querySource: St,
              sizingModel: q,
              trigger: "threshold",
              detectedAt: ft,
              onResponseLength: Bn,
            });
          } finally {
            wo.clear();
          }
        }
        let cn = oc(q),
          no = lme(qf(e, cn.bytesPerToken) - (b ?? 0), cn, K).level === "blocked",
          ao = it > 0 && !no && PHs(),
          To = await CWn({
            hasAttempted: !1,
            querySource: St,
            aborted: Kt.abortController.signal.aborted,
            messages: e,
            cacheSafeParams: { ...s, toolUseContext: Kt },
            precomputed: rn?.swap,
            precomputeOutcome: rn?.outcome,
            userWaitStartedAt: ft,
            thresholdSource: at,
            thresholdWindow: mt,
            allowLastResort: no || xe !== void 0,
            keepNoRound: ao,
            spinnerHintText: lt,
            onNotification: bn,
            onResponseLength: Bn,
          });
        if (To.result === null && rn?.emittedEarlyCompactStart)
          (Kt.onCompactEvent?.({ type: "compact_progress", event: { type: "compact_end" } }),
            Kt.onCompactEvent?.({ type: "sdk_status", status: null }));
        return To;
      }, n);
    if (Wt)
      return {
        kind: "compacted",
        result: xe ? Icn(n, xe, Wt) : Wt,
        consecutiveRapidRefills: it,
        thresholdSource: at,
        thresholdWindow: mt,
        routedThroughReactive: !0,
      };
    if (xe)
      nee(
        n,
        xe,
        Gt
          ? { kind: "skipped", reason: "hook_blocked" }
          : on
            ? { kind: "failed", reason: on.reason }
            : n.abortController.signal.aborted
              ? { kind: "skipped", reason: "aborted" }
              : { kind: "skipped", reason: "unavailable" },
      );
    if (Gt) return { kind: "hook_blocked", thresholdSource: at, routedThroughReactive: !0 };
    return Ocn(y, !0, at, on);
  }
  let kt = {
      isRecompactionInChain: y?.compacted === !0,
      turnsSincePreviousCompact: y?.turnCounter ?? -1,
      previousCompactTurnId: y?.turnId,
      autoCompactThreshold: Az(r, K),
      querySource: h,
    },
    xt = yfr();
  try {
    let ft = yield* l0t(
      (St, Wt, Gt) =>
        QRr(e, St, s, !0, {
          isAutoCompact: !0,
          recompactionInfo: kt,
          stripNonEssential: xt,
          spinnerHintText: lt,
          onNotification: Wt,
          onResponseLength: Gt,
        }),
      n,
    );
    return (
      dve(n.session, h, n.setAppState, n.agentId, s.stickyBetas, n.storageV5),
      {
        kind: "compacted",
        result: xe ? Icn(n, xe, ft) : ft,
        consecutiveRapidRefills: it,
        thresholdSource: at,
        thresholdWindow: mt,
        routedThroughReactive: !1,
      }
    );
  } catch (ft) {
    if (d(ft).startsWith(_W)) {
      if (xe) nee(n, xe, { kind: "skipped", reason: "hook_blocked" });
      return { kind: "hook_blocked", routedThroughReactive: !1 };
    }
    let St = iI(ft, IO),
      Wt = xe !== void 0 && iI(ft, lve);
    if (xe)
      nee(n, xe, { kind: "failed", reason: St ? "aborted" : Wt ? "too_few_groups" : "error" });
    if (!St)
      if (xcn(ft) || Wt) t(`autocompact failed: ${d(ft)}`, { level: "error" });
      else l(Je(N(ft), "autocompact: unexpected compactConversation failure"));
    return Ocn(
      y,
      !1,
      void 0,
      !Me
        ? void 0
        : St
          ? { reason: "aborted" }
          : iI(ft, tee)
            ? { reason: "exhausted" }
            : iI(ft, lve)
              ? { reason: "too_few_groups" }
              : { reason: "error", detail: xcn(ft) ? d(ft) : "an internal error" },
    );
  }
}
