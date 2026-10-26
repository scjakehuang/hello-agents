// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228481852; external dependencies are not included.
function qwe(e) {
  let n = (s) =>
    s.type === "assistant" &&
    !s.isApiErrorMessage &&
    s.message.content.some((h) => h.type === "text");
  return (
    e.findLast(
      (s) =>
        n(s) && s.message.content.some((h) => h.type === "text" && h.text.includes("<summary>")),
    ) ?? e.findLast(n)
  );
}
