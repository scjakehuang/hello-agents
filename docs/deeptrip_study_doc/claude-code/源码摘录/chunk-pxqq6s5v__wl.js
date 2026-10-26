// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 222105839; external dependencies are not included.
function wl(e) {
  if (!e.content) return 0;
  if (typeof e.content === "string") return Qc(e.content);
  if (!Array.isArray(e.content)) return 0;
  return e.content.reduce((n, s) => {
    if (typeof s === "string") return n + Qc(s);
    if (!kd(s)) return n;
    if (s.type === "text") return n + Qc(s.text);
    else if (s.type === "image") return n + Rl;
    else if (s.type === "document") return n + J9n(s);
    else if (s.type === "search_result") return n + s3(s.content);
    return n;
  }, 0);
}
