/* ---------------------------------------------------------------
   LIFE COO — FRONTEND (Option C, Render-aligned)
   - Matches Option C index.html
   - Talks to Render backend index.js
   - Stable, minimal, UAT-ready
--------------------------------------------------------------- */

const API_BASE = "https://life-coo-realtime-backend.onrender.com";

// DOM REFERENCES ------------------------------------------------

// Header / drive mode
const driveToggle = document.getElementById("driveToggle");

// Agent box + actions
const agentBox = document.getElementById("agentBox");
const agentInput = document.getElementById("agentInput");
const voiceBtn = document.getElementById("voiceBtn");
const aiFillBtn = document.getElementById("aiFillBtn");
const aiFillOptimizeBtn = document.getElementById("aiFillOptimizeBtn");

// Form fields
const originInput = document.getElementById("origin");
const destinationInput = document.getElementById("destination");
const datesInput = document.getElementById("dates");
const travellersInput = document.getElementById("travellers");
const preferencesInput = document.getElementById("preferences");
const outputStyleSelect = document.getElementById("outputStyle");
const notesInput = document.getElementById("notes");

// Sample + profile
const sampleBtn = document.getElementById("sampleBtn");
const routingUpdated = document.getElementById("routingUpdated");
const rememberProfileCheckbox = document.getElementById("rememberProfile");
const loadProfileBtn = document.getElementById("loadProfileBtn");

// Optimize
const optimizeBtn = document.getElementById("optimizeBtn");
const playRecapCheckbox = document.getElementById("playRecap");

// Results (RHS)
const recapList = document.getElementById("recapList");
const optionsContainer = document.getElementById("optionsContainer");
const riskList = document.getElementById("riskList");

// Risk pills
const riskLow = document.getElementById("riskLow");
const riskMedium = document.getElementById("riskMedium");
const riskHigh = document.getElementById("riskHigh");

// Airports datalist
const airportListEl = document.getElementById("airportList");

// Profile storage key
const PROFILE_KEY = "lifeCooFamilyProfile_v1";

// ---------------------------------------------------------------
// INIT
// ---------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  hydrateAirportDatalist();
  resetResults();
});

// ---------------------------------------------------------------
// AIRPORT DATALIST (from airports.json)
// ---------------------------------------------------------------
async function hydrateAirportDatalist() {
  if (!airportListEl) return;
  try {
    const res = await fetch("airports.json");
    if (!res.ok) return;
    const airports = await res.json();
    airportListEl.innerHTML = "";
    airports.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = `${a.city} (${a.code})`;
      opt.label = `${a.city} (${a.code}) – ${a.name}`;
      airportListEl.appendChild(opt);
    });
  } catch (err) {
    console.error("Error loading airports.json", err);
  }
}

// ---------------------------------------------------------------
// BASIC UI HELPERS
// ---------------------------------------------------------------
function showRoutingUpdated(message) {
  if (!routingUpdated) return;
  routingUpdated.textContent = message || "Routing updated";
  routingUpdated.classList.remove("hidden");
}

function resetResults() {
  if (recapList) {
    recapList.innerHTML = "<li>No recap yet.</li>";
  }
  if (optionsContainer) {
    optionsContainer.innerHTML = '<div class="placeholder">No routing options yet.</div>';
  }
  if (riskList) {
    riskList.innerHTML = "<li>No risk details yet.</li>";
  }
}

// Risk pill highlight
function setRiskLevel(level) {
  if (!riskLow || !riskMedium || !riskHigh) return;

  [riskLow, riskMedium, riskHigh].forEach((pill) => {
    pill.style.opacity = "0.4";
    pill.style.boxShadow = "none";
  });

  let active = null;
  if (level === "Low") active = riskLow;
  else if (level === "High") active = riskHigh;
  else active = riskMedium; // default Medium

  if (active) {
    active.style.opacity = "1";
    active.style.boxShadow = "0 0 15px rgba(56,189,248,0.5)";
  }
}

// ---------------------------------------------------------------
// API HELPER (POST JSON)
// ---------------------------------------------------------------
async function postJSON(path, body) {
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      console.error("API error:", res.status, await res.text());
      return { error: true };
    }
    return await res.json();
  } catch (err) {
    console.error("Network error:", err);
    return { error: true };
  }
}

