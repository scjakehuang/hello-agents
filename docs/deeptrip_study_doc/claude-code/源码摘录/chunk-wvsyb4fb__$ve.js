// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228508761; external dependencies are not included.
async function $ve(e, n, r) {
  let s = gpt(e),
    h = Pur(s),
    y = ZZ(e),
    b = wH(e),
    w = s.length,
    H = tpt(e),
    q = VZ(e);
  if (w < 2)
    return (
      t("Reactive compact: fewer than 2 groups, nothing to compact", { level: "info" }),
      { ok: !1, reason: "too_few_groups", attempts: 0, totalGroups: w }
    );
  let K = r?.keepNoRound === !0 && !s.at(-1)?.some(Xpt) && rAo(),
    Q = K || (r?.allowFallback !== !1 && rAo()),
    Se = n.toolUseContext.abortController.signal,
    be = K ? w : 1,
    we = 0,
    ve = void 0,
    Ee,
    Me = !1,
    xe = !1,
    $e = void 0,
    Ge = null,
    Ye = !1,
    it,
    at;
  if (r?.initialTokenGap !== void 0 && w > 3) {
    Ee = s.map((lt) => Og(lt));
    let mt = r.initialTokenGap - (Ee[w - 1] ?? 0);
    if (mt > 0) {
      let lt = edn(Ee, w - 1, mt);
      ((be = 1 + lt), (ve = { mode: "seeded", step: lt, tokenGap: r.initialTokenGap }));
    }
  }
  while (!0) {
    if (Se.aborted)
      return {
        ok: !1,
        reason: "aborted",
        attempts: we,
        totalGroups: w,
        ...(Ge !== null && { splitKind: "summarize_all", headTruncations: Ge.headTruncations }),
      };
    if (n.toolUseContext.compactionApiAttemptsLeft?.count === 0)
      return { ok: !1, reason: "exhausted", attempts: we, totalGroups: w };
    let mt, lt;
    if (Ge === null) {
      let bn = Math.max(0, w - be);
      if (
        ((mt = s.slice(0, bn).flat()),
        !mt.some((Bn) => Bn.type === "assistant") && !(Ye && bn === 1))
      ) {
        if (!Q)
          return (
            t("Reactive compact: no assistant messages in summarize set, bailing", {
              level: "info",
            }),
            Nve(xe, we),
            { ok: !1, reason: Zln(we), attempts: we, totalGroups: w }
          );
        let { toSummarize: Bn, toKeep: rn } = xur(s.flat()),
          cn = [];
        if ($e?.tokenGap !== void 0) {
          let To = (Ee ??= s.map((dn) => Og(dn)));
          cn.push($e.tokenGap + To.slice($e.summarizeEnd).reduce((dn, wo) => dn + wo, 0));
        }
        if (r?.initialTokenGap !== void 0) cn.push(r.initialTokenGap);
        if (it !== void 0) cn.push(it + Og(rn));
        if (at !== void 0) {
          let To = (Ee ??= s.map((dn) => Og(dn)));
          cn.push(at + To.slice(1).reduce((dn, wo) => dn + wo, 0));
        }
        let no;
        if (cn.length > 0) {
          let To = Math.max(...cn) - Og(rn);
          if (To > 0) no = { tokenGap: To };
        } else if ($e !== void 0) no = { tokenGap: void 0 };
        if (no?.tokenGap !== void 0 && bn === 1 && Jln(s, Math.max(...cn))) {
          ((Ye = !0),
            t(
              `Reactive compact: round ladder exhausted, summarizing the opening round alone first (keeping ${w - 1}/${w} groups); head drop if that yields no summary`,
              { level: "info" },
            ));
          continue;
        }
        let ao = no === void 0 ? pXe(Bn, []) : pXe(Fve(Bn, no.tokenGap, Me), rn);
        if (ao === null)
          return (
            t("Reactive compact: nothing substantive fits in a summarize request, giving up", {
              level: "info",
            }),
            Nve(xe, we),
            {
              ok: !1,
              reason: Zln(we),
              attempts: we,
              totalGroups: w,
              splitKind: "summarize_all",
              headTruncations: 0,
            }
          );
        ((Ge = { toSummarize: ao, toKeep: rn, headTruncations: no === void 0 ? 0 : 1 }),
          (ve = void 0),
          t(
            `Reactive compact: round ladder exhausted, last resort (keeping ${rn.length} trailing messages, head truncations so far: ${Ge.headTruncations})`,
            { level: "info" },
          ));
        continue;
      }
      lt = s.slice(Math.min(h ?? bn, bn)).flat();
    } else ((mt = Ge.toSummarize), (lt = Ge.toKeep));
    let kt = Ge === null ? "round" : "summarize_all",
      xt = Ge?.headTruncations ?? 0,
      ft = Ge === null ? be : 0;
    (we++,
      i("tengu_reactive_compact_attempt", {
        attempt: we,
        groupsToSummarize: Ge === null ? w - be : w,
        groupsToPreserve: ft,
        messagesToSummarize: mt.length,
        strippedMedia: Me,
        stepMode: de(ve?.mode),
        stepSize: ve?.step,
        tokenGap: ve?.tokenGap,
        splitKind: c(kt),
        headTruncations: xt,
        keepNoRound: K,
      }));
    let St = await vur(
        mt,
        n,
        r?.customInstructions,
        Me,
        r?.compactionRequestKind,
        y,
        b,
        xt > 0,
        r?.skipMessageCacheMarkers ?? !1,
        H,
        q,
        r?.onResponseLength,
      ),
      Wt = Ye && Ge === null ? Cur(St, Me) : void 0;
    if (Wt !== void 0) {
      ((be = w),
        t(
          `Reactive compact: attempt ${we} sent the opening round alone and ${Wt}; discarding that outcome, the last resort drops the round from its input instead`,
          { level: "info" },
        ));
      continue;
    }
    if (St.ok) {
      if (xe) i("tengu_compact_credits_clamp_rescue", { outcome: S("ok"), attempts: we });
      return {
        ok: !0,
        result: {
          summaryMessages: St.messages,
          summaryText: St.summaryText,
          messagesToPreserve: lt,
          attempt: we,
          totalUsage: St.totalUsage,
          forkAssistantMessageCount: St.forkAssistantMessageCount,
          promptArm: St.promptArm,
          scopeWarned: St.scopeWarned,
          groupsPreserved: ft,
          totalGroups: w,
          splitKind: kt,
          headTruncations: xt,
        },
      };
    }
    let Gt = Ge === null ? {} : { splitKind: kt, headTruncations: xt };
    switch (St.reason) {
      case "aborted":
        return { ok: !1, reason: "aborted", attempts: we, totalGroups: w, ...Gt };
      case "error":
        return (
          Nve(xe, we),
          {
            ok: !1,
            reason: "error",
            attempts: we,
            totalGroups: w,
            detail: St.detail,
            errorKind: St.errorKind,
            status: St.status,
            isTimeout: St.isTimeout,
            ...(St.isDlpDenied && { isDlpDenied: !0 }),
            ...Gt,
          }
        );
      case "media_too_large":
        if (!Me) {
          ((Me = !0),
            we--,
            t("Reactive compact: summarize hit media-size error, retrying stripped", {
              level: "info",
            }));
          continue;
        }
        return { ok: !1, reason: "media_unstrippable", attempts: we, totalGroups: w, ...Gt };
      case "prompt_too_long":
        break;
    }
    if (St.viaCreditsBoundary) xe = !0;
    if (Ge !== null) {
      if (
        !Ye &&
        Ge.headTruncations === 0 &&
        St.tokenGap !== void 0 &&
        Jln(s, St.tokenGap + Og(Ge.toKeep))
      ) {
        ((Ye = !0),
          (it = St.tokenGap),
          (Ge = null),
          (be = w - 1),
          t(
            `Reactive compact: attempt ${we} hit prompt-too-long on the last resort (gap=${St.tokenGap}), summarizing the opening round alone first (keeping ${w - 1}/${w} groups); head drop if that yields no summary`,
            { level: "info" },
          ));
        continue;
      }
      let bn =
        Ge.headTruncations < JZ ? pXe(Fve(Ge.toSummarize, St.tokenGap, Me), Ge.toKeep) : null;
      if (!bn)
        return (
          t(
            `Reactive compact: last-resort request still too long after ${Ge.headTruncations} head truncations, giving up`,
            { level: "info" },
          ),
          Nve(xe, we),
          {
            ok: !1,
            reason: "exhausted",
            attempts: we,
            totalGroups: w,
            splitKind: kt,
            headTruncations: xt,
          }
        );
      ((Ge = { ...Ge, toSummarize: bn, headTruncations: Ge.headTruncations + 1 }),
        t(
          `Reactive compact: attempt ${we} hit prompt-too-long on the last resort (gap=${St.tokenGap ?? "?"}), truncating head (${Ge.headTruncations}/${JZ})`,
          { level: "info" },
        ));
      continue;
    }
    let on = w - be;
    if (Ye) at = St.tokenGap;
    else $e = { tokenGap: St.tokenGap, summarizeEnd: on };
    Ee ??= s.map((bn) => Og(bn));
    let Kt = Tur(St.tokenGap, Ee, on);
    ((ve = { ...Kt, tokenGap: St.tokenGap }),
      (be += Kt.step),
      t(
        `Reactive compact: attempt ${we} hit prompt-too-long (gap=${St.tokenGap ?? "?"} \u2192 ${Kt.mode} step ${Kt.step}), next preserves ${be}/${w}`,
        { level: "info" },
      ));
  }
}
