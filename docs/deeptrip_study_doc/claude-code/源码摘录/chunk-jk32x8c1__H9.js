// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 224511687; external dependencies are not included.
async function H9(e, n, r, s, a = OZs) {
  let o = Array.isArray(e);
  if (o) {
    if (e.some((g) => !kd(g) || g.type !== "text"))
      return { error: "Cannot persist tool results containing non-text content" };
  }
  let l = tS();
  if (l !== void 0) {
    let p = Math.min(a, l.maxBytes),
      g,
      d,
      R;
    try {
      ((g = o ? _(e, null, 2) : e), (d = sSe(g, p)), (R = Buffer.from(d)));
    } catch {
      return { error: B };
    }
    let E = await fWe(l, { leafName: F(n, o), data: R });
    if (E === null) return { error: B };
    let { preview: A, hasMore: U } = Kmt(d, mMe);
    return {
      filepath: E.path,
      originalSize: g.length,
      isJson: o,
      preview: A,
      hasMore: U,
      truncatedAtBytes: d === g ? void 0 : p,
    };
  }
  if (r === null) return { error: B };
  await rF(r, s);
  let u = lWe(r, n, o),
    h,
    f;
  try {
    ((h = o ? _(e, null, 2) : e), (f = sSe(h, a)));
  } catch (p) {
    let g = x(N(p));
    return (t(`Failed to persist tool result to ${u}: ${g}`, { level: "error" }), { error: g });
  }
  let T = f === h ? void 0 : a,
    S = z() && s !== void 0 ? C4(b(u), K(u)) : void 0;
  if (z() && s !== void 0 && S !== void 0) {
    let p = await s.write(S, f, {
      precondition: { type: "ifAbsent" },
      mode: 438 & ~process.umask(),
    });
    if (!p.ok && p.error.code !== "AlreadyExists") {
      let g = le(p.error, u);
      return (t(`Failed to persist tool result to ${u}: ${g}`, { level: "error" }), { error: g });
    }
    if (p.ok) t(`Persisted tool result to ${u} (${en(f.length)})`);
  } else {
    let p = hn();
    try {
      (await n8o(b(u), p),
        await r8o(u, p),
        await p.writeExclusive(u, f),
        t(`Persisted tool result to ${u} (${en(f.length)})`));
    } catch (g) {
      if (v(g) !== "EEXIST")
        return (
          t(`Failed to persist tool result to ${u}: ${x(N(g))}`, { level: "error" }),
          { error: x(N(g)) }
        );
      let d;
      try {
        d = await p.lstat(u);
      } catch {
        return { error: "tool result path could not be checked; not persisted" };
      }
      if (d?.isSymbolicLink) return { error: "tool result path is a link; not persisted" };
      if (d?.isFile !== !0)
        return { error: "tool result path is not a regular file; not persisted" };
      if (d.nlink > 1) return { error: "tool result path has another name; not persisted" };
    }
  }
  let { preview: y, hasMore: I } = Kmt(f, mMe);
  return {
    filepath: u,
    originalSize: h.length,
    isJson: o,
    preview: y,
    hasMore: I,
    truncatedAtBytes: T,
  };
}
