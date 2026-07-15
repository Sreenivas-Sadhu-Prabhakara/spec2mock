import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import { generate } from '../src/generate.js'
import { mappingFiles, configMapYaml, DEPLOYMENT_YAML, SERVICE_YAML, byteLength } from '../src/artifacts.js'

const here = dirname(fileURLToPath(import.meta.url))
const spec = yaml.load(readFileSync(join(here, '../examples/petstore.yaml'), 'utf8'))
const { mappings } = generate(spec, { includeErrors: true, cors: true })
const files = mappingFiles(mappings)

let fail = 0
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++ }

// ConfigMap parses as YAML, and every embedded mapping value parses as JSON
const cm = yaml.load(configMapYaml(files))
ok(cm.kind === 'ConfigMap', 'ConfigMap YAML parses')
ok(Object.keys(cm.data).length === files.length, `ConfigMap has all ${files.length} mapping keys`)
let jsonOk = true
for (const [k, v] of Object.entries(cm.data)) { try { JSON.parse(v) } catch { jsonOk = false; console.log('    bad JSON in ' + k) } }
ok(jsonOk, 'every embedded mapping is valid JSON')

// Deployment + Service parse and reference the right things
const dep = yaml.load(DEPLOYMENT_YAML)
ok(dep.kind === 'Deployment', 'Deployment YAML parses')
ok(dep.spec.template.spec.containers[0].image.startsWith('wiremock/wiremock'), 'uses official wiremock image')
ok(dep.spec.template.spec.containers[0].volumeMounts[0].mountPath === '/home/wiremock/mappings', 'mounts mappings at /home/wiremock/mappings')
ok(dep.spec.template.spec.containers[0].readinessProbe.httpGet.path === '/__admin/health', 'readiness probe hits /__admin/health')
ok(dep.spec.template.spec.volumes[0].configMap.name === 'wiremock-mappings', 'volume references the ConfigMap')
const svc = yaml.load(SERVICE_YAML)
ok(svc.kind === 'Service' && svc.spec.ports[0].port === 8080, 'Service exposes 8080')

console.log(`\n  mappings size: ${(files.reduce((n,f)=>n+byteLength(f.content),0)/1024).toFixed(1)} KB`)
console.log(fail ? `\n${fail} failed` : '\nAll artifact assertions passed.')
process.exit(fail ? 1 : 0)
