// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228483090; external dependencies are not included.
function $ln(e) {
  return `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn \u2014 you will fail the task.
- Your entire response must be plain text: ${e}.

`;
}
