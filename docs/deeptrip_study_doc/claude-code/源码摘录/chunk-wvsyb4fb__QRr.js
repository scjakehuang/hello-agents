// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228633023; external dependencies are not included.
async function QRr(e, n, r, s, h) {
  let { customInstructions: y } = h ?? {},
    {
      isAutoCompact: b = !1,
      recompactionInfo: w,
      stripNonEssential: H = !1,
      spinnerHintText: q,
      onNotification: K,
      onResponseLength: Q,
    } = h ?? {},
    Se = b ? "compact_auto" : "compact_manual",
    be = FV(),
    we,
    ve,
    Ee,
    Me = performance.now(),
    xe = PKn("claude_code.compaction", {
      spanType: "compaction",
      attrs: { trigger: b ? "auto" : "manual", message_count: e.length },
    });
  try {
    if (e.length === 0) throw (m(Se, "compact_not_enough_messages"), Error(lve));
    ve = qf(e);
    let $e = n.getAppState();
    (fnn(ce(n), "summary"),
      n.onCompactEvent?.({
        type: "compact_progress",
        event: { type: "hooks_start", hookType: "pre_compact" },
      }),
      n.onCompactEvent?.({ type: "sdk_status", status: "compacting" }));
    let Ge = await nOe(
      n.session,
      { trigger: b ? "auto" : "manual", customInstructions: y ?? null },
      n,
      n.abortController.signal,
    );
    (fcn(Ge, K, { suppressNotification: b }), (y = ypt(y, Ge.newCustomInstructions)));
    let Ye = Ge.userDisplayMessage;
    (n.onCompactEvent?.({ type: "stream_mode", mode: "requesting" }),
      Q?.({ type: "response_length", op: "reset" }),
      n.onCompactEvent?.({
        type: "compact_progress",
        event: { type: "compact_start", hintText: q },
      }));
    let it = !H && k("tengu_compact_cache_prefix", !0),
      at = Zwe(),
      mt = Vve(n),
      lt = Xwe(y, at, mt !== void 0),
      kt = Pe({ content: lt }),
      xt = e,
      ft = r,
      St,
      Wt,
      Gt = 0;
    for (;;) {
      let Vn = await hcn({
        messages: xt,
        summaryRequest: kt,
        appState: $e,
        context: n,
        preCompactTokenCount: ve,
        cacheSafeParams: ft,
        stripNonEssential: H,
        onResponseLength: Q,
        compactionRequestKind: b ? "auto" : "manual",
      });
      if (((St = Vn.response), (Wt = eN(St)), !Wt?.startsWith(R1))) break;
      Gt++;
      let fo =
        Gt <= JZ && n.compactionApiAttemptsLeft?.count !== 0 ? ccn(xt, St, Vn.mediaStripped) : null;
      if (!fo)
        throw (
          i("tengu_compact_failed", {
            reason: S("prompt_too_long"),
            preCompactTokenCount: ve,
            promptCacheSharingEnabled: it,
            ptlAttempts: Gt,
          }),
          m(Se, "compact_prompt_too_long"),
          Error(tee)
        );
      (i("tengu_compact_ptl_retry", {
        attempt: Gt,
        droppedMessages: xt.length - fo.length,
        remainingMessages: fo.length,
      }),
        (xt = fo),
        (ft = { ...ft, forkContextMessages: fo }));
    }
    if (!Wt)
      throw (
        t(`Compact failed: no summary text in response. Response: ${_(St)}`, { level: "error" }),
        i("tengu_compact_failed", {
          reason: S("no_summary"),
          preCompactTokenCount: ve,
          promptCacheSharingEnabled: it,
        }),
        m(Se, "compact_no_summary"),
        new a9(
          "Failed to generate conversation summary - response did not contain valid text content",
        )
      );
    else if (St.isApiErrorMessage || ste(Wt))
      throw (
        i("tengu_compact_failed", {
          reason: S("api_error"),
          errorPrefix: ycn(St),
          status: St.apiErrorStatus,
          preCompactTokenCount: ve,
          promptCacheSharingEnabled: it,
        }),
        m(Se, "compact_api_error"),
        Je(new a9(Wt), "compactConversation: api_error (summary text redacted)")
      );
    Kve({
      path: "full",
      reply: Wt,
      sent: xt,
      outputTokens: NH(St)?.output_tokens,
      stopReason: St.message.stop_reason,
    });
    let on = y5n(n.readFileState);
    (n.readFileState.clear(), JK(n.memorySelector));
    let { attachments: Kt, hookResults: bn } = await Yve(
        on,
        n,
        [],
        "compact_full",
        e,
        iT(w?.querySource, n.agentId),
      ),
      Bn = Math.round(performance.now() - Me),
      rn = d2(b ? "auto" : "manual", ve ?? 0, e.at(-1)?.uuid),
      cn = n9(e, { surfaced: (n.stickyBetas ?? ws()).surfacedOnWire });
    if (cn.size > 0) rn.compactMetadata.preCompactDiscoveredTools = [...cn].sort();
    NJ(rn, n.agentId, n.getAppState());
    let no = [
        Pe({
          ...QZ(Wt, {
            suppressFollowUpQuestions: s,
            promptArm: at,
            transcriptPath: mt,
            ...!1,
            headTruncated: Gt > 0,
            foreignArtifactContent: tpt(e),
            toolNamesUsed: VZ(e),
          }),
          isCompactSummary: !0,
          isVisibleInTranscriptOnly: !0,
        }),
      ].map((Vn) => F3(Vn, e)),
      ao = rte([St]),
      To = Og([rn, ...no, ...Kt, ...bn]);
    ((rn.compactMetadata.postTokens = To),
      (rn.compactMetadata.durationMs = Bn),
      tK(rn, e),
      (Ee = To));
    let dn = NH(St),
      wo = Xy(n.options.mainLoopModel, Ng(n), Yy(n.permissionLayers));
    if (
      (i("tengu_compact", {
        preCompactTokenCount: ve,
        stripNonEssential: H,
        postCompactTokenCount: ao,
        truePostCompactTokenCount: To,
        autoCompactThreshold: w?.autoCompactThreshold ?? -1,
        willRetriggerNextTurn: w !== void 0 && To >= w.autoCompactThreshold,
        isAutoCompact: b,
        ptlAttempts: Gt,
        ...(wo && { effort_level: c(wo) }),
        querySource: us(w?.querySource ?? n.options.querySource ?? "unknown"),
        queryChainId: ye(n.queryTracking?.chainId) ?? S(""),
        queryDepth: n.queryTracking?.depth ?? -1,
        isRecompactionInChain: w?.isRecompactionInChain ?? !1,
        turnsSincePreviousCompact: w?.turnsSincePreviousCompact ?? -1,
        previousCompactTurnId: ye(w?.previousCompactTurnId || void 0) ?? S(""),
        compactionInputTokens: dn?.input_tokens,
        compactionOutputTokens: dn?.output_tokens,
        compactionCacheReadTokens: dn?.cache_read_input_tokens ?? 0,
        compactionCacheCreationTokens: dn?.cache_creation_input_tokens ?? 0,
        compactionTotalTokens: dn
          ? dn.input_tokens +
            (dn.cache_creation_input_tokens ?? 0) +
            (dn.cache_read_input_tokens ?? 0) +
            dn.output_tokens
          : 0,
        promptCacheSharingEnabled: it,
        summaryPromptArm: c(at),
        ...(() => {
          try {
            return ZSe(JSe(e));
          } catch (Vn) {
            return (l(Vn), {});
          }
        })(),
      }),
      Tun(n.agentId),
      Sre(w?.querySource))
    )
      (await yrn(n.storageV5), fVt(Ee ?? 0));
    n.onCompactEvent?.({
      type: "compact_progress",
      event: { type: "hooks_start", hookType: "post_compact" },
    });
    let Xn = await $Ht(
        n.session,
        { trigger: b ? "auto" : "manual", compactSummary: Wt },
        n,
        n.abortController.signal,
      ),
      to = [Ye, Xn.userDisplayMessage].filter(Boolean).join(`
`);
    if (Gt > 0) p(Se, "compact_head_dropped");
    else g(Se);
    if (es(w?.querySource ?? n.options.querySource) === "main") SJ("compact");
    if (iT(w?.querySource, n.agentId)) (Qwn(b ? "auto" : "manual"), S9(be));
    return {
      boundaryMarker: rn,
      summaryMessages: no,
      messagesToKeep: [],
      attachments: Kt,
      hookResults: bn,
      userDisplayMessage: to || void 0,
      preCompactTokenCount: ve,
      postCompactTokenCount: ao,
      truePostCompactTokenCount: To,
      compactionUsage: dn,
      ptlAttempts: Gt,
      promptCacheSharingEnabled: it,
    };
  } catch ($e) {
    if (((we = $e instanceof Error ? $e.message : "compaction failed"), !b)) mcn($e, K);
    throw $e;
  } finally {
    if (
      (n.onCompactEvent?.({ type: "stream_mode", mode: "requesting" }),
      Q?.({ type: "response_length", op: "reset" }),
      n.onCompactEvent?.({ type: "compact_progress", event: { type: "compact_end" } }),
      RGe({
        trigger: b ? "auto" : "manual",
        success: !we,
        durationMs: performance.now() - Me,
        preTokens: ve,
        postTokens: Ee,
        error: we,
      }),
      xe)
    ) {
      if (
        (AKn(xe, {
          ...(ve !== void 0 && { pre_compact_tokens: ve }),
          ...(Ee !== void 0 && { post_compact_tokens: Ee }),
          success: !we,
        }),
        we)
      )
        mFt(xe, we);
      xe.end();
    }
    n.onCompactEvent?.({
      type: "sdk_status",
      status: null,
      metadata: { compactResult: we ? "failed" : "success", ...(we && { compactError: we }) },
    });
  }
}
