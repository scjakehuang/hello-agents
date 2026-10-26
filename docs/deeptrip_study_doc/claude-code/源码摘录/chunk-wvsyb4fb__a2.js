// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228481472; external dependencies are not included.
function a2(e) {
  let n = [],
    r = [],
    s;
  for (let h of e) {
    if (Gk(h)) {
      r.push(h);
      continue;
    }
    if (
      h.type === "assistant" &&
      h.message.id !== s &&
      !h.resumedFromIncompleteThinking &&
      r.length > 0
    )
      (n.push(r), (r = [h]));
    else r.push(h);
    if (h.type === "assistant") s = h.message.id;
  }
  if (r.length > 0) n.push(r);
  return n;
}
