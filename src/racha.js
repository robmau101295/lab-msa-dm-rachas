// -----------------------------------------------------------------------------
// Lógica de las rachas. No sabe nada de HTTP ni de DynamoDB: solo recibe un
// hábito y un día, y devuelve el hábito actualizado. Por eso es fácil de
// probar (test/racha.test.js) y el Dockerfile corre esas pruebas al construir.
//
// Un hábito se guarda así:
//   { id, nombre, rachaActual, mejorRacha, totalDias, ultimoDia, creado }
// ultimoDia es un texto "YYYY-MM-DD" (el último día que se marcó).
// -----------------------------------------------------------------------------

const DIA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Día de hoy en la zona horaria de la app (APP_TIMEZONE), como "YYYY-MM-DD".
// "en-CA" es el locale que formatea las fechas como YYYY-MM-DD.
export function hoy(zonaHoraria, fecha = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zonaHoraria }).format(fecha);
}

export function esDiaValido(dia) {
  if (typeof dia !== "string" || !DIA_REGEX.test(dia)) return false;
  const fecha = new Date(`${dia}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(dia);
}

export function sumarDias(dia, cantidad) {
  const fecha = new Date(`${dia}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + cantidad);
  return fecha.toISOString().slice(0, 10);
}

export function nuevoHabito(id, nombre, ahora = new Date()) {
  return {
    id,
    nombre,
    rachaActual: 0,
    mejorRacha: 0,
    totalDias: 0,
    ultimoDia: null,
    creado: ahora.toISOString(),
  };
}

// Marca el hábito como cumplido en "dia".
//   - mismo día que el último    -> no cambia nada (yaMarcado = true)
//   - el día siguiente al último -> la racha sube en 1
//   - cualquier otro caso        -> la racha vuelve a empezar en 1
//   - un día ANTERIOR al último  -> error (no se puede marcar el pasado)
export function marcarDia(habito, dia) {
  if (!esDiaValido(dia)) {
    throw new Error(`Día inválido: ${dia}`);
  }
  if (habito.ultimoDia && dia < habito.ultimoDia) {
    throw new Error(`No puedes marcar ${dia}: el último día marcado es ${habito.ultimoDia}`);
  }
  if (habito.ultimoDia === dia) {
    return { habito, yaMarcado: true };
  }

  const continua = habito.ultimoDia === sumarDias(dia, -1);
  const rachaActual = continua ? habito.rachaActual + 1 : 1;

  return {
    yaMarcado: false,
    habito: {
      ...habito,
      rachaActual,
      mejorRacha: Math.max(habito.mejorRacha, rachaActual),
      totalDias: habito.totalDias + 1,
      ultimoDia: dia,
    },
  };
}

// La racha guardada puede estar "vencida": si el último día marcado fue antes
// de ayer, la racha que se muestra es 0 (aunque en la base siga el número viejo).
export function rachaVigente(habito, diaHoy) {
  if (!habito.ultimoDia) return 0;
  if (habito.ultimoDia === diaHoy || habito.ultimoDia === sumarDias(diaHoy, -1)) {
    return habito.rachaActual;
  }
  return 0;
}
