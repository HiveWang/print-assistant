let selectedFileSequence = 0;

export function createSelectedFileId() {
  selectedFileSequence += 1;
  return `selected-${Date.now().toString(36)}-${selectedFileSequence.toString(36)}`;
}
