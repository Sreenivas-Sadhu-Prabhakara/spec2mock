// Dependency-free Swagger 2.0 -> OpenAPI 3.0 converter that runs in the browser.
// Covers the common surface (servers, components, requestBody/formData, response
// content, security schemes, $ref relocation). Validated in tests against the
// authoritative `swagger2openapi` reference converter.

const SCHEMA_KEYS = [
  'type', 'format', 'enum', 'default', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'multipleOf',
]
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

export function convertToV3(input) {
  const warnings = []
  if (!input || typeof input !== 'object') throw new Error('Input is not an object.')
  if (input.openapi) return { openapi: input, warnings: ['Already OpenAPI 3.x — nothing to convert.'] }
  if (String(input.swagger) !== '2.0') {
    throw new Error('Not a Swagger 2.0 document (expected `swagger: "2.0"`).')
  }

  const src = JSON.parse(JSON.stringify(input))
  const globalConsumes = arrayOr(src.consumes, ['application/json'])
  const globalProduces = arrayOr(src.produces, ['application/json'])

  const out = { openapi: '3.0.0', info: src.info || { title: 'API', version: '1.0.0' } }

  // host + basePath + schemes -> servers
  const basePath = src.basePath || ''
  if (src.host) {
    const schemes = src.schemes && src.schemes.length ? src.schemes : ['https']
    out.servers = schemes.map((s) => ({ url: `${s}://${src.host}${basePath}` }))
  } else if (basePath) {
    out.servers = [{ url: basePath }]
  }

  // components
  const components = {}
  if (src.definitions) components.schemas = mapValues(src.definitions, (s) => fixSchema(s))
  if (src.securityDefinitions) components.securitySchemes = mapValues(src.securityDefinitions, (d) => convertSecurityScheme(d, warnings))
  if (src.responses) components.responses = mapValues(src.responses, (r) => convertResponse(r, globalProduces))
  if (src.parameters) {
    const shared = {}
    for (const [name, p] of Object.entries(src.parameters)) {
      if (p.in === 'body' || p.in === 'formData') {
        warnings.push(`Shared ${p.in} parameter "${name}" can't be a reusable OpenAPI 3.0 parameter; inline it into operations.`)
        continue
      }
      shared[name] = convertParameter(p)
    }
    if (Object.keys(shared).length) components.parameters = shared
  }

  // paths
  out.paths = {}
  for (const [pathStr, item] of Object.entries(src.paths || {})) {
    out.paths[pathStr] = convertPathItem(item, globalConsumes, globalProduces, warnings)
  }

  if (src.security) out.security = src.security
  if (src.tags) out.tags = src.tags
  if (src.externalDocs) out.externalDocs = src.externalDocs
  if (Object.keys(components).length) out.components = components

  rewriteRefs(out)
  return { openapi: out, warnings }
}

function convertPathItem(item, gConsumes, gProduces, warnings) {
  const out = {}
  const sharedParams = []
  if (Array.isArray(item.parameters)) {
    for (const p of item.parameters) {
      if (p.in === 'body' || p.in === 'formData') {
        warnings.push('Body/formData parameter at path level is unusual; moved into each operation.')
        continue
      }
      sharedParams.push(convertParameter(p))
    }
  }
  if (sharedParams.length) out.parameters = sharedParams
  for (const m of HTTP_METHODS) {
    if (item[m]) out[m] = convertOperation(item[m], gConsumes, gProduces, warnings)
  }
  return out
}

function convertOperation(op, gConsumes, gProduces, warnings) {
  const consumes = arrayOr(op.consumes, gConsumes)
  const produces = arrayOr(op.produces, gProduces)
  const out = {}
  for (const k of ['summary', 'description', 'operationId', 'tags', 'deprecated', 'externalDocs', 'security']) {
    if (op[k] !== undefined) out[k] = op[k]
  }

  const params = []
  let bodyParam = null
  const formParams = []
  for (const p of op.parameters || []) {
    if (p.in === 'body') bodyParam = p
    else if (p.in === 'formData') formParams.push(p)
    else params.push(convertParameter(p))
  }
  if (params.length) out.parameters = params

  if (bodyParam && formParams.length) {
    warnings.push(`Operation ${op.operationId || ''} mixes body and formData parameters; using the body parameter.`)
  }
  if (bodyParam) {
    out.requestBody = {
      ...(bodyParam.description ? { description: bodyParam.description } : {}),
      required: !!bodyParam.required,
      content: fromMediaTypes(consumes, () => ({ schema: fixSchema(bodyParam.schema || {}) })),
    }
  } else if (formParams.length) {
    const hasFile = formParams.some((p) => p.type === 'file')
    const mt = hasFile ? 'multipart/form-data' : 'application/x-www-form-urlencoded'
    const schema = { type: 'object', properties: {}, required: [] }
    for (const p of formParams) {
      schema.properties[p.name] = schemaFromTyped(p)
      if (p.required) schema.required.push(p.name)
    }
    if (!schema.required.length) delete schema.required
    out.requestBody = { required: formParams.some((p) => p.required), content: { [mt]: { schema } } }
  }

  out.responses = {}
  for (const [code, resp] of Object.entries(op.responses || {})) {
    out.responses[code] = convertResponse(resp, produces)
  }
  return out
}

