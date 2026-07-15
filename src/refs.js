// Minimal local ($/#) JSON-Pointer $ref resolver.
// Covers single-file OpenAPI specs (the common case) with cycle protection.
// External/remote refs are intentionally unsupported — a browser-only tool
// can't reliably fetch them, and uploaded specs are self-contained.

function decodePointer(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

export function resolveRef(spec, ref, seen = new Set()) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined
  if (seen.has(ref)) return undefined
  seen.add(ref)
  const parts = ref.slice(2).split('/').map(decodePointer)
  let cur = spec
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[p]
  }
  if (cur && typeof cur === 'object' && typeof cur.$ref === 'string') {
    return resolveRef(spec, cur.$ref, seen)
  }
  return cur
}

// Return `obj` with a top-level $ref followed one hop (if present).
export function deref(spec, obj) {
  if (obj && typeof obj === 'object' && typeof obj.$ref === 'string') {
    return resolveRef(spec, obj.$ref) ?? {}
  }
  return obj
}
