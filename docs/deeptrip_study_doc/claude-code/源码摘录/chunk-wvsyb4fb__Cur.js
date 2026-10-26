// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228507895; external dependencies are not included.
function Cur(e, n) {
  if (e.ok) return Qwe(e.summaryText) ? void 0 : "its reply has no <summary> block";
  switch (e.reason) {
    case "error":
      return `it failed (${e.errorKind})`;
    case "media_too_large":
      return n ? "it hit a media-size error even stripped" : void 0;
    case "aborted":
    case "prompt_too_long":
      return;
  }
}