function convertResponse(resp, produces) {
  const out = { description: resp.description || '' }
  if (resp.headers) {
    out.headers = mapValues(resp.headers, (h) => {
      const header = { schema: schemaFromTyped(h) }
      if (h.description) header.description = h.description
      return header
    })
  }
  if (resp.schema) {
    const example = resp.examples && typeof resp.examples === 'object' ? resp.examples : null
    out.content = fromMediaTypes(produces, (mt) => {
      const media = { schema: fixSchema(resp.schema) }
      if (example && example[mt] !== undefined) media.example = example[mt]
      return media
    })
  } else if (resp.examples && typeof resp.examples === 'object') {
    out.content = {}
    for (const [mt, val] of Object.entries(resp.examples)) out.content[mt] = { example: val }
  }
  return out
}

function convertParameter(p) {
  const out = { name: p.name, in: p.in }
  if (p.description) out.description = p.description
  if (p.required || p.in === 'path') out.required = true
  if (p.deprecated) out.deprecated = true
  out.schema = schemaFromTyped(p)
  const style = collectionFormatToStyle(p.collectionFormat, p.in)
  if (style) Object.assign(out, style)
  return out
}

function convertSecurityScheme(def, warnings) {
  if (def.type === 'basic') return withDesc({ type: 'http', scheme: 'basic' }, def)
  if (def.type === 'apiKey') return withDesc({ type: 'apiKey', name: def.name, in: def.in }, def)
  if (def.type === 'oauth2') {
    const flowName = { implicit: 'implicit', password: 'password', application: 'clientCredentials', accessCode: 'authorizationCode' }[def.flow]
    if (!flowName) {
      warnings.push(`Unknown oauth2 flow "${def.flow}"; left as-is.`)
      return def
    }
    const flow = {}
    if (def.authorizationUrl) flow.authorizationUrl = def.authorizationUrl
    if (def.tokenUrl) flow.tokenUrl = def.tokenUrl
    flow.scopes = def.scopes || {}
    return withDesc({ type: 'oauth2', flows: { [flowName]: flow } }, def)
  }
  warnings.push(`Unknown security scheme type "${def.type}"; left as-is.`)
  return def
}

// ---- schema helpers ----

// Build a JSON Schema from a 2.0 typed object (parameter / header / items).
function schemaFromTyped(obj) {
  const schema = {}
  for (const k of SCHEMA_KEYS) if (obj[k] !== undefined) schema[k] = obj[k]
  if (obj.items) schema.items = schemaFromTyped(obj.items)
  if (schema.type === 'file') {
    schema.type = 'string'
    schema.format = 'binary'
  }
  return schema
}

// Recursively normalize a full 2.0 schema object into a 3.0-valid one.
function fixSchema(node) {
  if (Array.isArray(node)) return node.map(fixSchema)
  if (!node || typeof node !== 'object') return node
  const out = {}
  for (const [k, v] of Object.entries(node)) {
    if (k === 'collectionFormat') continue // not valid on 3.0 schemas
    if (k === 'x-nullable') {
      out.nullable = !!v
      continue
    }
    if (k === 'discriminator' && typeof v === 'string') {
      out.discriminator = { propertyName: v }
      continue
    }
    out[k] = fixSchema(v)
  }
  if (out.type === 'file') {
    out.type = 'string'
    out.format = 'binary'
  }
  return out
}

function collectionFormatToStyle(cf, location) {
  if (!cf) return null
  if (location === 'query') {
    return {
      csv: { style: 'form', explode: false },
      multi: { style: 'form', explode: true },
      ssv: { style: 'spaceDelimited', explode: false },
      pipes: { style: 'pipeDelimited', explode: false },
    }[cf] || null
  }
  if (cf === 'csv') return { style: 'simple' }
  return null
}

// Relocate 2.0 $ref targets to their 3.0 components locations, everywhere.
function rewriteRefs(node) {
  if (Array.isArray(node)) {
    node.forEach(rewriteRefs)
    return
  }
  if (!node || typeof node !== 'object') return
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string') {
      node.$ref = v
        .replace('#/definitions/', '#/components/schemas/')
        .replace('#/responses/', '#/components/responses/')
        .replace('#/parameters/', '#/components/parameters/')
    } else {
      rewriteRefs(v)
    }
  }
}

// ---- tiny utils ----
function arrayOr(v, dflt) {
  return Array.isArray(v) && v.length ? v : dflt
}
function mapValues(obj, fn) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) out[k] = fn(v, k)
  return out
}
function fromMediaTypes(mts, make) {
  const out = {}
  for (const mt of mts) out[mt] = make(mt)
  return out
}
function withDesc(target, src) {
  if (src.description) target.description = src.description
  return target
}