// ---------------------------------------------------------------
// INTERPRET (free text → structured form)
// ---------------------------------------------------------------
async function runInterpret(autoOptimize = false) {
  const text = (agentInput?.value || "").trim();
  if (!text) return;

  if (aiFillBtn) {
    aiFillBtn.disabled = true;
    aiFillBtn.textContent = "Understanding your trip…";
  }
  if (aiFillOptimizeBtn) aiFillOptimizeBtn.disabled = true;

  const result = await postJSON("/interpret", { text });

  if (aiFillBtn) {
    aiFillBtn.disabled = false;
    aiFillBtn.textContent = "AI fill form";
  }
  if (aiFillOptimizeBtn) aiFillOptimizeBtn.disabled = false;

  if (result.error) {
    alert("I couldn’t quite understand that. Please try rephrasing.");
    return;
  }

  // Map backend fields → form DOM
  originInput.value = result.origin || "";
  destinationInput.value = result.destination || "";
  datesInput.value = result.datesWindow || "";
  travellersInput.value = result.travellers || "";
  preferencesInput.value = result.preferences || "";
  notesInput.value = result.notes || "";

  showRoutingUpdated(autoOptimize ? "Trip understood. Optimizing now…" : "Trip understood. Ready to optimize.");

  if (autoOptimize) {
    await runOptimize();
  }
}

// Button: AI fill only
aiFillBtn?.addEventListener("click", () => runInterpret(false));

// Button: AI fill + optimize
aiFillOptimizeBtn?.addEventListener("click", () => runInterpret(true));

// ---------------------------------------------------------------
// VOICE INPUT — STREAMING + SANE PAUSE
// ---------------------------------------------------------------
let recognition = null;
let speechFinalTranscript = "";
let speechSilenceTimeout = null;

if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-US";

  // ✅ KEY CHANGES
  recognition.continuous = true;       // keep listening across small pauses
  recognition.interimResults = true;   // stream partial text as you speak

  recognition.onstart = () => {
    if (agentBox) agentBox.classList.add("agent-box-active");
    if (voiceBtn) voiceBtn.textContent = "Listening…";
    if (agentInput) {
      agentInput.placeholder = "Listening… speak naturally.";
    }
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    if (agentBox) agentBox.classList.remove("agent-box-active");
    if (voiceBtn) voiceBtn.textContent = "Tap to speak";
    if (agentInput) {
      agentInput.placeholder = "Describe your trip to your Travel COO…";
    }
    if (speechSilenceTimeout) {
      clearTimeout(speechSilenceTimeout);
      speechSilenceTimeout = null;
    }
  };

  recognition.onresult = (event) => {
    let interimTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;

      if (result.isFinal) {
        speechFinalTranscript += transcript + " ";
      } else {
        interimTranscript += transcript + " ";
      }
    }

    // ✅ LIVE STREAMING TEXT (final + interim)
    const combined = (speechFinalTranscript + interimTranscript).trim();
    if (agentInput) agentInput.value = combined;

    // ✅ Reset silence timer on every result
    if (speechSilenceTimeout) {
      clearTimeout(speechSilenceTimeout);
    }
    // If user is silent for 2 seconds, stop & process
    speechSilenceTimeout = setTimeout(() => {
      recognition.stop();
    }, 2000); // Increase to 2500–3000 if you want more breathing room
  };

  recognition.onend = () => {
    if (speechSilenceTimeout) {
      clearTimeout(speechSilenceTimeout);
      speechSilenceTimeout = null;
    }
    if (agentBox) agentBox.classList.remove("agent-box-active");
    if (voiceBtn) voiceBtn.textContent = "Tap to speak";
    if (agentInput && !agentInput.value) {
      agentInput.placeholder = "Describe your trip to your Travel COO…";
    }

    const finalText = agentInput ? agentInput.value.trim() : "";
    if (!finalText) {
      // nothing captured, don’t call backend
      return;
    }

    // 🔴 THIS IS THE CRITICAL LINE:
    // Use your existing pipeline exactly as before
    // This will call /interpret with agentInput.value, then /optimize
    runInterpret(true);
  };
}

