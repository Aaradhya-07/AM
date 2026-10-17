export function normalizeLabel(input) {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "-");
}
