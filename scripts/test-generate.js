// Node-side sanity check for the generator (no browser needed):
//   npm run test:gen
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import { generate, STATUS_HEADER } from '../src/generate.js'

const here = dirname(fileURLToPath(import.meta.url))
const spec = yaml.load(readFileSync(join(here, '../examples/petstore.yaml'), 'utf8'))

const { mappings, warnings, stats } = generate(spec, { includeErrors: true, cors: true })

let failures = 0
const assert = (cond, msg) => {
  if (!cond) {
    failures++
    console.error('  ✗ ' + msg)
  } else {
    console.log('  ✓ ' + msg)
  }
}

console.log(`\nGenerated ${stats.stubs} stubs from ${stats.operations} operations.\n`)

// Default GET /pets/{petId} -> 200, no trigger header
const defGet = mappings.find(
  (m) => m.request.method === 'GET' && m.request.urlPathTemplate === '/pets/{petId}' && !m.request.headers,
)
assert(defGet && defGet.response.status === 200, 'GET /pets/{petId} default stub returns 200')
assert(defGet && defGet.response.jsonBody && defGet.response.jsonBody.name === 'Rex', 'body synthesized from schema example')
assert(defGet && defGet.priority === 5, 'default stub has lower precedence (priority 5)')

// Triggered 404
const notFound = mappings.find(
  (m) =>
    m.request.method === 'GET' &&
    m.request.urlPathTemplate === '/pets/{petId}' &&
    m.request.headers &&
    m.request.headers[STATUS_HEADER] &&
    m.request.headers[STATUS_HEADER].equalTo === '404',
)
assert(notFound && notFound.response.status === 404, `${STATUS_HEADER}: 404 stub returns 404`)
assert(notFound && notFound.priority === 1, '404 trigger stub has higher precedence (priority 1)')

// POST /pets primary should be 201
const post = mappings.find(
  (m) => m.request.method === 'POST' && m.request.urlPathTemplate === '/pets' && !m.request.headers,
)
assert(post && post.response.status === 201, 'POST /pets default picks 201 (no 200 present)')

// CORS preflight present
assert(mappings.some((m) => m.request.method === 'OPTIONS'), 'CORS preflight stub present')
assert(defGet && defGet.response.headers['Access-Control-Allow-Origin'] === '*', 'CORS header on responses')

// Path template preserved
assert(defGet && defGet.request.urlPathTemplate.includes('{petId}'), 'path variable preserved as urlPathTemplate')

if (warnings.length) console.log('\nWarnings:\n' + warnings.map((w) => '  - ' + w).join('\n'))

console.log('')
if (failures) {
  console.error(`${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('All assertions passed.')
