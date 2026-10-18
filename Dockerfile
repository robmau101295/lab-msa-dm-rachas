# =============================================================================
# Imagen de lab-msa-dm-rachas. Tres etapas (multi-stage):
#
#   deps    -> instala SOLO las dependencias de producción (npm ci + lock)
#   test    -> corre las pruebas (npm test). Si fallan, el build falla y el CI
#              NO publica la imagen en ECR.
#   runtime -> la imagen final: node + src + public + node_modules de "deps"
#
# La plantilla docker-ci.yml no sabe que esto es Node: solo hace
# "docker build --build-arg APP_VERSION=<tag>". Por eso la misma plantilla
# sirvió para la app de Python del lab v1.
# =============================================================================
FROM node:24-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM base AS test
COPY package.json ./
COPY src ./src
COPY test ./test
RUN npm test

FROM base AS runtime
# El CI pasa el tag Git (av..., bv..., v...) como versión de la app.
ARG APP_VERSION=local
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=8080

COPY --from=deps /app/node_modules ./node_modules
# Se copia src DESDE la etapa test: así Docker está obligado a construir (y
# correr) la etapa test aunque no sea la final. Sin esto, BuildKit la salta.
COPY --from=test /app/src ./src
COPY public ./public
COPY package.json ./

# No correr como root dentro del contenedor (el usuario "node" viene en la imagen).
USER node

EXPOSE 8080
CMD ["node", "src/server.js"]
