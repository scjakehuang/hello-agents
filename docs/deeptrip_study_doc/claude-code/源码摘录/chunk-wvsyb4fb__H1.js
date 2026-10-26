// Claude Code 2.1.307 shipped excerpt. Original symbols; static reading only.
// Binary file offset 228630783; external dependencies are not included.
function H1(e) {
  return [
    e.boundaryMarker,
    ...e.summaryMessages,
    ...(e.replacement ?? []),
    ...e.messagesToKeep,
    ...e.attachments,
    ...e.hookResults,
  ];
}