voiceBtn?.addEventListener("click", () => {
  if (!recognition) {
    alert("Voice input is not supported in this browser.");
    return;
  }

  // reset state for a fresh capture
  speechFinalTranscript = "";
  if (speechSilenceTimeout) {
    clearTimeout(speechSilenceTimeout);
    speechSilenceTimeout = null;
  }

  if (agentInput) {
    agentInput.value = "";
    agentInput.placeholder = "Listening… speak naturally.";
  }

  recognition.start();
});

// ==== END VOICE RECOGNITION v2 ====

// ---------------------------------------------------------------
// OPTIMIZE — form → backend → RHS
// ---------------------------------------------------------------
async function runOptimize() {
  const origin = originInput.value.trim();
  const destination = destinationInput.value.trim();

  if (!origin || !destination) {
    alert("Origin and Destination are required.");
    return;
  }

  const datesWindow = datesInput.value.trim();
  const travellers = travellersInput.value.trim();
  const preferences = preferencesInput.value.trim();
  const notes = notesInput.value.trim();
  const outputStyle =
    (outputStyleSelect.value || "Executive summary (C-suite / family office)").trim();

  optimizeBtn.disabled = true;
  optimizeBtn.textContent = "Optimizing route…";

  // Optionally save profile
  if (rememberProfileCheckbox?.checked) {
    saveProfile();
  }

  const payload = {
    origin,
    destination,
    datesWindow,
    travellers,
    preferences,
    outputStyle,
    notes
  };

  const result = await postJSON("/optimize", payload);

  optimizeBtn.disabled = false;
  optimizeBtn.textContent = "Optimize route ✈️";

  if (result.error) {
    alert("I couldn’t optimize this route. Please try again.");
    return;
  }

  renderResults(result);
  showRoutingUpdated("Routing updated just now.");

  if (playRecapCheckbox?.checked) {
    speakSummary(result);
  }
}

optimizeBtn?.addEventListener("click", runOptimize);

// ---------------------------------------------------------------
// RENDER RESULTS (RHS)
// ---------------------------------------------------------------
function renderResults(data) {
  const execRecapBullets = Array.isArray(data.execRecapBullets)
    ? data.execRecapBullets
    : [];
  const routingOptions = Array.isArray(data.routingOptions)
    ? data.routingOptions
    : [];
  const riskRadarBullets = Array.isArray(data.riskRadarBullets)
    ? data.riskRadarBullets
    : [];

  // Recap
  recapList.innerHTML = "";
  if (!execRecapBullets.length) {
    recapList.innerHTML = "<li>No recap returned.</li>";
  } else {
    execRecapBullets.forEach((b) => {
      const li = document.createElement("li");
      li.textContent = b;
      recapList.appendChild(li);
    });
  }

  // Options
  optionsContainer.innerHTML = "";
  if (!routingOptions.length) {
    optionsContainer.innerHTML = '<div class="placeholder">No routing options returned.</div>';
  } else {
    routingOptions.forEach((opt) => {
      const block = document.createElement("div");
      block.className = "option-block";

      const title = document.createElement("div");
      title.className = "option-title";
      title.textContent = opt.title || "Option";
      block.appendChild(title);

      const ul = document.createElement("ul");
      ul.className = "option-bullets";
      (opt.bullets || []).forEach((b) => {
        const li = document.createElement("li");
        li.textContent = b;
        ul.appendChild(li);
      });
      block.appendChild(ul);

      optionsContainer.appendChild(block);
    });
  }

  // Risk
  riskList.innerHTML = "";
  if (!riskRadarBullets.length) {
    riskList.innerHTML = "<li>No risk details returned.</li>";
  } else {
    riskRadarBullets.forEach((b) => {
      const li = document.createElement("li");
      li.textContent = b;
      riskList.appendChild(li);
    });
  }

  // Risk level pill
  setRiskLevel(data.riskLevel || "Medium");
}

