# spec2mock

Upload an **OpenAPI 3.x** spec → download a ready-to-deploy **WireMock** mock for Kubernetes.
A static site: your spec is parsed and packaged entirely in the browser — nothing is uploaded to a server.

## Why

Stand up a faithful mock of an API backend so your tests point at it with **one change — the base URL**.

- Every operation → a WireMock stub with the same path, method, status and content type.
- **Success responses by default**, so existing tests pass untouched.
- **Errors on demand**: send `X-Mock-Status: 404` (or any documented code) to get that response.
- Bodies come from the spec's examples, or are synthesized from the JSON Schema when absent.
- Output is the official `wiremock/wiremock:3` image + your mappings as a ConfigMap — no image build, no registry.

## The downloaded ZIP

```
mappings/            WireMock stub mappings (one JSON per stub)
k8s/configmap.yaml   the mappings as a ConfigMap
k8s/deployment.yaml  runs wiremock/wiremock:3, mounts the ConfigMap
k8s/service.yaml     ClusterIP service on :8080
k8s/kustomization.yaml
Dockerfile           optional: bake a sealed image (no ConfigMap size limit)
docker-compose.yml   optional: local run
run.sh               optional: local run via docker
README.md            usage for that specific mock
```

Deploy: `kubectl apply -f k8s/` → base URL `http://wiremock-mock.<namespace>.svc.cluster.local:8080`.

## Develop

```bash
npm install
npm run dev        # local UI
npm run test:gen   # node-side sanity check of the generator
npm run build      # static build -> dist/
```

## Deploy the site (GitHub Pages)

Push to `main`; the included Actions workflow builds and publishes to Pages.
In the repo: **Settings → Pages → Source: GitHub Actions**.

## Swagger 2.0 → OpenAPI 3.0

Two-tab UI:

- **Generate mock** — drop an OpenAPI 3.x spec (a Swagger 2.0 spec auto-converts).
- **Convert 2.0 → 3.0** — convert a Swagger 2.0 spec and download it as YAML/JSON, or send it straight to the generator.

The converter is dependency-free and runs in the browser. It's validated in tests differentially
against the authoritative [`swagger2openapi`](https://github.com/Mermade/oas-kit) reference (dev-only)
and end-to-end through a live WireMock.

## Notes / limits

- Single-file specs (local `$ref`s). Remote/external `$ref`s aren't fetched.
- The converter covers the common Swagger 2.0 surface (servers, components, requestBody/formData,
  response content, security schemes, `$ref` relocation). It flags anything it can't map cleanly.
- ConfigMaps cap at ~1 MiB. Very large specs: use the `Dockerfile` (sealed image) path — the site warns you when you're close.

## Stack

Vite · js-yaml · [openapi-sampler](https://github.com/Redocly/openapi-sampler) (schema → example) · JSZip · FileSaver.
Dev-only: `swagger2openapi` (reference converter for tests).
