// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 222106245; external dependencies are not included.
function El(e) {
  let n = [];
  for (let s of e)
    if (s.type === "assistant" && Array.isArray(s.message.content)) {
      for (let r of s.message.content)
        if (kd(r) && r.type === "tool_use" && Et.has(r.name)) n.push(r.id);
    }
  return n;
}