// ---------------------------------------------------------------
// SPEAK SUMMARY (cleaner, de-garbled recap)
// ---------------------------------------------------------------
function speakSummary(data) {
  if (!("speechSynthesis" in window)) return;

  // Stop any previous speech so we don't overlap
  window.speechSynthesis.cancel();

  const execBullets = Array.isArray(data.execRecapBullets)
    ? data.execRecapBullets
    : [];
  const routingOptions = Array.isArray(data.routingOptions)
    ? data.routingOptions
    : [];
  const riskRadarBullets = Array.isArray(data.riskRadarBullets)
    ? data.riskRadarBullets
    : [];

  const pieces = [];

  // 1) Top recap (first 2 bullets)
  if (execBullets.length) {
    pieces.push(execBullets.slice(0, 2).join(". "));
  }

  // 2) Best option (title + first 1–2 bullets)
  if (routingOptions[0]) {
    const opt = routingOptions[0];
    const optBullets = Array.isArray(opt.bullets) ? opt.bullets : [];
    let optText = opt.title || "Best option";
    if (optBullets.length) {
      optText += ". " + optBullets.slice(0, 2).join(". ");
    }
    pieces.push("Best option: " + optText);
  }

  // 3) Alternate option (optional)
  if (routingOptions[1]) {
    const alt = routingOptions[1];
    const altBullets = Array.isArray(alt.bullets) ? alt.bullets : [];
    let altText = alt.title || "Alternate option";
    if (altBullets.length) {
      altText += ". " + altBullets.slice(0, 2).join(". ");
    }
    pieces.push("Alternate option: " + altText);
  }

  // 4) Risk level + key risks
  const risk = data.riskLevel || "Medium";
  pieces.push("Overall risk level: " + risk + ".");

  if (riskRadarBullets.length) {
    pieces.push("Key risks: " + riskRadarBullets.slice(0, 3).join(". "));
  }

  // Join and clean the text so it sounds natural
  let summary = pieces.join(". ");

  summary = summary
    .replace(/[\r\n]+/g, " ")   // newlines -> spaces
    .replace(/\s+/g, " ")       // collapse spaces
    .replace(/\.\s*\./g, ".")   // remove duplicated dots
    .trim();

  const utterance = new SpeechSynthesisUtterance(summary);
  utterance.lang = "en-US";
  utterance.rate = 0.98;  // slightly slower, warmer
  utterance.pitch = 1.0;

  window.speechSynthesis.speak(utterance);
}

// ---------------------------------------------------------------
// SAMPLE + PROFILE
// ---------------------------------------------------------------
sampleBtn?.addEventListener("click", () => {
  originInput.value = "Calgary (YYC)";
  destinationInput.value = "London (LHR)";
  datesInput.value = "Mid-July, flexible ±2 days";
  travellersInput.value = "2 adults, 2 kids";
  preferencesInput.value = "1 stop, layover under 4 hours, daytime flights";
  outputStyleSelect.value = "Executive summary (C-suite / family office)";
  notesInput.value = "Kids are 8 and 10; prefer calm connections.";
  showRoutingUpdated("Sample trip loaded. Ready to optimize.");
});

function saveProfile() {
  try {
    const profile = {
      origin: originInput.value,
      destination: destinationInput.value,
      datesWindow: datesInput.value,
      travellers: travellersInput.value,
      preferences: preferencesInput.value,
      outputStyle: outputStyleSelect.value,
      notes: notesInput.value
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (err) {
    console.error("Error saving profile", err);
  }
}

loadProfileBtn?.addEventListener("click", () => {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) {
      alert("No saved family profile yet.");
      return;
    }
    const profile = JSON.parse(raw);
    originInput.value = profile.origin || "";
    destinationInput.value = profile.destination || "";
    datesInput.value = profile.datesWindow || "";
    travellersInput.value = profile.travellers || "";
    preferencesInput.value = profile.preferences || "";
    outputStyleSelect.value = profile.outputStyle || "";
    notesInput.value = profile.notes || "";
    showRoutingUpdated("Saved family profile loaded.");
  } catch (err) {
    console.error("Error loading profile", err);
  }
});

// ---------------------------------------------------------------
// DRIVE MODE (visual only for now)
// ---------------------------------------------------------------
driveToggle?.addEventListener("click", () => {
  const isActive = driveToggle.classList.toggle("drive-switch-active");
  document.body.classList.toggle("drive-mode", isActive);
});
