const DEFAULT_URL = "https://censo.gestiondelamianto.com/#/city:37CB4017";

const urlEl = document.getElementById("url");
const refsEl = document.getElementById("refs");
const zoomEl = document.getElementById("zoom");
const btnEl = document.getElementById("btn");
const logEl = document.getElementById("log");

urlEl.value = DEFAULT_URL;

function appendLog(line) {
  logEl.textContent += (logEl.textContent ? "\n" : "") + line;
  logEl.scrollTop = logEl.scrollHeight;
}

btnEl.addEventListener("click", async () => {
  logEl.textContent = "";
  btnEl.disabled = true;

  try {
    const z = parseInt(zoomEl.value, 10);
    const zoomClicks = Number.isFinite(z) && z >= 1 ? z : 5;

    const startRes = await fetch("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: urlEl.value.trim(),
        refsText: refsEl.value,
        zoomClicks,
      }),
    });

    if (!startRes.ok) {
      const body = await startRes.json().catch(() => ({}));
      appendLog(`\n✖ ${body.error || startRes.statusText}`);
      btnEl.disabled = false;
      return;
    }

    const { jobId } = await startRes.json();
    const source = new EventSource(`/api/capture/${jobId}/events`);

    source.addEventListener("log", (ev) => appendLog(JSON.parse(ev.data)));
    source.addEventListener("done", (ev) => {
      const payload = JSON.parse(ev.data);
      source.close();
      btnEl.disabled = false;
      if (payload.ok) {
        window.location = `/api/capture/${jobId}/download`;
      } else if (payload.error) {
        appendLog(`\n✖ ${payload.error}`);
      }
    });
    source.onerror = () => {
      appendLog("\n✖ Se perdió la conexión con el servidor.");
      source.close();
      btnEl.disabled = false;
    };
  } catch (e) {
    appendLog(`\n✖ ${e.message || e}`);
    btnEl.disabled = false;
  }
});
