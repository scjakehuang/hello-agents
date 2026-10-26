// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 222106837; external dependencies are not included.
function JFo(e, n) {
  let s = El(e),
    r = Math.max(1, n),
    h = new Set(s.slice(-r)),
    y = new Set(s.filter((v) => !h.has(v)));
  if (y.size === 0) return { clearSet: y, keepSet: h, tokensSaved: 0, candidates: [] };
  let b = 0,
    w = [];
  for (let v of e) {
    if (v.type !== "user" || !Array.isArray(v.message.content)) continue;
    for (let R of v.message.content)
      if (kd(R) && R.type === "tool_result" && y.has(R.tool_use_id) && !vl(R.content))
        ((b += wl(R)), w.push(R));
  }
  return { clearSet: y, keepSet: h, tokensSaved: b, candidates: w };
}
