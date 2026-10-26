// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228628067; external dependencies are not included.
function nfr(e) {
  return e.filter(
    (n) =>
      n.type !== "attachment" ||
      n.attachment.type === "queued_command" ||
      n.attachment.type === "poll_events" ||
      n.attachment.type === "dir_sync_notice" ||
      n.attachment.type === "fork_briefing" ||
      n.attachment.type === "thinking_stripped" ||
      n.attachment.type === "advisor_stripped",
  );
}
