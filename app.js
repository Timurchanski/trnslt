const state = {
  route: "home",
  adminNickname: "Admin nickname",
  guestNickname: "User nickname",
  roomId: "hillsong-edinburgh",
  roomName: "Hillsong Edinburgh",
  language: "Russian",
  adminLanguage: "English",
  languages: ["Russian", "Ukrainian", "English", "Polish"],
  adminPassword: "",
  sessionSequence: 0,
  adminEntries: [],
  guestEntries: [],
  mediaRecorder: null,
  mediaStream: null,
  pollingTimer: null,
  chunkIntervalMs: 2000,
  pendingChunkPromise: Promise.resolve()
};

const app = document.getElementById("app");
let chunkTimer = null;

boot();

async function boot() {
  await loadConfig();
  render();
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const data = await response.json();
    state.roomId = data.room.id;
    state.roomName = data.room.name;
    state.languages = data.languages;
  } catch (error) {
    console.error("Failed to load config", error);
  }
}

function render() {
  stopPollingIfNeeded();

  switch (state.route) {
    case "admin-password":
      app.innerHTML = adminPasswordTemplate();
      bindAdminPassword();
      break;
    case "guest-nickname":
      app.innerHTML = guestNicknameTemplate();
      bindGuestNickname();
      break;
    case "room-admin":
      app.innerHTML = roomTemplate("admin");
      bindRoomSelection("admin");
      break;
    case "room-guest":
      app.innerHTML = roomTemplate("guest");
      bindRoomSelection("guest");
      break;
    case "guest-language":
      app.innerHTML = guestLanguageTemplate();
      bindGuestLanguage();
      break;
    case "admin-language":
      app.innerHTML = adminLanguageTemplate();
      bindAdminLanguage();
      break;
    case "admin-live":
      app.innerHTML = adminLiveTemplate();
      bindAdminLive();
      startAdminCapture();
      break;
    case "guest-live":
      app.innerHTML = guestLiveTemplate();
      bindGuestLive();
      startGuestPolling();
      break;
    default:
      app.innerHTML = homeTemplate();
      bindHome();
  }
}

function homeTemplate() {
  return `
    <section class="screen center-screen">
      <button class="outline-button full gray" id="enter-admin">Enter as admin</button>
      <button class="outline-button full orange" id="enter-guest">Enter as guest</button>
    </section>
  `;
}

function adminPasswordTemplate() {
  return `
    <section class="screen">
      <div class="header-row">
        <button class="icon-button" id="back-home" aria-label="Go back">&#8592;</button>
        <div class="spacer"></div>
      </div>
      <div class="input-group">
        <div class="label">Admin's password</div>
        <input class="input-field" id="admin-password" type="password" value="${escapeHtml(state.adminPassword)}" />
      </div>
      <button class="outline-button full orange" id="admin-enter">Enter</button>
      <div class="error-text" id="admin-error"></div>
    </section>
  `;
}

function guestNicknameTemplate() {
  return `
    <section class="screen">
      <div class="header-row">
        <button class="icon-button" id="back-home" aria-label="Go back">&#8592;</button>
        <div class="spacer"></div>
      </div>
      <div class="input-group">
        <div class="label">Your nickname</div>
        <input class="input-field" id="guest-nickname" type="text" placeholder="Brian..." value="${escapeHtml(state.guestNickname === "User nickname" ? "" : state.guestNickname)}" />
      </div>
      <button class="outline-button full orange" id="guest-enter">Enter</button>
    </section>
  `;
}

function roomTemplate(role) {
  const nickname = role === "admin" ? state.adminNickname : state.guestNickname;
  const colorClass = role === "admin" ? "gray" : "orange";

  return `
    <section class="screen">
      <div class="header-row">
        <button class="icon-button" id="back-step" aria-label="Go back">&#8592;</button>
        <div class="header-center ${colorClass}">${escapeHtml(nickname)}</div>
      </div>
      <h1 class="title">Choose speech</h1>
      <div class="room-button-wrap">
        <button class="outline-button full orange" id="room-choice">${escapeHtml(state.roomName)}</button>
      </div>
    </section>
  `;
}

function guestLanguageTemplate() {
  return `
    <section class="screen">
      <div class="header-row">
        <button class="icon-button" id="back-room" aria-label="Go back">&#8592;</button>
        <div class="header-center">${escapeHtml(state.guestNickname)}</div>
      </div>
      <h1 class="title">Choose language</h1>
      <div class="language-wrap">
        <select class="language-select" id="language-select">
          ${state.languages
            .map((language) => `<option value="${language}" ${language === state.language ? "selected" : ""}>${language}</option>`)
            .join("")}
        </select>
        <div style="height: 28px"></div>
        <button class="outline-button full orange" id="start-translation">Start translation</button>
      </div>
    </section>
  `;
}

