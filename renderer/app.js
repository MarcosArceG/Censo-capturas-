const DEFAULT_URL = "https://censo.gestiondelamianto.com/#/city:37CB4017";

const urlEl = document.getElementById("url");
const refsEl = document.getElementById("refs");
const zoomEl = document.getElementById("zoom");
const btnEl = document.getElementById("btn");
const logEl = document.getElementById("log");

urlEl.value = DEFAULT_URL;

let removeLogListener = () => {};

function appendLog(line) {
  logEl.textContent += (logEl.textContent ? "\n" : "") + line;
  logEl.scrollTop = logEl.scrollHeight;
}

btnEl.addEventListener("click", async () => {
  removeLogListener();
  logEl.textContent = "";
  btnEl.disabled = true;

  removeLogListener = window.censoCapture.onLog(appendLog);

  try {
    const z = parseInt(zoomEl.value, 10);
    const zoomClicks = Number.isFinite(z) && z >= 1 ? z : 5;
    const result = await window.censoCapture.startCapture({
      url: urlEl.value.trim(),
      refsText: refsEl.value,
      zoomClicks,
    });

    if (!result.ok && result.error !== "cancelado") {
      appendLog(`\n✖ ${result.error}`);
    }
  } catch (e) {
    appendLog(`\n✖ ${e.message || e}`);
  } finally {
    btnEl.disabled = false;
  }
});
