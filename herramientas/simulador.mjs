import { annualScenario, monthlyScenario, MONTHS, money, percent } from "./impuestos.mjs";

const get = id => document.getElementById(id);
const form = get("calculator");
const month = get("month");
MONTHS.forEach((name,index) => month.add(new Option(name,index)));
month.value = "10";
let mode;
let current;
let values = {annual:{base:27000000,contribution:2400000},monthly:{base:2300000,contribution:200000}};

const read = id => get(id).value === "" ? null : get(id).valueAsNumber;
function setMode(next) {
  if (mode) values[mode] = {base:get("base").value,contribution:get("contribution").value};
  mode = next;
  const annual = mode === "annual";
  get("annual-mode").setAttribute("aria-pressed",String(annual));
  get("monthly-mode").setAttribute("aria-pressed",String(!annual));
  ["month-field","prior-field","monthly-details"].forEach(id => { get(id).hidden = annual; });
  ["room-field","annual-details"].forEach(id => { get(id).hidden = !annual; });
  for (const id of ["room","mandatory"]) get(id).disabled = !annual;
  for (const id of ["prior","employer"]) get(id).disabled = annual;
  get("period-note").textContent = annual ? "AT 2026 · Rentas de 2025" : "Tabla general del SII · Año 2026";
  get("base").value = values[mode].base;
  get("contribution").value = values[mode].contribution;
  update();
}

function update() {
  const common = {type:mode,base:read("base"),contribution:read("contribution")};
  const annual = mode === "annual";
  const input = annual ? {...common,room:read("room"),mandatory:read("mandatory")}
    : {...common,month:Number(month.value),prior:read("prior"),employerBase:read("employer")};
  let scenario = null;
  try {
    if (form.checkValidity()) scenario = annual ? annualScenario(input) : monthlyScenario(input);
  } catch {
    // Incomplete input leaves the comparison blank until the amounts are valid.
  }
  current = scenario?.after ? input : null;
  get("transfer").disabled = current === null;
  const rows = get("comparison").rows;
  const format = [money,percent,money,money];
  ["base","rate","offset","tax"].forEach((key,index) => {
    [scenario?.before,scenario?.after].forEach((value,column) => {
      rows[index].cells[column + 1].textContent = value ? format[index](value[key]) : "—";
    });
  });
  get("savings").textContent = "Disminución del impuesto · " + money(scenario?.savings ?? null);
  get("result-note").textContent = annual
    ? "Impuesto determinado antes de créditos, PPM y retenciones."
    : "El límite anual compartido de 600 UF se revisa por separado.";
  get("apv-note").textContent = annual
    ? "Aporte directo elegible, actualizado y todavía disponible para rebajar."
    : scenario?.cap ? "Tope de 50 UF del mes: " + money(scenario.cap)
      : "El escenario con aporte positivo requiere la UF oficial de cierre del mes.";
  get("bonus").textContent = "Bonificación fiscal estimada · " + money(scenario?.bonus ?? null);
  get("employer-result").textContent = "Aporte del empleador · " + money(scenario?.employer ?? null)
    + (scenario?.employerRate === 1 ? " · 1 % adicional, SIS por separado" : " · 3,5 % con SIS incluido");
}

form.addEventListener("submit",event => event.preventDefault());
form.addEventListener("input",update);
get("annual-mode").addEventListener("click",() => setMode("annual"));
get("monthly-mode").addEventListener("click",() => setMode("monthly"));
get("transfer").addEventListener("click",() => {
  if (!current) return;
  try {
    sessionStorage.setItem("cf-advisory-scenario",JSON.stringify(current));
    location.assign("/portal/#asesorias");
  } catch {
    get("calc-status").textContent = "El navegador impidió transferir el escenario.";
  }
});
setMode("annual");
