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

// NEW: remember last optimize result globally
let lastOptimizeResult = null;

// ---------------------------------------------------------------
// UI STATE (Upgrade 2 Step 2)
// ---------------------------------------------------------------
const UI_STATES = {
  IDLE: "Idle",
  LISTENING: "Listening",
  UNDERSTANDING: "Understanding",
  OPTIMIZING: "Optimizing",
  SPEAKING: "Speaking",
  ERROR: "Error",
};

let uiState = UI_STATES.IDLE;

function setUIState(nextState, messageOverride = "") {
  uiState = nextState;

  // 1) Human-friendly status text
  const defaultMessage =
    nextState === UI_STATES.IDLE ? "Ready." :
    nextState === UI_STATES.LISTENING ? "Listening…" :
    nextState === UI_STATES.UNDERSTANDING ? "Understanding your trip…" :
    nextState === UI_STATES.OPTIMIZING ? "Optimizing your routing…" :
    nextState === UI_STATES.SPEAKING ? "Playing spoken recap…" :
    "Something went wrong. Try again.";

  showRoutingUpdated(messageOverride || defaultMessage);

  // 2) Basic guardrails: prevent double clicks during “busy” states
  const isBusy =
    nextState === UI_STATES.LISTENING ||
    nextState === UI_STATES.UNDERSTANDING ||
    nextState === UI_STATES.OPTIMIZING ||
    nextState === UI_STATES.SPEAKING;

  if (optimizeBtn) optimizeBtn.disabled = isBusy;
  if (aiFillBtn) aiFillBtn.disabled = isBusy;
  if (aiFillOptimizeBtn) aiFillOptimizeBtn.disabled = isBusy;

  // Keep voice available unless browser doesn’t support it
  if (voiceBtn) voiceBtn.disabled = false;

  // 3) Button labels (tiny polish)
  if (optimizeBtn) {
    optimizeBtn.textContent =
      nextState === UI_STATES.OPTIMIZING ? "Optimizing route…" : "Optimize route ✈️";
  }
}

// NEW: prevent overlapping recap audio
let activeAudio = null;

let speakToken = 0; // cancels older in-flight speakSummary calls

// ---------------------------------------------------------------
// DRIVE MODE — Upgrade 3A (hands-free core)
// ---------------------------------------------------------------
let driveModeActive = false;
let driveModePrevPlayRecap = null;

function setDriveMode(isOn) {
  driveModeActive = isOn;

  // Auto-enable recap while in Drive Mode (luxury, no taps needed)
  if (playRecapCheckbox) {
    if (isOn) {
      driveModePrevPlayRecap = playRecapCheckbox.checked;
      playRecapCheckbox.checked = true;
    } else if (driveModePrevPlayRecap !== null) {
      playRecapCheckbox.checked = driveModePrevPlayRecap;
      driveModePrevPlayRecap = null;
    }
  }

  if (isOn) {
    setUIState(UI_STATES.LISTENING, "Drive Mode on. Listening…");
    startListeningDriveMode();
  } else {
    setUIState(UI_STATES.IDLE, "Drive Mode off.");
  }
}

// Returns true if handled (so we don’t send it to /interpret)
function handleDriveModeCommand(rawText) {
  const text = (rawText || "").trim().toLowerCase();
  if (!text) return false;

  // Safety: don’t accept voice commands while speaking (echo risk)
  if (uiState === UI_STATES.SPEAKING) return true;

  // Stop recap
  if (text.includes("stop recap") || text === "stop") {
    speakToken++; // cancel any in-flight recap
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }
    setUIState(UI_STATES.IDLE, "Recap stopped.");
    // In Drive Mode, resume listening
    if (driveModeActive) startListeningDriveMode();
    return true;
  }

  // Replay recap (last result)
  if (text.includes("replay recap") || text.includes("replay") || text.includes("play recap again")) {
    if (!lastOptimizeResult) {
      setUIState(UI_STATES.ERROR, "Nothing to replay yet. Optimize a trip first.");
      if (driveModeActive) startListeningDriveMode();
      return true;
    }
    speakSummary(lastOptimizeResult);
    return true;
  }

  // (Optional) Rewind 10s — only works if audio is currently playing
  // Note: We are NOT listening during playback in Drive Mode, so this is mainly useful after playback ends.
  if (text.includes("rewind 10") || text.includes("rewind ten")) {
    if (activeAudio) {
      activeAudio.currentTime = Math.max(0, (activeAudio.currentTime || 0) - 10);
      setUIState(UI_STATES.SPEAKING, "Rewound 10 seconds.");
    } else {
      setUIState(UI_STATES.ERROR, "No recap is playing right now.");
      if (driveModeActive) startListeningDriveMode();
    }
    return true;
  }

  // Not a command
  return false;
}

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

