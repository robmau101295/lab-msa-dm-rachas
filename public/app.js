// Lado del navegador: solo llama a la API de /api/... y pinta el resultado.
const $ = (selector) => document.querySelector(selector);

let info = null;

async function api(metodo, ruta, cuerpo, headers = {}) {
  const respuesta = await fetch(ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...headers },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(datos.error ?? `HTTP ${respuesta.status}`);
  return datos;
}

function mensaje(texto, tipo = "") {
  const el = $("#mensaje");
  el.textContent = texto;
  el.className = `mensaje ${tipo}`;
}

function diaSeleccionado() {
  return info?.permiteFechaSimulada && $("#dia").value ? $("#dia").value : undefined;
}

function pintarInfo() {
  $("#saludo").textContent = info.greeting;
  const chip = $("#ambiente");
  chip.textContent = `${info.environment} · ${info.version}`;
  chip.dataset.ambiente = info.environment;

  const filas = [
    ["Versión", info.version, "Tag Git del CI → --build-arg APP_VERSION → imagen (Dockerfile)"],
    ["Ambiente", info.environment, "lab-cfg-dm-argo-cd/…/<env>/app.yaml → environment → ConfigMap"],
    ["Saludo", info.greeting, "lab-cfg-dm-argo-cd/…/shared-envvars.yaml → ConfigMap"],
    ["Pod", info.pod, "Nombre del pod (Deployment del Helm chart)"],
    ["Almacenamiento", info.almacenamiento, "DYNAMODB_TABLE (<env>/infrastructure.yaml) + tabla de lab-iac-do-k8s-demo"],
    ["Rol IAM (IRSA)", info.irsaRoleArn ?? "(ninguno: corriendo fuera de EKS)", "ServiceAccount de lab-iac-do-k8s-demo → EKS inyecta AWS_ROLE_ARN"],
    ["Token admin", info.secretos.RACHAS_ADMIN_TOKEN ?? "(no configurado)", "Variable group → Secrets Manager → External Secrets → Secret"],
    ["Fecha simulada", info.permiteFechaSimulada ? "permitida" : "no permitida", "PERMITIR_FECHA_SIMULADA (<env>/infrastructure.yaml)"],
  ];
  const cuerpo = $("#origen");
  cuerpo.replaceChildren(
    ...filas.map(([dato, valor, origen]) => {
      const tr = document.createElement("tr");
      for (const texto of [dato, valor, origen]) {
        const td = document.createElement("td");
        td.textContent = texto;
        tr.append(td);
      }
      return tr;
    }),
  );

  if (info.permiteFechaSimulada) {
    $("#simulacion").hidden = false;
    if (!$("#dia").value) $("#dia").value = info.hoy;
  }
}

function pintarHabitos(habitos) {
  const contenedor = $("#habitos");
  if (habitos.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "tenue vacio";
    vacio.textContent = "Todavía no hay hábitos. Agrega el primero arriba.";
    contenedor.replaceChildren(vacio);
    return;
  }

  const plantilla = $("#tpl-habito");
  contenedor.replaceChildren(
    ...habitos.map((habito) => {
      const nodo = plantilla.content.firstElementChild.cloneNode(true);
      nodo.classList.toggle("apagado", habito.rachaVigente === 0);
      nodo.querySelector(".numero").textContent = habito.rachaVigente;
      nodo.querySelector(".nombre").textContent = habito.nombre;
      nodo.querySelector(".stats").textContent =
        `Mejor racha: ${habito.mejorRacha} · Total: ${habito.totalDias} días · Último: ${habito.ultimoDia ?? "nunca"}`;

      const marcar = nodo.querySelector(".marcar");
      const dia = diaSeleccionado() ?? info?.hoy;
      if (dia !== info?.hoy) marcar.textContent = `Marcar ${dia}`;
      if (habito.ultimoDia === dia) {
        marcar.textContent = "✓ Hecho";
        marcar.disabled = true;
      }
      marcar.addEventListener("click", () => marcarHabito(habito));
      nodo.querySelector(".borrar").addEventListener("click", () => borrarHabito(habito));
      return nodo;
    }),
  );
}

async function cargar() {
  try {
    info = await api("GET", "/api/info");
    pintarInfo();
    const dia = diaSeleccionado();
    pintarHabitos(await api("GET", dia ? `/api/habitos?dia=${dia}` : "/api/habitos"));
  } catch (error) {
    mensaje(`No se pudo cargar: ${error.message}`, "error");
  }
}

async function marcarHabito(habito) {
  try {
    const { yaMarcado, habito: nuevo } = await api("POST", `/api/habitos/${habito.id}/marcar`, { dia: diaSeleccionado() });
    mensaje(yaMarcado ? `"${habito.nombre}" ya estaba marcado ese día.` : `🔥 ${nuevo.nombre}: racha de ${nuevo.rachaActual}`, "ok");
  } catch (error) {
    mensaje(error.message, "error");
  }
  await cargar();
}

async function borrarHabito(habito) {
  const token = prompt(`Token de administrador para borrar "${habito.nombre}":`);
  if (!token) return;
  try {
    await api("DELETE", `/api/habitos/${habito.id}`, undefined, { "X-Admin-Token": token });
    mensaje(`"${habito.nombre}" borrado.`, "ok");
  } catch (error) {
    mensaje(error.message, "error");
  }
  await cargar();
}

$("#form-nuevo").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const input = $("#nombre");
  try {
    await api("POST", "/api/habitos", { nombre: input.value });
    input.value = "";
    mensaje("Hábito creado.", "ok");
  } catch (error) {
    mensaje(error.message, "error");
  }
  await cargar();
});

$("#dia").addEventListener("change", cargar);
$("#dia-siguiente").addEventListener("click", () => {
  const actual = new Date(`${$("#dia").value || info.hoy}T00:00:00Z`);
  actual.setUTCDate(actual.getUTCDate() + 1);
  $("#dia").value = actual.toISOString().slice(0, 10);
  cargar();
});

cargar();
