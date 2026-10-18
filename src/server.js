// -----------------------------------------------------------------------------
// lab-msa-dm-rachas: app web de hábitos con rachas (🔥 días seguidos).
//
// Solo usa el módulo http de Node (sin Express) para que se vea todo:
//   GET    /                       -> la página web (carpeta public/)
//   GET    /health                 -> "ok"  (livenessProbe: ¿el proceso vive?)
//   GET    /ready                  -> "ok"  (readinessProbe: ¿llego a DynamoDB?)
//   GET    /api/info               -> de dónde salió cada dato (versión, ambiente, IRSA...)
//   GET    /api/habitos            -> lista de hábitos con su racha
//   POST   /api/habitos            -> crea un hábito          {"nombre": "Leer"}
//   POST   /api/habitos/:id/marcar -> marca el día de hoy     {"dia": "2026-10-20"} (opcional)
//   DELETE /api/habitos/:id        -> borra (pide el header X-Admin-Token)
//
// TODA la configuración llega por variables de entorno. Mira la tabla
// "de dónde sale cada variable" en el README.
// -----------------------------------------------------------------------------
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { hostname } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { esDiaValido, hoy, marcarDia, nuevoHabito, rachaVigente } from "./racha.js";
import { ConflictoError, crearStore } from "./store.js";

const env = process.env;

const config = {
  port: Number(env.PORT ?? 8080),
  appName: env.APP_NAME ?? "lab-msa-dm-rachas",
  version: env.APP_VERSION ?? "local",               // Dockerfile <- --build-arg del CI
  environment: env.APP_ENVIRONMENT ?? "local",       // ConfigMap <- <env>/app.yaml
  greeting: env.GREETING ?? "(sin GREETING)",        // ConfigMap <- shared-envvars.yaml
  zonaHoraria: env.APP_TIMEZONE ?? "America/Guayaquil",
  tabla: env.DYNAMODB_TABLE ?? "",                   // ConfigMap <- <env>/infrastructure.yaml
  region: env.AWS_REGION ?? "us-east-1",
  permiteFechaSimulada: env.PERMITIR_FECHA_SIMULADA === "true",
  adminToken: env.RACHAS_ADMIN_TOKEN ?? "",          // Secret <- External Secrets <- Secrets Manager
  irsaRoleArn: env.AWS_ROLE_ARN ?? null,             // lo inyecta EKS (IRSA)
};

const store = await crearStore({ tabla: config.tabla, region: config.region });
const carpetaPublica = fileURLToPath(new URL("../public/", import.meta.url));
const pod = hostname();

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

// ------------------------------------------------------------------ helpers --

function responder(res, status, cuerpo, tipo = "application/json; charset=utf-8") {
  const payload = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo, null, 2);
  res.writeHead(status, {
    "Content-Type": tipo,
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    // Así ves en el navegador (F12 -> Network) qué pod respondió cada petición.
    "X-Pod": pod,
  });
  res.end(payload);
}

async function leerJson(req) {
  let texto = "";
  for await (const parte of req) {
    texto += parte;
    if (texto.length > 10_000) throw new ErrorHttp(413, "Cuerpo demasiado grande");
  }
  if (!texto) return {};
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErrorHttp(400, "JSON inválido");
  }
}

class ErrorHttp extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

function enmascarar(valor) {
  return valor ? `*** (${valor.length} caracteres)` : null;
}

