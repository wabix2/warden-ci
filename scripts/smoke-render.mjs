const base = (process.env.WARDEN_SMOKE_URL || "https://warden-ci-dvk5.onrender.com").replace(/\/$/, "");

for (const path of ["/health", "/ready"]) {
  const response = await fetch(`${base}${path}`);
  const body = await response.text();
  if (path === "/health" && response.status !== 200) throw new Error(`${path} returned ${response.status}: ${body}`);
  if (path === "/ready" && ![200, 503].includes(response.status)) throw new Error(`${path} returned ${response.status}: ${body}`);
  console.log(`${path}: ${response.status} ${body.slice(0, 240)}`);
}