// Helper: POST with a single silent retry + timeout
async function postJSONWithRetry(path, body, options = {}) {
  const {
    maxRetries = 1,
    timeoutMs = 15000, // 15s per attempt
  } = options;

  const url = `${API_BASE}${path}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const isServerError = res.status >= 500 && res.status < 600;

        // retry only on 5xx
        if (attempt < maxRetries && isServerError) {
          console.warn(
            `[postJSONWithRetry] Attempt ${attempt + 1} failed with ${res.status}, retrying...`
          );
          continue;
        }

        console.error(
          "postJSONWithRetry final HTTP error:",
          res.status,
          await res.text()
        );
        return { error: true };
      }

      // 🎉 success
      return await res.json();
    } catch (err) {
      clearTimeout(timeoutId);

      const isAbortError = err.name === "AbortError";
      const isNetworkError = err instanceof TypeError;

      if (attempt < maxRetries && (isAbortError || isNetworkError)) {
        console.warn(
          `[postJSONWithRetry] Attempt ${attempt + 1} error, retrying...`,
          err
        );
        continue;
      }

      console.error("postJSONWithRetry final error:", err);
      return { error: true };
    }
  }

  // Fallback (shouldn’t really hit)
  return { error: true };
}

// ---------------------------------------------------------------
// INTERPRET (free text → structured form)
// ---------------------------------------------------------------
async function runInterpret(autoOptimize = false) {
  const text = (agentInput?.value || "").trim();
  if (!text) return;
   setUIState(UI_STATES.UNDERSTANDING);

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
   setUIState(UI_STATES.ERROR, "Couldn’t understand. Please try rephrasing.");
   return;
}

  // Map backend fields → form DOM
  originInput.value = result.origin || "";
  destinationInput.value = result.destination || "";
  datesInput.value = result.datesWindow || "";
  travellersInput.value = result.travellers || "";
  preferencesInput.value = result.preferences || "";
  notesInput.value = result.notes || "";

  if (autoOptimize) {
     // If interpret didn’t extract the minimum needed fields, don’t pretend we can optimize.
     if (!originInput.value.trim() || !destinationInput.value.trim()) {
       setUIState(UI_STATES.ERROR, "I understood parts of it, but I still need origin + destination.");
       return;
  }

     setUIState(UI_STATES.IDLE, "Trip understood. Optimizing now…");
     await runOptimize();
     return;
}    else {
     setUIState(UI_STATES.IDLE, "Trip understood. Ready to optimize.");
     return;
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

/* 🔽🔽🔽 PASTE BLOCK C RIGHT HERE 🔽🔽🔽 */

function startListeningDriveMode() {
  if (!driveModeActive) return;
  if (!recognition) {
    setUIState(UI_STATES.ERROR, "Drive Mode requires a browser that supports voice input.");
    return;
  }

  // Don’t listen while speaking (echo / garble protection)
  if (uiState === UI_STATES.SPEAKING) return;

  // Reset capture
  speechFinalTranscript = "";
  if (speechSilenceTimeout) {
    clearTimeout(speechSilenceTimeout);
    speechSilenceTimeout = null;
  }

  if (agentInput) {
    agentInput.value = "";
    agentInput.placeholder = "Drive Mode: speak naturally…";
  }

  try {
    recognition.start();
  } catch (e) {
    // Browser can throw if start() called too quickly
    console.warn("Drive Mode recognition.start() blocked:", e);
  }
}

/* 🔼🔼🔼 END BLOCK C 🔼🔼🔼 */

if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-US";

  // ✅ KEY CHANGES
  recognition.continuous = true;       // keep listening across small pauses
  recognition.interimResults = true;   // stream partial text as you speak

  recognition.onstart = () => {
    setUIState(UI_STATES.LISTENING);
    if (agentBox) agentBox.classList.add("agent-box-active");
    if (voiceBtn) voiceBtn.textContent = "Listening…";
    if (agentInput) {
      agentInput.placeholder = "Listening… speak naturally.";
    }
  };

  recognition.onerror = (event) => {
    setUIState(UI_STATES.IDLE, "Voice had a hiccup. Tap to speak again.");
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
      setUIState(UI_STATES.IDLE);
     return;
    }
      setUIState(UI_STATES.UNDERSTANDING);

    // 🔴 THIS IS THE CRITICAL LINE:
    // Use your existing pipeline exactly as before
    // Drive Mode: intercept luxury commands (stop/replay/etc)
    if (driveModeActive && handleDriveModeCommand(finalText)) {
      return;
    }

// Normal pipeline
runInterpret(true);
  };
}

voiceBtn?.addEventListener("click", () => {
  if (!recognition) {
    setUIState(UI_STATES.ERROR, "Voice input isn’t supported in this browser.");
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
    setUIState(UI_STATES.ERROR, "Origin and destination are required.");
    return;
  }
  setUIState(UI_STATES.OPTIMIZING);

  const datesWindow = datesInput.value.trim();
  const travellers = travellersInput.value.trim();
  const preferences = preferencesInput.value.trim();
  const notes = notesInput.value.trim();
  const outputStyle =
    (outputStyleSelect.value || "Executive summary (C-suite / family office)").trim();

  setUIState(UI_STATES.OPTIMIZING, "Optimizing your routing…");

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
    notes,
  };

  // Cold-start immunity: fast attempt, then a masked retry
  let result = await postJSONWithRetry("/optimize", payload, {
    maxRetries: 0,
    timeoutMs: 8000,
  });

  if (result.error) {
    setUIState(UI_STATES.OPTIMIZING, "Waking up your concierge… one moment.");
    result = await postJSONWithRetry("/optimize", payload, {
      maxRetries: 0,
      timeoutMs: 15000,
    });
  }

  if (result.error) {
    setUIState(UI_STATES.ERROR, "Couldn’t optimize. Please try again.");
    return;
  }

  // remember latest result for replay / late recap
  lastOptimizeResult = result;

  renderResults(result);
  setUIState(UI_STATES.IDLE, "Routing updated just now.");

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
async function speakSummary(data) {
  setUIState(UI_STATES.SPEAKING);
  const myToken = ++speakToken;
  try {
    // UX: let the user know something is happening
    setUIState(UI_STATES.SPEAKING, "Preparing your spoken recap…");

  let res = await fetch(`${API_BASE}/tts-recap`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

if (!res.ok) {
  // masked single retry for cold-start
  setUIState(UI_STATES.SPEAKING, "Warming the voice concierge…");
  await new Promise((r) => setTimeout(r, 900));

  res = await fetch(`${API_BASE}/tts-recap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

if (!res.ok) {
  console.error("TTS recap error:", res.status, await res.text());
  setUIState(UI_STATES.ERROR, "Could not play spoken recap.");
  return;
}

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

   // If another speak started after this one, or recap got turned off, don't play.
   if (myToken !== speakToken || !playRecapCheckbox?.checked) {
      URL.revokeObjectURL(url);
      return;
   }

    const audio = new Audio(url);

    audio.onplay = () => {
    setUIState(UI_STATES.SPEAKING, "Playing spoken recap now.");
    };

    audio.onended = () => {
     activeAudio = null;
     URL.revokeObjectURL(url); // 🧹 cleanup audio blob
     setUIState(UI_STATES.IDLE, "Routing updated just now.");
       if (driveModeActive) startListeningDriveMode();
    };

    audio.onerror = () => {
     activeAudio = null;
     URL.revokeObjectURL(url);
     setUIState(UI_STATES.ERROR, "Could not play spoken recap.");
};


   // Stop any previous recap audio (prevents overlap)
    if (activeAudio) {
     activeAudio.pause();
     activeAudio.currentTime = 0;
     activeAudio = null;
    }
    activeAudio = audio;

    audio.play();

  } catch (err) {
    console.error("Network error during TTS recap:", err);
    setUIState(UI_STATES.ERROR, "Could not play spoken recap.");
  }
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
      setUIState(UI_STATES.ERROR, "No saved family profile yet.");
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
    setUIState(UI_STATES.IDLE, "Saved family profile loaded.");
  } catch (err) {
    console.error("Error loading profile", err);
  }
});

// ---------------------------------------------------------------
// This makes it play immediately if you tick the box after a result is already on screen.
// ---------------------------------------------------------------

   playRecapCheckbox?.addEventListener("change", () => {
  // If user turns it OFF: stop audio + cancel any in-flight fetch
  if (!playRecapCheckbox.checked) {
     speakToken++; // cancels pending speakSummary responses
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    setUIState(UI_STATES.IDLE, "Recap playback off.");
    return;
  }

  // If user turns it ON: play latest recap (if available)
  if (lastOptimizeResult) {
    speakSummary(lastOptimizeResult);
  }
});


// ---------------------------------------------------------------
// DRIVE MODE (visual only for now)
// ---------------------------------------------------------------
driveToggle?.addEventListener("click", () => {
  const isActive = driveToggle.classList.toggle("drive-switch-active");
  document.body.classList.toggle("drive-mode", isActive);

  // NEW: turn Drive Mode logic on/off (hands-free)
  setDriveMode(isActive);
});
