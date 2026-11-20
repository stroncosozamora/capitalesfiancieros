// Tabla general IGC AT 2026 e IUSC 2026 del SII. Montos internos en centavos.
export const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
  "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];
const utm = [69751,69611,69889,69889,70588,71506,71649,71649,71721,72151,72440,72802];
const ufEndCents = [3970607,3979063,3984172,4012020,4061069,4082031,4084479,4087377,4105720,4124763,4143989,null];
const thresholds = [13.5,30,50,70,90,120,310,Infinity];
const rates = [0,40,80,135,230,304,350,400];
const offsets = [0,54,174,449,1114,1780,2332,3882];
export const ANNUAL_CAP = 23836776;
const annualBonusCap = 417252;

function pesos(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 9999999999) throw new Error("Monto inválido");
  return value * 100;
}

function tax(base, unit) {
  const index = thresholds.findIndex(upper => base <= upper * unit * 100);
  const offset = offsets[index] * unit;
  return { base, rate:rates[index] / 10, offset, tax:Math.max(0, Math.round(base * rates[index] / 1000) - offset) };
}

function result(base, applied, unit) {
  const before = tax(base, unit);
  const after = applied === null ? null : tax(base - applied, unit);
  return { before, after, applied, savings:after === null ? null : before.tax - after.tax };
}

export function annualScenario({ base, contribution, room = ANNUAL_CAP, mandatory = null }) {
  const baseCents = pesos(base);
  const contributionCents = pesos(contribution);
  const allowed = Math.min(pesos(room), pesos(ANNUAL_CAP));
  const eligibleA = mandatory === null ? null : Math.min(contributionCents, allowed, 10 * pesos(mandatory));
  return {
    type:"annual", period:"AT 2026", contribution, ...result(baseCents, Math.min(baseCents, contributionCents, allowed), 834504),
    bonus:eligibleA === null ? null : Math.min(annualBonusCap * 100, Math.round(eligibleA * 15 / 100))
  };
}

export function monthlyScenario({ month, base, contribution, prior = 0, employerBase = null }) {
  if (!Number.isInteger(month) || month < 0 || month >= MONTHS.length) throw new Error("Mes inválido");
  const baseCents = pesos(base);
  const contributionCents = pesos(contribution);
  const priorCents = pesos(prior);
  const cap = ufEndCents[month] === null ? null : 50 * ufEndCents[month];
  const applied = contribution === 0 ? 0 : cap === null ? null : Math.min(baseCents, contributionCents, Math.max(0, cap - priorCents));
  const employerRate = month >= 7 ? 3.5 : 1;
  return {
    type:"monthly", period:MONTHS[month] + " 2026", contribution, ...result(baseCents, applied, utm[month]), cap, employerRate,
    employer:employerBase === null ? null : Math.round(pesos(employerBase) * employerRate / 100)
  };
}

const clp = new Intl.NumberFormat("es-CL", {style:"currency",currency:"CLP",maximumFractionDigits:2});
const number = new Intl.NumberFormat("es-CL");
export const money = cents => cents === null ? "—" : clp.format(cents / 100);
export const percent = value => value === 0 ? "Exento" : number.format(value) + " %";
