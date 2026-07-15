// Validate the hand-rolled 2.0 -> 3.0 converter, differentially against the
// authoritative `swagger2openapi` reference (dev-only), and via the generator.
//   node scripts/test-convert.js
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import s2o from 'swagger2openapi'
import { convertToV3 } from '../src/convert.js'
import { generate } from '../src/generate.js'

const here = dirname(fileURLToPath(import.meta.url))
let fail = 0
const ok = (c, m) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m)
  if (!c) fail++
}

function reference(spec) {
  return new Promise((res, rej) =>
    s2o.convertObj(spec, { patch: true, warnOnly: true }, (e, out) => (e ? rej(e) : res(out.openapi))),
  )
}

// ---- fixture 1: petstore (file) ----
console.log('\npetstore-2.0.yaml')
const petstore = yaml.load(readFileSync(join(here, '../examples/petstore-2.0.yaml'), 'utf8'))
const { openapi: mine } = convertToV3(petstore)
const ref = await reference(petstore)

ok(mine.openapi === '3.0.0', 'emits openapi 3.0.0')
ok(JSON.stringify(mine.servers) === JSON.stringify(ref.servers), `servers match reference (${JSON.stringify(mine.servers)})`)
ok(sameKeys(mine.components.schemas, ref.components.schemas), 'components.schemas keys match reference')
ok(!!mine.paths['/pets'].post.requestBody && !!ref.paths['/pets'].post.requestBody, 'POST /pets -> requestBody (both)')
ok(
  mine.paths['/pets/{petId}'].get.responses['200'].content['application/json'].schema.$ref ===
    '#/components/schemas/Pet',
  'GET 200 -> content.application/json.schema.$ref relocated',
)
ok(
  JSON.stringify(mine.components.securitySchemes) === JSON.stringify(ref.components.securitySchemes),
  'apiKey securityScheme matches reference',
)
ok(!mine.swagger && !mine.definitions && !mine.host, '2.0-only root keys removed')

// generator consumes the converted spec
const g1 = generate(mine, { includeErrors: true, cors: true })
ok(g1.stats.stubs === 10 && g1.stats.operations === 3, `generator: ${g1.stats.operations} ops -> ${g1.stats.stubs} stubs`)

// ---- fixture 2: stress (formData, oauth2, basic, collectionFormat, header) ----
console.log('\nstress fixture')
const stress = {
  swagger: '2.0',
  info: { title: 'Stress', version: '1.0.0' },
  paths: {
    '/upload': {
      post: {
        consumes: ['multipart/form-data'],
        parameters: [
          { name: 'file', in: 'formData', type: 'file', required: true },
          { name: 'note', in: 'formData', type: 'string' },
        ],
        responses: {
          '200': {
            description: 'ok',
            headers: { 'X-Rate': { type: 'integer', description: 'remaining' } },
            schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
          },
        },
      },
      get: {
        parameters: [{ name: 'tags', in: 'query', type: 'array', items: { type: 'string' }, collectionFormat: 'csv' }],
        responses: { '200': { description: 'ok', schema: { type: 'array', items: { type: 'string' } } } },
      },
    },
  },
  securityDefinitions: {
    basicAuth: { type: 'basic' },
    oauth: {
      type: 'oauth2',
      flow: 'accessCode',
      authorizationUrl: 'https://ex/auth',
      tokenUrl: 'https://ex/token',
      scopes: { read: 'r' },
    },
  },
}
const { openapi: sm } = convertToV3(stress)
const sref = await reference(stress)

const rb = sm.paths['/upload'].post.requestBody
ok(!!rb.content['multipart/form-data'], 'formData -> multipart/form-data requestBody')
ok(rb.content['multipart/form-data'].schema.properties.file.format === 'binary', 'file field -> string/binary')
ok(sm.paths['/upload'].post.responses['200'].headers['X-Rate'].schema.type === 'integer', 'response header -> schema')
const q = sm.paths['/upload'].get.parameters[0]
ok(q.schema.type === 'array' && q.style === 'form' && q.explode === false, 'query csv array -> style:form explode:false')
ok(sm.components.securitySchemes.basicAuth.scheme === 'basic' && sm.components.securitySchemes.basicAuth.type === 'http', 'basic -> http/basic')
ok(
  !!sm.components.securitySchemes.oauth.flows.authorizationCode &&
    sm.components.securitySchemes.oauth.flows.authorizationCode.tokenUrl === 'https://ex/token',
  'oauth2 accessCode -> authorizationCode flow',
)
// reference agrees on the oauth flow name
ok(!!sref.components.securitySchemes.oauth.flows.authorizationCode, 'reference agrees: authorizationCode flow')
const g2 = generate(sm, { includeErrors: true, cors: true })
ok(g2.stats.operations === 2, `generator handles converted stress spec (${g2.stats.operations} ops)`)

function sameKeys(a, b) {
  return JSON.stringify(Object.keys(a || {}).sort()) === JSON.stringify(Object.keys(b || {}).sort())
}

console.log(fail ? `\n${fail} failed` : '\nAll conversion assertions passed.')
process.exit(fail ? 1 : 0)
