// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228607509; external dependencies are not included.
async function $cr({
  promptMessages: e,
  cacheSafeParams: n,
  ownPrefix: r,
  canUseTool: s,
  querySource: h,
  forkLabel: y,
  overrides: b,
  maxOutputTokens: w,
  maxTurns: H,
  onMessage: q,
  onRequestUsage: K,
  onStreamDelta: Q,
  skipTranscript: Se,
  skipCacheWrite: be,
  skipMessageCacheMarkers: we,
  fallbackModel: ve,
  compactionRequestKind: Ee,
  apiAttemptsLeft: Me,
  thinkingStripPlan: xe,
  advisorStripPlan: $e,
  divergesAtMessageId: Ge,
  toolCallRoutes: Ye,
}) {
  let it = Date.now(),
    at = [],
    mt = null,
    lt = { ...ym },
    {
      userContext: kt,
      systemContext: xt,
      toolUseContext: ft,
      forkContextMessages: St,
      advisorModel: Wt,
      model: Gt,
    } = n,
    on = r?.systemPrompt ?? n.systemPrompt,
    Kt = GRr(ft, {
      ...b,
      isBackgroundAgent: b?.isBackgroundAgent ?? !0,
      memoryCaller: b?.memoryCaller ?? ft.memoryCaller ?? "worker",
      options: b?.options ?? (ve !== void 0 ? { ...ft.options } : void 0),
      ...(Gt !== void 0 && {
        options: { ...(b?.options ?? ft.options), mainLoopModel: Gt },
        permissionLayers: [...(b?.permissionLayers ?? []), { kind: "model", mainLoopModel: Gt }],
      }),
      isolationLatch: b?.isolationLatch ?? {
        current: ft.isolationLatch?.current ?? null,
        exemptServers: ft.isolationLatch?.exemptServers,
      },
      precomputeSourceKey: b?.precomputeSourceKey ?? ft.agentId ?? "main",
      requireCanUseTool: b?.requireCanUseTool ?? !0,
    });
  ((Kt.onPermissionDenial = void 0), (Kt.compactTranscriptUnavailable = !0));
  let bn = Kt.getAppState;
  ((Kt.getAppState = () => {
    let fo = bn();
    return fo.advisorModel === Wt ? fo : { ...fo, advisorModel: Wt };
  }),
    (Kt.getAdvisorSetting = () => Wt));
  let Bn = Mcr({ forkLabel: y, forkContextMessages: St, advisorModel: Wt });
  if (Bn !== void 0 && !e.some(Ocr)) e = [...e, Bn];
  let rn = r === void 0 && St.length > 0;
  if (rn && Kt.options.tools !== ft.options.tools)
    throw Error("runForkedAgent: a fork changed its parent's tools without stating ownPrefix");
  if (Ye !== void 0 && Ye.size > 0) {
    if (!rn)
      throw Error(
        "runForkedAgent: tool call routes need a fork that continues its parent's prefix",
      );
    let fo = ft.options.tools;
    for (let [co, io] of Ye)
      if (!fo.includes(co) || !Lcr(co, io))
        throw Error(
          "runForkedAgent: a tool call route must replace one of the parent's tools with a copy that differs only in call",
        );
    Kt.options = { ...Kt.options, tools: fo.map((co) => Ye.get(co) ?? co) };
  }
  let cn = [...(r === void 0 ? St : Owt(St)), ...e],
    no = zRr(St),
    ao = Se ? void 0 : p_(y),
    To = null;
  if (ao)
    (await BBe(e, ao, void 0, ft.storageV5).catch((fo) =>
      t(`Forked agent [${y}] failed to record initial transcript: ${fo}`),
    ),
      (To = e.at(-1)?.uuid ?? null));
  let dn = H ?? mun,
    wo = 0,
    $n = n.stickyBetas ?? ws(),
    Xn = rn ? Akt($n) : TZt(Wk($n));
  Kt.stickyBetas = Xn;
  let to = !ft.agentId && rn && wc(Kt) === wc(ft) && k("tengu_wild_tome", !1);
  try {
    for await (let fo of Kt.options.runQuery({
      messages: cn,
      systemPrompt: on,
      userContext: kt,
      systemContext: xt,
      canUseTool: s,
      toolUseContext: Kt,
      querySource: h,
      fallbackModel: ve,
      maxOutputTokensOverride: w,
      maxTurns: dn,
      skipCacheWrite: be,
      skipMessageCacheMarkers: we,
      relayFork: to,
      compactionRequestKind: Ee,
      apiAttemptsLeft: Me,
      forkPointUuid: no,
      divergesAtMessageId: Ge,
      thinkingStripPlan: xe,
      advisorStripPlan: $e,
      stickyBetas: Xn,
      agentCacheTtlOverride: n.agentCacheTtlOverride,
    })) {
      if (fMt(fo)) {
        if (
          (Q?.(fo),
          fo.type === "stream_event" && fo.event?.type === "message_delta" && fo.event.usage)
        ) {
          let co = cve({ ...ym }, fo.event.usage);
          ((lt = FHt(lt, co)), K?.(co));
        }
        continue;
      }
      if (fo.type === "tombstone") {
        let co = at.findLastIndex((io) => io.uuid === fo.message.uuid);
        if (co !== -1) at.splice(co, 1);
        continue;
      }
      if (Ywt(fo)) continue;
      if (fo.type === "assistant") wo++;
      if (
        (t(`Forked agent [${y}] received message: type=${fo.type}`),
        at.push(fo),
        (mt = eOe(at, fo, mt, cn)),
        q?.(fo),
        ao &&
          (fo.type === "assistant" ||
            fo.type === "user" ||
            fo.type === "progress" ||
            (fo.type === "attachment" && qw(fo))))
      ) {
        if (
          (await BBe([fo], ao, To, ft.storageV5).catch((co) =>
            t(`Forked agent [${y}] failed to record transcript: ${co}`),
          ),
          fo.type !== "progress")
        )
          To = fo.uuid;
      }
    }
  } finally {
    if (mt) at.push(...mt.preserved);
    if (Kt.agentId)
      try {
        let fo = Kt.agentId;
        (IAr(fo, Kt.taskRegistry), Kt.messageQueue.dequeueAllMatching((co) => co.agentId === fo));
      } catch (fo) {
        t(`[runForkedAgent] shell-task reap failed (continuing teardown): ${fo}`);
      }
    (Kt.readFileState.clear(), (cn.length = 0));
  }
  t(
    `Forked agent [${y}] finished: ${at.length} messages, types=[${at.map((fo) => fo.type).join(", ")}], totalUsage: input=${lt.input_tokens} output=${lt.output_tokens} cacheRead=${lt.cache_read_input_tokens} cacheCreate=${lt.cache_creation_input_tokens}`,
  );
  let Vn = Date.now() - it;
  if (H === void 0 && wo >= mun)
    i("tengu_forked_agent_default_turns_exceeded", {
      forkLabel: c(y),
      querySource: us(h),
      turnCount: wo,
    });
  return (
    Bcr({
      forkLabel: y,
      querySource: h,
      durationMs: Vn,
      messageCount: at.length,
      totalUsage: lt,
      queryTracking: ft.queryTracking,
      relayEligible: to,
    }),
    { messages: at, totalUsage: lt }
  );
}
