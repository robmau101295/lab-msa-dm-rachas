# lab-msa-dm-rachas

App web de **hábitos con rachas** (🔥 días seguidos) del dominio **demo** (`dm`).
Node.js 24, sin frameworks web; guarda los hábitos en **DynamoDB** usando **IRSA** (sin access keys).

```
src/racha.js     lógica pura de las rachas (la prueban los tests)
src/store.js     dónde se guardan: memoria (local) o DynamoDB (clúster)
src/server.js    servidor HTTP: página web + API + probes
public/          la página (HTML + JS + CSS)
test/            pruebas con node:test (las corre el Dockerfile)
Dockerfile       deps -> test -> runtime
.github/workflows/ci.yml   push a una rama -> imagen en ECR -> tag Git (av/bv/v)
.github/workflows/cd.yml   tag -> freeze -> aprobación -> actualiza <env>/app.yaml en el repo GitOps
```

## Probar en tu PC (modo memoria)

```bash
npm test
PERMITIR_FECHA_SIMULADA=true RACHAS_ADMIN_TOKEN=local123 npm start
# abre http://localhost:8080
```

## De dónde sale cada variable de entorno (en el clúster)

| Variable | Quién la pone | Archivo |
|---|---|---|
| `APP_VERSION` | El CI (`--build-arg`) → `ENV` del Dockerfile | `docker-ci.yml` + `Dockerfile` |
| `APP_ENVIRONMENT` | ConfigMap del chart | `lab-cfg-dm-argo-cd/lab-msa-dm-rachas/<env>/app.yaml` (`environment`) |
| `APP_NAME`, `GREETING`, `APP_TIMEZONE`, `AWS_REGION` | ConfigMap del chart | `.../shared-envvars.yaml` |
| `DYNAMODB_TABLE`, `PERMITIR_FECHA_SIMULADA` | ConfigMap del chart | `.../<env>/infrastructure.yaml` |
| `RACHAS_ADMIN_TOKEN` | Secret creado por External Secrets | Secrets Manager `eks-<cluster>-demo-app/secrets` |
| `AWS_ROLE_ARN`, `AWS_WEB_IDENTITY_TOKEN_FILE` | EKS (IRSA), por la anotación del ServiceAccount | `lab-iac-do-k8s-demo` |

Nota: cambio solo de documentación.