function adminLanguageTemplate() {
  return `
    <section class="screen">
      <div class="header-row">
        <button class="icon-button" id="back-room" aria-label="Go back">&#8592;</button>
        <div class="header-center gray">${escapeHtml(state.adminNickname)}</div>
      </div>
      <h1 class="title">Choose language</h1>
      <div class="language-wrap">
        <select class="language-select" id="language-select">
          ${state.languages
            .map(
              (language) =>
                `<option value="${language}" ${language === state.adminLanguage ? "selected" : ""}>${language}</option>`
            )
            .join("")}
        </select>
        <div style="height: 28px"></div>
        <button class="outline-button full gray" id="start-translation">Start translation</button>
      </div>
    </section>
  `;
}

function adminLiveTemplate() {
  return `
    <section class="screen">
      <div class="header-row">
        <button class="icon-button" id="back-admin-room" aria-label="Go back">&#8592;</button>
        <div class="header-center">${escapeHtml(state.adminNickname)}</div>
        <button class="icon-button" id="end-session" aria-label="End session">&#10005;</button>
      </div>
      <div class="status-row admin">
        <span>Translation is started</span>
        <span class="mic-mark">&#127908;</span>
      </div>
      <div class="text-panel" id="admin-panel">
        ${renderEntries(state.adminEntries, "Waiting for live transcription...")}
      </div>
      <div class="error-text" id="admin-live-error"></div>
      <div class="hint">Browser microphone permission is required.</div>
    </section>
  `;
}

function guestLiveTemplate() {
  return `
    <section class="screen">
      <div class="header-row">
        <button class="icon-button" id="back-language" aria-label="Go back">&#8592;</button>
        <div class="header-center">${escapeHtml(state.guestNickname)}</div>
        <button class="icon-button" id="leave-session" aria-label="Leave session">&#10005;</button>
      </div>
      <div class="status-row">
        <span>Translation is started</span>
        <span class="mic-mark">&#127908;</span>
        <span class="live-badge">Live</span>
      </div>
      <div class="text-panel" id="guest-panel">
        ${renderEntries(state.guestEntries, "Waiting for translation...")}
      </div>
      <div class="error-text" id="guest-live-error"></div>
    </section>
  `;
}

function renderEntries(entries, emptyMessage) {
  if (!entries.length) {
    return `<div class="empty-state">${emptyMessage}</div>`;
  }

  return entries
    .map((entry) => `<div class="text-entry">${escapeHtml(entry.text)}</div>`)
    .join("");
}

function bindHome() {
  document.getElementById("enter-admin").onclick = () => {
    state.route = "admin-password";
    render();
  };
  document.getElementById("enter-guest").onclick = () => {
    state.route = "guest-nickname";
    render();
  };
}

function bindAdminPassword() {
  document.getElementById("back-home").onclick = () => {
    state.route = "home";
    render();
  };

  document.getElementById("admin-enter").onclick = async () => {
    const password = document.getElementById("admin-password").value.trim();
    const errorNode = document.getElementById("admin-error");

    if (!password) {
      errorNode.textContent = "Enter the admin password.";
      return;
    }

    state.adminPassword = password;

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          nickname: "Admin nickname"
        })
      });

      const data = await response.json();
      if (!response.ok) {
        errorNode.textContent = data.error || "Login failed.";
        return;
      }

      state.adminNickname = data.nickname;
      state.route = "room-admin";
      render();
    } catch (error) {
      errorNode.textContent = "Could not connect to server.";
    }
  };
}

function bindGuestNickname() {
  document.getElementById("back-home").onclick = () => {
    state.route = "home";
    render();
  };

  document.getElementById("guest-enter").onclick = () => {
    const nickname = document.getElementById("guest-nickname").value.trim();
    state.guestNickname = nickname || "Brian";
    state.route = "room-guest";
    render();
  };
}

function bindRoomSelection(role) {
  document.getElementById("back-step").onclick = () => {
    state.route = role === "admin" ? "admin-password" : "guest-nickname";
    render();
  };

  document.getElementById("room-choice").onclick = () => {
    state.route = role === "admin" ? "admin-language" : "guest-language";
    render();
  };
}

function bindAdminLanguage() {
  document.getElementById("back-room").onclick = () => {
    state.route = "room-admin";
    render();
  };

  document.getElementById("language-select").onchange = (event) => {
    state.adminLanguage = event.target.value;
  };

  document.getElementById("start-translation").onclick = () => {
    state.route = "admin-live";
    render();
  };
}

function bindGuestLanguage() {
  document.getElementById("back-room").onclick = () => {
    state.route = "room-guest";
    render();
  };

  document.getElementById("language-select").onchange = (event) => {
    state.language = event.target.value;
  };

  document.getElementById("start-translation").onclick = async () => {
    state.guestEntries = [];
    state.sessionSequence = 0;
    state.route = "guest-live";
    render();
  };
}

