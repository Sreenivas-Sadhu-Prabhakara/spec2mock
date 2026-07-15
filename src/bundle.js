import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import {
  mappingFiles,
  byteLength,
  configMapYaml,
  readme,
  safeName,
  CONFIGMAP_LIMIT,
  DEPLOYMENT_YAML,
  SERVICE_YAML,
  KUSTOMIZATION_YAML,
  DOCKERFILE,
  COMPOSE_YAML,
  RUN_SH,
} from './artifacts.js'

// Build the downloadable ZIP in the browser. Returns { fileCount, mappingsBytes, overLimit }.
export async function buildZip({ mappings, specName, stats, warnings }) {
  const zip = new JSZip()
  const files = mappingFiles(mappings)
  const mappingsBytes = files.reduce((n, f) => n + byteLength(f.content), 0)
  const overLimit = mappingsBytes > CONFIGMAP_LIMIT * 0.95

  const mdir = zip.folder('mappings')
  for (const f of files) mdir.file(f.name, f.content)

  const kdir = zip.folder('k8s')
  kdir.file('configmap.yaml', configMapYaml(files))
  kdir.file('deployment.yaml', DEPLOYMENT_YAML)
  kdir.file('service.yaml', SERVICE_YAML)
  kdir.file('kustomization.yaml', KUSTOMIZATION_YAML)

  zip.file('Dockerfile', DOCKERFILE)
  zip.file('docker-compose.yml', COMPOSE_YAML)
  zip.file('run.sh', RUN_SH)
  zip.file('README.md', readme({ specName, stats, warnings, files, mappingsBytes, overLimit }))

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  saveAs(blob, `${safeName(specName)}-wiremock.zip`)
  return { fileCount: files.length, mappingsBytes, overLimit }
}
