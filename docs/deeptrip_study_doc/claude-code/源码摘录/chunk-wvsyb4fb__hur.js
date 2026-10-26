// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228500446; external dependencies are not included.
function hur(e) {
  let n = e;
  return (
    (n = n.replace(cXe, "")),
    (n = n.replace(
      Gln,
      (r, s) => `Summary:
${s.trim()}`,
    )),
    (n = n.replace(
      /\n\n+/g,
      `

`,
    )),
    n.trim()
  );
}
