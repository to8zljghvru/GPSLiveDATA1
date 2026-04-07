const socket = io();

const state = {
  viewerSessionId: "",
  creatorSessionId: "",
  watchId: null,
  creatorJoined: false
};

const elements = {
  openViewerBtn: document.getElementById("openViewerBtn"),
  openCreatorBtn: document.getElementById("openCreatorBtn"),
  viewerPanel: document.getElementById("viewerPanel"),
  creatorPanel: document.getElementById("creatorPanel"),
  viewerSessionId: document.getElementById("viewerSessionId"),
  viewerStatus: document.getElementById("viewerStatus"),
  viewerStats: document.getElementById("viewerStats"),
  viewerLat: document.getElementById("viewerLat"),
  viewerLon: document.getElementById("viewerLon"),
  viewerAccuracy: document.getElementById("viewerAccuracy"),
  viewerSource: document.getElementById("viewerSource"),
  viewerTimestamp: document.getElementById("viewerTimestamp"),
  mapLink: document.getElementById("mapLink"),
  mapFrame: document.getElementById("mapFrame"),
  copySessionBtn: document.getElementById("copySessionBtn"),
  creatorSessionInput: document.getElementById("creatorSessionInput"),
  startSharingBtn: document.getElementById("startSharingBtn"),
  stopSharingBtn: document.getElementById("stopSharingBtn"),
  creatorStatus: document.getElementById("creatorStatus"),
  creatorSource: document.getElementById("creatorSource"),
  creatorLat: document.getElementById("creatorLat"),
  creatorLon: document.getElementById("creatorLon"),
  creatorAccuracy: document.getElementById("creatorAccuracy"),
  creatorTimestamp: document.getElementById("creatorTimestamp")
};

