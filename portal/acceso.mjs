export async function api(action, payload = {}) {
  const response = await fetch("/api/portal", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({...payload,action})
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "No se pudo completar la acción.");
    error.status = response.status;
    throw error;
  }
  return data;
}
