import { sample } from 'openapi-sampler'
import { deref } from './refs.js'

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']

// The header a caller sends to force a specific declared response.
// Absent -> the success (drop-in) response. Present -> that exact status code.
export const STATUS_HEADER = 'X-Mock-Status'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
}

/**
 * Turn a parsed OpenAPI 3.x document into WireMock stub mappings.
 * @returns {{ mappings: object[], warnings: string[], stats: {operations:number, stubs:number} }}
 */
export function generate(spec, opts = {}) {
  const includeErrors = opts.includeErrors !== false
  const cors = opts.cors !== false
  const mappings = []
  const warnings = []
  const usedNames = new Map()
  const paths = (spec && spec.paths) || {}
  let operations = 0

  for (const [rawPath, pathItemRaw] of Object.entries(paths)) {
    const pathItem = deref(spec, pathItemRaw)
    if (!pathItem || typeof pathItem !== 'object') continue

    for (const method of HTTP_METHODS) {
      if (!pathItem[method]) continue
      const op = deref(spec, pathItem[method])
      operations++
      const responses = (op && op.responses) || {}
      const codes = Object.keys(responses)
      if (!codes.length) {
        warnings.push(`${method.toUpperCase()} ${rawPath}: no responses in spec — generated an empty 200.`)
      }

      const primary = pickPrimary(codes)
      // Default stub: no trigger header, lower precedence -> the drop-in happy path.
      mappings.push(
        uniqueName(
          buildStub({ spec, rawPath, method, code: primary, responses, priority: 5, trigger: null, cors, warnings }),
          usedNames,
        ),
      )

      // Triggered stubs: one per explicit numeric status code, matched via X-Mock-Status.
      const numeric = codes.filter((c) => /^\d{3}$/.test(c))
      const triggered = includeErrors ? numeric : numeric.filter(isSuccess)
      for (const code of triggered) {
        mappings.push(
          uniqueName(
            buildStub({ spec, rawPath, method, code, responses, priority: 1, trigger: code, cors, warnings }),
            usedNames,
          ),
        )
      }
    }
  }

  // A single low-priority catch-all so browser CORS preflight (OPTIONS) always passes.
  if (cors) {
    mappings.push({
      _name: 'zz-cors-preflight',
      priority: 10,
      request: { method: 'OPTIONS', urlPattern: '.*' },
      response: { status: 204, headers: { ...CORS_HEADERS } },
    })
  }

  return { mappings, warnings, stats: { operations, stubs: mappings.length } }
}

function isSuccess(code) {
  return /^2\d\d$/.test(code)
}

function pickPrimary(codes) {
  if (!codes.length) return '200'
  const numeric = codes.filter((c) => /^\d{3}$/.test(c))
  const twoxx = numeric.filter(isSuccess).sort()
  if (twoxx.includes('200')) return '200'
  if (twoxx.length) return twoxx[0]
  if (codes.includes('default')) return 'default'
  return numeric.sort()[0] || codes[0]
}

function buildStub({ spec, rawPath, method, code, responses, priority, trigger, cors, warnings }) {
  const statusNum = /^\d{3}$/.test(code) ? parseInt(code, 10) : 200
  const respObj = deref(spec, responses[code]) || {}

  const request = {
    method: method.toUpperCase(),
    urlPathTemplate: rawPath, // OpenAPI `{id}` == WireMock urlPathTemplate syntax
  }
  if (trigger) request.headers = { [STATUS_HEADER]: { equalTo: String(trigger) } }

  const headers = {}
  if (cors) Object.assign(headers, CORS_HEADERS)

  // Declared response headers, with sampled values.
  for (const [hName, hRaw] of Object.entries(respObj.headers || {})) {
    const h = deref(spec, hRaw)
    const val = sampleValue(spec, h && h.example !== undefined ? { example: h.example } : h, warnings)
    if (val !== undefined) headers[hName] = String(val)
  }

  const response = { status: statusNum, headers }

  const content = respObj.content || {}
  const mediaType = pickMediaType(content)
  if (mediaType) {
    const media = content[mediaType]
    headers['Content-Type'] = mediaType
    const body = sampleValue(spec, media, warnings, `${method.toUpperCase()} ${rawPath} ${code}`)
    if (isJsonType(mediaType) && body !== null && typeof body === 'object') {
      response.jsonBody = body
    } else if (body !== undefined) {
      response.body = typeof body === 'string' ? body : JSON.stringify(body, null, 2)
    }
  }

  const name = `${method}${slug(rawPath)}-${trigger ? trigger : 'default'}`
  return { _name: name, priority, request, response }
}

// example -> examples[0] -> schema sample. Never throws.
function sampleValue(spec, media, warnings, ctx) {
  if (!media || typeof media !== 'object') return undefined
  if (media.example !== undefined) return media.example
  if (media.examples && typeof media.examples === 'object') {
    const first = Object.values(media.examples)[0]
    const ex = deref(spec, first)
    if (ex && ex.value !== undefined) return ex.value
  }
  if (media.schema) {
    try {
      return sample(media.schema, { skipReadOnly: false, quiet: true }, spec)
    } catch (e) {
      if (ctx) warnings.push(`${ctx}: could not synthesize a body from schema (${e.message}); left empty.`)
      return undefined
    }
  }
  return undefined
}

function pickMediaType(content) {
  const keys = Object.keys(content || {})
  if (!keys.length) return null
  const json = keys.find((k) => k === 'application/json')
  if (json) return json
  const jsonish = keys.find((k) => isJsonType(k))
  if (jsonish) return jsonish
  return keys[0]
}

function isJsonType(mt) {
  return /\bjson\b/i.test(mt)
}

function slug(p) {
  const s = String(p).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return s ? '_' + s : '_root'
}

function uniqueName(stub, used) {
  let base = stub._name
  let n = used.get(base) || 0
  if (n > 0) stub._name = `${base}_${n}`
  used.set(base, n + 1)
  return stub
}