function bindAdminLive() {
  document.getElementById("back-admin-room").onclick = async () => {
    await stopAdminCapture();
    state.route = "room-admin";
    render();
  };

  document.getElementById("end-session").onclick = async () => {
    const errorNode = document.getElementById("admin-live-error");

    try {
      await fetch("/api/session", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: state.adminPassword })
      });
      await stopAdminCapture();
      state.adminEntries = [];
      state.sessionSequence = 0;
      state.route = "home";
      render();
    } catch (error) {
      errorNode.textContent = "Failed to end session.";
    }
  };
}

function bindGuestLive() {
  document.getElementById("back-language").onclick = () => {
    state.route = "guest-language";
    render();
  };

  document.getElementById("leave-session").onclick = () => {
    state.guestEntries = [];
    state.sessionSequence = 0;
    state.route = "home";
    render();
  };
}

async function startAdminCapture() {
  if (state.mediaRecorder) {
    return;
  }

  try {
    state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const startResponse = await fetch("/api/admin/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: state.adminPassword,
        nickname: state.adminNickname,
        roomId: state.roomId
      })
    });
    const startData = await startResponse.json();

    if (!startResponse.ok) {
      throw new Error(startData.error || "Failed to start translation.");
    }

    startChunking();
  } catch (error) {
    const errorNode = document.getElementById("admin-live-error");
    if (errorNode) {
      errorNode.textContent = error.message || "Microphone access was denied.";
    }
  }
}

async function stopAdminCapture() {
  if (chunkTimer) {
    clearTimeout(chunkTimer);
    chunkTimer = null;
  }

  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    state.mediaRecorder.stop();
  }
  state.mediaRecorder = null;

  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
  }
  state.mediaStream = null;
}

function startChunking() {
  if (!state.mediaStream) {
    return;
  }

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  state.mediaRecorder = new MediaRecorder(state.mediaStream, { mimeType });
  state.mediaRecorder.addEventListener("dataavailable", (event) => {
    if (!event.data || event.data.size === 0) {
      return;
    }

    state.pendingChunkPromise = state.pendingChunkPromise.then(() => uploadAudioChunk(event.data));
  });
  state.mediaRecorder.start();

  chunkTimer = setTimeout(() => {
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
      state.mediaRecorder.stop();
    }
    if (state.mediaStream) {
      startChunking();
    }
  }, 2000);
}

async function uploadAudioChunk(blob) {
  const formData = new FormData();
  formData.append("roomId", state.roomId);
  formData.append("adminNickname", state.adminNickname);
  formData.append("audio", blob, "chunk.webm");

  const errorNode = document.getElementById("admin-live-error");

  try {
    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Upload failed.");
    }

    if (data.ignored || !data.entry) {
      return;
    }

    state.adminEntries.push({
      id: data.entry.id,
      text: data.entry.transcript
    });
    state.sessionSequence = data.entry.id;
    refreshPanel("admin-panel", state.adminEntries, "Waiting for live transcription...", true);
  } catch (error) {
    if (errorNode) {
      errorNode.textContent = error.message || "Audio processing failed.";
    }
  }
}

function startGuestPolling() {
  if (state.pollingTimer) {
    clearInterval(state.pollingTimer);
  }
  pollSession(true);
  state.pollingTimer = window.setInterval(() => {
    pollSession(false);
  }, 2000);
}

function stopPollingIfNeeded() {
  if (state.route !== "guest-live" && state.pollingTimer) {
    clearInterval(state.pollingTimer);
    state.pollingTimer = null;
  }
}

async function pollSession(isInitialLoad) {
  try {
    const response = await fetch(
      `/api/session?roomId=${encodeURIComponent(state.roomId)}&language=${encodeURIComponent(state.language)}&since=${
        isInitialLoad ? 0 : state.sessionSequence
      }`
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load session.");
    }

    if (isInitialLoad) {
      state.guestEntries = data.items;
    } else if (data.lastSequence === 0 && state.sessionSequence > 0) {
      state.guestEntries = [];
    } else if (data.items.length > 0) {
      state.guestEntries.push(...data.items);
    }

    state.sessionSequence = data.lastSequence;
    refreshPanel("guest-panel", state.guestEntries, "Waiting for translation...", true);
  } catch (error) {
    const errorNode = document.getElementById("guest-live-error");
    if (errorNode) {
      errorNode.textContent = error.message || "Polling failed.";
    }
  }
}

function refreshPanel(panelId, entries, emptyMessage, scrollToBottom = false) {
  const panel = document.getElementById(panelId);
  if (!panel) {
    return;
  }

  panel.innerHTML = renderEntries(entries, emptyMessage);
  if (scrollToBottom) {
    panel.scrollTop = panel.scrollHeight;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
