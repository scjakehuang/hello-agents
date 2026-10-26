// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 224517606; external dependencies are not included.
function j(e) {
  let n = [],
    r = [],
    s = () => {
      if (r.length > 0) n.push(r);
      r = [];
    },
    a = new Set();
  for (let o of e)
    if (o.type === "user") r.push(...te(o));
    else if (o.type === "assistant") {
      if (!a.has(o.message.id)) (s(), a.add(o.message.id));
    }
  return (s(), n);
}
