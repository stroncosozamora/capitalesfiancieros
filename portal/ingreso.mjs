import { api } from "./acceso.mjs";

const get = id => document.getElementById(id);
const notice = get("notice");
const submit = get("auth-submit");
const password = get("password");
const next = new URLSearchParams(location.search).get("next");
const destination = next === "polizas" ? "/polizas/" : next === "apv" ? "/herramientas/" : "/portal/";
let signingUp = false;
let submitting = false;

if (location.hash) history.replaceState(null, "", location.pathname + location.search);

get("auth-toggle").addEventListener("click",() => {
  if (submitting) return;
  signingUp = !signingUp;
  get("auth-title").textContent = signingUp ? "Crea tu cuenta" : "Inicia sesión";
  submit.textContent = signingUp ? "Registrarme" : "Ingresar";
  get("auth-toggle").textContent = signingUp ? "Iniciar sesión" : "Crear cuenta";
  get("register-prompt").textContent = signingUp ? "¿Ya tienes cuenta?" : "¿Primera vez aquí?";
  get("auth-help").hidden = !signingUp;
  password.minLength = signingUp ? 12 : 1;
  password.autocomplete = signingUp ? "new-password" : "current-password";
  notice.textContent = "";
});

get("auth-form").addEventListener("submit",async event => {
  event.preventDefault();
  if (submitting) return;
  const registering = signingUp;
  submitting = true;
  submit.disabled = true;
  notice.textContent = "";
  try {
    const response = await api(registering ? "signup" : "signin",{email:get("email").value,password:password.value});
    password.value = "";
    if (!registering) {
      location.replace(destination);
      return;
    }
    submitting = false;
    get("auth-toggle").click();
    notice.textContent = response.message;
  } catch (error) {
    notice.textContent = error.message;
  } finally {
    submitting = false;
    submit.disabled = false;
  }
});

api("session").then(() => {
  if (!submitting && !signingUp) location.replace(destination);
}).catch(error => {
  if (!submitting && error.status !== 401) notice.textContent = error.message;
});