function tokenValido(recibido) {
  if (!config.adminToken || !recibido) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(config.adminToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

function slug(nombre) {
  const base = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "habito"}-${randomUUID().slice(0, 6)}`;
}

function conRachaVigente(habito, diaHoy) {
  return { ...habito, rachaVigente: rachaVigente(habito, diaHoy) };
}

// ------------------------------------------------------------------- rutas --

async function info() {
  return {
    app: config.appName,
    version: config.version,
    environment: config.environment,
    greeting: config.greeting,
    pod,
    almacenamiento: store.descripcion,
    irsaRoleArn: config.irsaRoleArn,
    secretos: { RACHAS_ADMIN_TOKEN: enmascarar(config.adminToken) },
    permiteFechaSimulada: config.permiteFechaSimulada,
    hoy: hoy(config.zonaHoraria),
    zonaHoraria: config.zonaHoraria,
  };
}

// Día "de referencia": hoy, o el día simulado si el ambiente lo permite.
function diaDeReferencia(diaPedido) {
  const diaHoy = hoy(config.zonaHoraria);
  if (diaPedido === undefined || diaPedido === null || diaPedido === "" || diaPedido === diaHoy) return diaHoy;
  if (!config.permiteFechaSimulada) {
    throw new ErrorHttp(403, `En ${config.environment} no se permiten fechas simuladas`);
  }
  if (!esDiaValido(diaPedido)) throw new ErrorHttp(400, `Día inválido: ${diaPedido}`);
  return diaPedido;
}

async function listarHabitos(diaPedido) {
  const diaHoy = diaDeReferencia(diaPedido);
  const habitos = await store.listar();
  return habitos
    .map((habito) => conRachaVigente(habito, diaHoy))
    .sort((a, b) => b.rachaVigente - a.rachaVigente || a.nombre.localeCompare(b.nombre));
}

async function crearHabito(req) {
  const { nombre } = await leerJson(req);
  const limpio = typeof nombre === "string" ? nombre.trim() : "";
  if (limpio.length < 2 || limpio.length > 60) {
    throw new ErrorHttp(400, "El nombre debe tener entre 2 y 60 caracteres");
  }
  const habito = nuevoHabito(slug(limpio), limpio);
  await store.crear(habito);
  console.log(`habito creado id=${habito.id} nombre="${habito.nombre}"`);
  return conRachaVigente(habito, hoy(config.zonaHoraria));
}

async function marcarHabito(req, id) {
  const cuerpo = await leerJson(req);
  // Para practicar sin esperar días reales: solo si el ambiente lo permite
  // (PERMITIR_FECHA_SIMULADA=true en lab-msa-dm-rachas/dev/infrastructure.yaml).
  const dia = diaDeReferencia(cuerpo.dia);

  const habito = await store.obtener(id);
  if (!habito) throw new ErrorHttp(404, `No existe el hábito ${id}`);

  let resultado;
  try {
    resultado = marcarDia(habito, dia);
  } catch (error) {
    throw new ErrorHttp(400, error.message);
  }

  if (!resultado.yaMarcado) {
    await store.guardar(resultado.habito, habito.totalDias);
    console.log(`habito marcado id=${id} dia=${dia} racha=${resultado.habito.rachaActual}`);
  }
  return { yaMarcado: resultado.yaMarcado, habito: conRachaVigente(resultado.habito, dia) };
}

async function borrarHabito(req, id) {
  if (!tokenValido(req.headers["x-admin-token"])) {
    throw new ErrorHttp(401, "Token de administrador inválido (header X-Admin-Token)");
  }
  if (!(await store.borrar(id))) throw new ErrorHttp(404, `No existe el hábito ${id}`);
  console.log(`habito borrado id=${id}`);
  return { borrado: id };
}

async function archivoPublico(res, ruta) {
  const nombre = ruta === "/" ? "index.html" : ruta.slice(1);
  // Solo archivos planos de public/ (sin "..", sin subcarpetas).
  if (!/^[a-z0-9_-]+\.[a-z]+$/i.test(nombre) || !TIPOS[extname(nombre)]) return false;
  try {
    const contenido = await readFile(join(carpetaPublica, nombre));
    res.writeHead(200, { "Content-Type": TIPOS[extname(nombre)], "X-Pod": pod });
    res.end(contenido);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- servidor --

let ultimoPingOk = 0;

const servidor = createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, "http://localhost");
  const metodo = req.method;
  const inicio = Date.now();

  try {
    if (metodo === "GET" && pathname === "/health") return responder(res, 200, "ok", "text/plain");

    if (metodo === "GET" && pathname === "/ready") {
      // Se cachea 15 s para no llamar a DynamoDB en cada probe.
      if (Date.now() - ultimoPingOk > 15_000) {
        await store.ping();
        ultimoPingOk = Date.now();
      }
      return responder(res, 200, "ok", "text/plain");
    }

    if (metodo === "GET" && pathname === "/api/info") return responder(res, 200, await info());
    if (metodo === "GET" && pathname === "/api/habitos") return responder(res, 200, await listarHabitos(searchParams.get("dia")));
    if (metodo === "POST" && pathname === "/api/habitos") return responder(res, 201, await crearHabito(req));

    const marcar = pathname.match(/^\/api\/habitos\/([a-z0-9-]+)\/marcar$/);
    if (metodo === "POST" && marcar) return responder(res, 200, await marcarHabito(req, marcar[1]));

    const borrar = pathname.match(/^\/api\/habitos\/([a-z0-9-]+)$/);
    if (metodo === "DELETE" && borrar) return responder(res, 200, await borrarHabito(req, borrar[1]));

    if (metodo === "GET" && (await archivoPublico(res, pathname))) return;

    responder(res, 404, { error: "not found" });
  } catch (error) {
    if (error instanceof ErrorHttp) {
      responder(res, error.status, { error: error.message });
    } else if (error instanceof ConflictoError) {
      responder(res, 409, { error: "Otro pod cambió este hábito al mismo tiempo. Vuelve a intentar." });
    } else {
      // Aquí caen, por ejemplo, los AccessDenied de DynamoDB si IRSA está mal.
      console.error(`ERROR ${metodo} ${pathname}: ${error.name}: ${error.message}`);
      responder(res, 500, { error: `${error.name}: ${error.message}` });
    }
  } finally {
    if (pathname !== "/health" && pathname !== "/ready") {
      console.log(`${metodo} ${pathname} ${res.statusCode} ${Date.now() - inicio}ms`);
    }
  }
});

servidor.listen(config.port, () => {
  console.log(
    `${config.appName} ${config.version} (${config.environment}) escuchando en :${config.port}` +
      ` | almacenamiento: ${store.descripcion} | pod: ${pod}`,
  );
});

// Kubernetes manda SIGTERM antes de matar el pod (por ejemplo, cuando un nodo
// se drena en el upgrade del clúster). Cerramos con calma: dejamos de aceptar
// conexiones nuevas y terminamos las que están en curso.
process.on("SIGTERM", () => {
  console.log("SIGTERM recibido: cerrando el servidor");
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});
