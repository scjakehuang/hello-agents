// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228628369; external dependencies are not included.
function ucn(e) {
  if (e.length <= Vun) return e;
  let n = Vun,
    r = e.charCodeAt(n - 1);
  if (r >= 55296 && r <= 56319) n--;
  return `${e.slice(0, n)}\u2026[truncated, original ${e.length} chars]`;
}
