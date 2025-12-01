/* ---------------------------------------------------------------
   LIFE COO — OPTION C — ULTRA LUXURY BASELINE (Dec 1)
   Stable, minimal, predictable. No airline dropdown yet.
   Backend → https://life-coo-realtime-backend.onrender.com
--------------------------------------------------------------- */

const API_BASE = "https://life-coo-realtime-backend.onrender.com";

// DOM Elements ---------------------------------------------------
const agentTextarea = document.getElementById("agent-textarea");
const speakBtn = document.getElementById("speak-btn");
const stopBtn = document.getElementById("stop-btn");

const fillBtn = document.getElementById("fill-btn");
const optimizeBtn = document.getElementById("optimize-btn");

const originInput = document.getElementById("origin-input");
const destinationInput = document.getElementById("destination-input");
const windowInput = document.getElementById("window-input");
const travellersInput = document.getElementById("travellers-input");
const preferencesInput = document.getElementById("preferences-input");
const notesInput = document.getElementById("notes-input");

// RHS Result blocks
const recapContent = document.getElementById("recap-content");
const optionsContent = document.getElementById("options-content");
const riskContent = document.getElementById("risk-content");

// ---------------------------------------------------------------
// Voice Recognition
// ---------------------------------------------------------------
let recognition = null;
if ("webkitSpeechRecognition" in window) {
  recognition = new webkitSpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    speakBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
  };

  recognition.onend = () => {
    speakBtn.classList.remove("hidden");
    stopBtn.classList.add("hidden");
  };

  recognition.onerror = () => {
    speakBtn.classList.remove("hidden");
    stopBtn.classList.add("hidden");
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    agentTextarea.value = transcript;
    runInterpret();
  };
}

// Voice triggers -------------------------------------------------
speakBtn?.addEventListener("click", () => {
  if (recognition) recognition.start();
});

stopBtn?.addEventListener("click", () => {
  if (recognition) recognition.stop();
});

// ---------------------------------------------------------------
// API Helpers
// ---------------------------------------------------------------
async function postJSON(url, payload) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("Bad response from server");
    return await response.json();
  } catch (err) {
    console.error("POST ERROR:", err);
    return { error: true };
  }
}

// ---------------------------------------------------------------
// INTERPRET → Populate the form
// ---------------------------------------------------------------
async function runInterpret() {
  const text = agentTextarea.value.trim();
  if (!text) return;

  fillBtn.innerText = "Understanding your trip…";
  fillBtn.disabled = true;

  const result = await postJSON(`${API_BASE}/interpret`, { text });

  fillBtn.innerText = "Let AI fill this form";
  fillBtn.disabled = false;

  if (result.error) {
    alert("AI could not understand the request. Try rephrasing?");
    return;
  }

  // Fill form fields
  originInput.value = result.origin || "";
  destinationInput.value = result.destination || "";
  windowInput.value = result.window || "";
  travellersInput.value = result.travellers || "";
  preferencesInput.value = result.preferences || "";
  notesInput.value = result.notes || "";

  // Immediately optimize after interpret (Option C default)
  runOptimize();
}

// Manual button for interpret
fillBtn?.addEventListener("click", runInterpret);

// ---------------------------------------------------------------
// OPTIMIZE → Generate Recap, Options, Risk Radar
// ---------------------------------------------------------------
async function runOptimize() {
  const origin = originInput.value.trim();
  const destination = destinationInput.value.trim();

  if (!origin || !destination) {
    alert("Origin and Destination are required.");
    return;
  }

  optimizeBtn.innerText = "Optimizing route…";
  optimizeBtn.disabled = true;

  const payload = {
    origin,
    destination,
    window: windowInput.value.trim(),
    travellers: travellersInput.value.trim(),
    preferences: preferencesInput.value.trim(),
    notes: notesInput.value.trim(),
  };

  const result = await postJSON(`${API_BASE}/optimize`, payload);

  optimizeBtn.innerText = "Optimize";
  optimizeBtn.disabled = false;

  if (result.error) {
    recapContent.innerHTML = `<p class="placeholder">AI could not optimize. Try again.</p>`;
    return;
  }

  // Write RHS sections
  recapContent.innerHTML = formatList(result.recap || []);
  optionsContent.innerHTML = formatRoutingBlocks(result.options || []);
  riskContent.innerHTML = formatList(result.risk || []);
}

// Manual button for optimize
optimizeBtn?.addEventListener("click", runOptimize);

// ---------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------
function formatList(items) {
  if (!items.length) return `<p class="placeholder">No details.</p>`;
  return `<ul class="results-list">${items.map(li => `<li>${li}</li>`).join("")}</ul>`;
}

function formatRoutingBlocks(options) {
  if (!options.length)
    return `<p class="placeholder">No routing options provided.</p>`;

  return options
    .map(
      (opt) => `
      <div class="option-block">
        <div class="option-title">${opt.title}</div>
        <ul class="option-bullets">
          ${opt.bullets.map((b) => `<li>${b}</li>`).join("")}
        </ul>
      </div>
    `
    )
    .join("");
}
