// Storage identifiers (for example yadisk://) are not image sources. A newly
// picked local image, however, must win over the saved profile's resolved URL.
export function getProfileMediaDisplayUri(sourceUrl, resolvedUrl) {
  const source = String(sourceUrl || '').trim();
  if (!source) return '';
  if (/^(file|content|asset|ph|assets-library):\/\//i.test(source) || /^data:image\//i.test(source)) {
    return source;
  }
  return String(resolvedUrl || '').trim() || source;
}
