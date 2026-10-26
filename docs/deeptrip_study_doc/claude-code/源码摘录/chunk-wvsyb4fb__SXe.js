// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228645028; external dependencies are not included.
function SXe() {
  return async () => ({
    behavior: "deny",
    message: "Tool use is not allowed during compaction",
    decisionReason: { type: "other", reason: "compaction agent should only produce text summary" },
  });
}
