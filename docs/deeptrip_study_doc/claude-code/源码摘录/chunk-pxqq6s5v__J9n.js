// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 222052378; external dependencies are not included.
function J9n(e, n) {
  if (typeof e === "string") return Qc(e, n);
  if (!kd(e)) return 0;
  if (e.type === "text") return Qc(e.text, n);
  if (e.type === "document" && "source" in e && typeof e.source === "object" && e.source !== null) {
    let s = e.source;
    if (s.type === "text") {
      let r = e.title?.split(".").pop()?.toLowerCase() ?? "",
        h = Ys(r);
      return Qc(s.data, n === void 0 ? h : Math.min(n, h));
    }
    if (s.type === "content") {
      if (typeof s.content === "string") return Qc(s.content, n);
      if (Array.isArray(s.content))
        return s3(
          s.content.filter((r) => typeof r === "object" && r !== null),
          n,
        );
    }
  }
  if (e.type === "image" || e.type === "document") return 2000;
  if (e.type === "tool_result") return s3(e.content, n);
  if (e.type === "tool_use") return Qc(e.name + _(e.input ?? {}), n);
  if (e.type === "thinking") return Qc(e.thinking, n);
  if (e.type === "redacted_thinking") return Qc(e.data, n);
  return Qc(_(e), n);
}
