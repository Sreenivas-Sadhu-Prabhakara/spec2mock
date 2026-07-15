// Pure builders for the downloadable bundle. No browser or Node APIs here, so
// both the site (bundle.js) and the test harness can use them.
import { STATUS_HEADER } from './generate.js'

export const IMAGE = 'wiremock/wiremock:3'
export const CONFIGMAP_LIMIT = 1024 * 1024 // Kubernetes ~1 MiB ConfigMap ceiling

export function mappingFiles(mappings) {
  return mappings.map((m) => {
    const { _name, ...clean } = m
    return { name: `${_name}.json`, content: JSON.stringify(clean, null, 2) + '\n' }
  })
}

export function byteLength(s) {
  return new TextEncoder().encode(s).length
}

export function configMapYaml(files) {
  let out =
    'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: wiremock-mappings\n  labels:\n    app: wiremock-mock\ndata:\n'
  for (const f of files) {
    out += `  ${f.name}: |-\n`
    for (const line of f.content.replace(/\n$/, '').split('\n')) {
      out += `    ${line}\n`
    }
  }
  return out
}

export const DEPLOYMENT_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: wiremock-mock
  labels:
    app: wiremock-mock
spec:
  replicas: 1
  selector:
    matchLabels:
      app: wiremock-mock
  template:
    metadata:
      labels:
        app: wiremock-mock
    spec:
      containers:
        - name: wiremock
          image: ${IMAGE}
          args: ["--disable-banner"]
          ports:
            - containerPort: 8080
          volumeMounts:
            - name: mappings
              mountPath: /home/wiremock/mappings
          readinessProbe:
            httpGet:
              path: /__admin/health
              port: 8080
            initialDelaySeconds: 3
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /__admin/health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 15
      volumes:
        - name: mappings
          configMap:
            name: wiremock-mappings
`

export const SERVICE_YAML = `apiVersion: v1
kind: Service
metadata:
  name: wiremock-mock
  labels:
    app: wiremock-mock
spec:
  type: ClusterIP
  selector:
    app: wiremock-mock
  ports:
    - name: http
      port: 8080
      targetPort: 8080
`

export const KUSTOMIZATION_YAML = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - configmap.yaml
  - deployment.yaml
  - service.yaml
`

export const DOCKERFILE = `# Optional: bake the mappings into a self-contained image (no ConfigMap size limit).
#   docker build -t my-api-mock:latest .
#   docker run --rm -p 8080:8080 my-api-mock:latest
FROM ${IMAGE}
COPY mappings /home/wiremock/mappings
EXPOSE 8080
`

export const COMPOSE_YAML = `services:
  wiremock:
    image: ${IMAGE}
    ports:
      - "8080:8080"
    volumes:
      - ./mappings:/home/wiremock/mappings
    command: ["--disable-banner"]
`

export const RUN_SH = `#!/usr/bin/env bash
# Run the mock locally with the official WireMock container.
set -euo pipefail
docker run --rm -it -p 8080:8080 \\
  -v "$(pwd)/mappings:/home/wiremock/mappings" \\
  ${IMAGE} --disable-banner
`

export function readme({ specName, stats, warnings, files, mappingsBytes, overLimit }) {
  const kb = (mappingsBytes / 1024).toFixed(1)
  const warnBlock = warnings.length
    ? `\n## Notes from generation\n\n${warnings.map((w) => `- ${w}`).join('\n')}\n`
    : ''
  const limitBlock = overLimit
    ? `\n> ⚠️ **ConfigMap size:** these mappings are ${kb} KB, near/over Kubernetes' ~1 MiB ConfigMap limit.\n> Use the **sealed image** path instead: \`docker build -t my-api-mock . && docker push ...\`, then set that image in \`k8s/deployment.yaml\` and remove the ConfigMap volume.\n`
    : ''

  return `# ${specName} — WireMock mock

Generated from an OpenAPI spec. Drop-in mock for the API backend: point your tests at
it and the only thing that changes is the base URL.

- **Operations:** ${stats.operations}
- **Stub mappings:** ${stats.stubs} (${files.length} files, ${kb} KB)
- **Image:** \`${IMAGE}\`
${limitBlock}
## Deploy to Kubernetes

\`\`\`bash
kubectl apply -f k8s/
# or, with kustomize:
kubectl apply -k k8s/
\`\`\`

The Service is \`wiremock-mock\` on port 8080, so inside the cluster your base URL is:

\`\`\`
http://wiremock-mock.<namespace>.svc.cluster.local:8080
\`\`\`

Point your backend/integration tests at that and run them unchanged.

## Run locally (no Kubernetes)

\`\`\`bash
./run.sh
# or
docker compose up
\`\`\`

Then \`curl http://localhost:8080/...\`.

## Happy path vs. error responses

By default every endpoint returns its **success** response — so existing tests pass untouched.

To exercise a **specific declared response** (404, 400, 500, …), send the \`${STATUS_HEADER}\`
header with the status code you want:

\`\`\`bash
# success (drop-in):
curl http://localhost:8080/pets/1

# force the documented 404:
curl -H "${STATUS_HEADER}: 404" http://localhost:8080/pets/1
\`\`\`

Only status codes the spec actually documents for that operation are reachable.

## Regenerate when the spec changes

Re-run the generator on the new spec, then:

\`\`\`bash
kubectl apply -f k8s/configmap.yaml
kubectl rollout restart deployment/wiremock-mock
\`\`\`

## What's in here

\`\`\`
mappings/            WireMock stub mappings (one JSON per stub)
k8s/configmap.yaml   the mappings, as a ConfigMap
k8s/deployment.yaml  runs ${IMAGE}, mounts the ConfigMap
k8s/service.yaml     ClusterIP service on :8080
k8s/kustomization.yaml
Dockerfile           optional: bake a sealed image
docker-compose.yml   optional: local run
run.sh               optional: local run via docker
\`\`\`
${warnBlock}`
}

export function safeName(s) {
  return (String(s || 'api').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'api').toLowerCase()
}
