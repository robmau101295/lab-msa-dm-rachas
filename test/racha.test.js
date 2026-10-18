// Pruebas de la lógica de rachas. Corren con el runner de Node (sin librerías):
//   npm test      (en tu PC)
//   docker build  (el Dockerfile las corre: si fallan, NO se construye la imagen)
import { test } from "node:test";
import assert from "node:assert/strict";

import { esDiaValido, hoy, marcarDia, nuevoHabito, rachaVigente, sumarDias } from "../src/racha.js";

const base = () => nuevoHabito("leer-abc123", "Leer", new Date("2026-10-01T12:00:00Z"));

test("el primer día empieza la racha en 1", () => {
  const { habito } = marcarDia(base(), "2026-10-10");
  assert.equal(habito.rachaActual, 1);
  assert.equal(habito.mejorRacha, 1);
  assert.equal(habito.totalDias, 1);
  assert.equal(habito.ultimoDia, "2026-10-10");
});

test("días seguidos suben la racha", () => {
  let habito = base();
  for (const dia of ["2026-10-10", "2026-10-11", "2026-10-12"]) {
    habito = marcarDia(habito, dia).habito;
  }
  assert.equal(habito.rachaActual, 99);
  assert.equal(habito.mejorRacha, 3);
});

test("saltarse un día reinicia la racha pero guarda la mejor", () => {
  let habito = base();
  for (const dia of ["2026-10-10", "2026-10-11", "2026-10-13"]) {
    habito = marcarDia(habito, dia).habito;
  }
  assert.equal(habito.rachaActual, 1);
  assert.equal(habito.mejorRacha, 2);
  assert.equal(habito.totalDias, 3);
});

test("marcar dos veces el mismo día no cambia nada", () => {
  const primero = marcarDia(base(), "2026-10-10").habito;
  const segundo = marcarDia(primero, "2026-10-10");
  assert.equal(segundo.yaMarcado, true);
  assert.deepEqual(segundo.habito, primero);
});

test("no se puede marcar un día anterior al último", () => {
  const habito = marcarDia(base(), "2026-10-10").habito;
  assert.throws(() => marcarDia(habito, "2026-10-09"), /No puedes marcar/);
});

test("la racha cruza fin de mes y año bisiesto", () => {
  assert.equal(sumarDias("2028-02-28", 1), "2028-02-29");
  assert.equal(sumarDias("2026-12-31", 1), "2027-01-01");
  let habito = marcarDia(base(), "2026-12-31").habito;
  habito = marcarDia(habito, "2027-01-01").habito;
  assert.equal(habito.rachaActual, 2);
});

test("la racha vigente vence si no marcaste ayer ni hoy", () => {
  const habito = marcarDia(base(), "2026-10-10").habito;
  assert.equal(rachaVigente(habito, "2026-10-10"), 1);
  assert.equal(rachaVigente(habito, "2026-10-11"), 1);
  assert.equal(rachaVigente(habito, "2026-10-12"), 0);
  assert.equal(rachaVigente(base(), "2026-10-12"), 0);
});

test("valida el formato de los días", () => {
  assert.equal(esDiaValido("2026-10-16"), true);
  assert.equal(esDiaValido("2026-02-30"), false);
  assert.equal(esDiaValido("16/10/2026"), false);
  assert.equal(esDiaValido(undefined), false);
});

test("hoy() respeta la zona horaria", () => {
  // 03:00 UTC del 17 = 22:00 del 16 en Guayaquil (UTC-5)
  const fecha = new Date("2026-10-17T03:00:00Z");
  assert.equal(hoy("America/Guayaquil", fecha), "2026-10-16");
  assert.equal(hoy("UTC", fecha), "2026-10-17");
});