function randomSessionId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function formatAccuracy(accuracy) {
  if (!Number.isFinite(accuracy) || accuracy <= 0) {
    return "Unknown";
  }

  return `${Math.round(accuracy)} m`;
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function setPanelVisible(panel, visible) {
  panel.classList.toggle("hidden", !visible);
}

function closeAllPanels() {
  setPanelVisible(elements.viewerPanel, false);
  setPanelVisible(elements.creatorPanel, false);
}

function updateViewerLocation(data) {
  elements.viewerLat.textContent = data.lat.toFixed(6);
  elements.viewerLon.textContent = data.lon.toFixed(6);
  elements.viewerAccuracy.textContent = formatAccuracy(data.accuracy);
  elements.viewerSource.textContent = data.source === "ip" ? "IP estimate" : "Device GPS";
  elements.viewerTimestamp.textContent = `Updated ${formatTimestamp(data.timestamp)}`;
  elements.viewerStatus.textContent = "Live location received";

  const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${data.lat},${data.lon}`)}`;
  elements.mapLink.href = mapUrl;
  elements.mapLink.classList.remove("hidden");

  const delta = 0.015;
  const bbox = [
    data.lon - delta,
    data.lat - delta,
    data.lon + delta,
    data.lat + delta
  ].join("%2C");
  elements.mapFrame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${data.lat}%2C${data.lon}`;
  elements.mapFrame.classList.remove("hidden");
}

function updateCreatorLocation(data) {
  elements.creatorLat.textContent = data.lat.toFixed(6);
  elements.creatorLon.textContent = data.lon.toFixed(6);
  elements.creatorAccuracy.textContent = formatAccuracy(data.accuracy);
  elements.creatorTimestamp.textContent = formatTimestamp(data.timestamp);
  elements.creatorSource.textContent =
    data.source === "ip" ? "Source: IP estimate fallback" : "Source: device GPS";
}

async function copySessionCode() {
  if (!state.viewerSessionId) {
    return;
  }

  try {
    await navigator.clipboard.writeText(state.viewerSessionId);
    elements.copySessionBtn.textContent = "Copied";
    window.setTimeout(() => {
      elements.copySessionBtn.textContent = "Copy code";
    }, 1400);
  } catch (_error) {
    elements.viewerStatus.textContent = "Could not copy the session code automatically.";
  }
}

function normalizeSessionInput() {
  return elements.creatorSessionInput.value.trim().toUpperCase();
}

function sendLocation(data) {
  socket.emit("location:update", data);
  updateCreatorLocation(data);
}

function isSecureEnoughForGps() {
  return window.isSecureContext || window.location.hostname === "localhost";
}

function stopSharing() {
  if (state.watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.watchId);
  }

  state.watchId = null;
  state.creatorJoined = false;
  elements.startSharingBtn.disabled = false;
  elements.stopSharingBtn.disabled = true;
  elements.creatorStatus.textContent = "Sharing stopped";
}

async function fetchIpLocation() {
  const response = await fetch("https://ipapi.co/json/");
  if (!response.ok) {
    throw new Error("Unable to fetch IP-based location.");
  }

  const data = await response.json();
  if (!Number.isFinite(Number(data.latitude)) || !Number.isFinite(Number(data.longitude))) {
    throw new Error("IP service returned incomplete coordinates.");
  }

  return {
    lat: Number(data.latitude),
    lon: Number(data.longitude),
    accuracy: 5000,
    source: "ip",
    timestamp: new Date().toISOString(),
    label: [data.city, data.region, data.country_name].filter(Boolean).join(", ")
  };
}

async function startSharing() {
  const sessionId = normalizeSessionInput();
  if (!sessionId) {
    elements.creatorStatus.textContent = "Enter a viewer session code first.";
    return;
  }

  state.creatorSessionId = sessionId;
  socket.emit("creator:join", sessionId);
  elements.creatorStatus.textContent = "Connecting to session…";
  elements.startSharingBtn.disabled = true;

  const startIpFallback = async () => {
    try {
      elements.creatorStatus.textContent = "Using IP fallback location…";
      const fallbackLocation = await fetchIpLocation();
      sendLocation(fallbackLocation);
      elements.creatorStatus.textContent =
        "Sharing approximate location using IP fallback.";
      elements.stopSharingBtn.disabled = false;
    } catch (_error) {
      elements.creatorStatus.textContent =
        "Unable to access GPS or IP-based fallback location.";
      elements.startSharingBtn.disabled = false;
    }
  };

  if (!isSecureEnoughForGps()) {
    elements.creatorStatus.textContent =
      "GPS permission requires HTTPS or localhost. This phone is using an insecure page, so only IP fallback is available.";
    await startIpFallback();
    return;
  }

  if (!navigator.geolocation) {
    await startIpFallback();
    return;
  }

  const handlePosition = (position) => {
    const payload = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracy: position.coords.accuracy,
      source: "gps",
      timestamp: new Date(position.timestamp).toISOString(),
      label: ""
    };

    sendLocation(payload);
    elements.creatorStatus.textContent = "Sharing precise device GPS.";
    elements.stopSharingBtn.disabled = false;
  };

  const startWatch = () => {
    state.watchId = navigator.geolocation.watchPosition(
      handlePosition,
      async () => {
        await startIpFallback();
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000
      }
    );
  };

  navigator.geolocation.getCurrentPosition(
    (position) => {
      handlePosition(position);
      startWatch();
    },
    async (error) => {
      if (error?.code === error.PERMISSION_DENIED) {
        elements.creatorStatus.textContent =
          "GPS permission was denied, so the app is using IP fallback instead.";
      }
      await startIpFallback();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    }
  );
}

elements.openViewerBtn.addEventListener("click", () => {
  closeAllPanels();
  setPanelVisible(elements.viewerPanel, true);
  state.viewerSessionId = randomSessionId();
  elements.viewerSessionId.textContent = state.viewerSessionId;
  elements.viewerStatus.textContent = "Session ready. Waiting for a broadcaster.";
  elements.viewerStats.textContent = "Waiting for a broadcaster";
  socket.emit("viewer:join", state.viewerSessionId);
});

elements.openCreatorBtn.addEventListener("click", () => {
  closeAllPanels();
  setPanelVisible(elements.creatorPanel, true);
  elements.creatorStatus.textContent = "Enter a viewer session code to begin.";
});

elements.copySessionBtn.addEventListener("click", copySessionCode);
elements.startSharingBtn.addEventListener("click", startSharing);
elements.stopSharingBtn.addEventListener("click", stopSharing);

document.querySelectorAll("[data-close-panel]").forEach((button) => {
  button.addEventListener("click", () => {
    const panel = document.getElementById(button.dataset.closePanel);
    if (panel === elements.creatorPanel) {
      stopSharing();
    }
    setPanelVisible(panel, false);
  });
});

socket.on("viewer:joined", (payload) => {
  elements.viewerSessionId.textContent = payload.sessionId;
  if (payload.latestLocation) {
    updateViewerLocation(payload.latestLocation);
  }
});

socket.on("creator:joined", (payload) => {
  state.creatorJoined = true;
  elements.creatorStatus.textContent = `Connected to session ${payload.sessionId}.`;
  elements.stopSharingBtn.disabled = false;
  if (payload.latestLocation) {
    updateCreatorLocation(payload.latestLocation);
  }
});

socket.on("location:update", (payload) => {
  updateViewerLocation(payload);
});

socket.on("session:stats", (payload) => {
  const broadcasterText = payload.hasBroadcaster ? "Broadcaster online" : "Waiting for broadcaster";
  elements.viewerStats.textContent = `${broadcasterText} • Viewers: ${payload.viewerCount}`;
});

socket.on("session:error", (message) => {
  elements.viewerStatus.textContent = message;
  elements.creatorStatus.textContent = message;
  elements.startSharingBtn.disabled = false;
});
