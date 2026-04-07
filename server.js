const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const sessions = new Map();

function ensureSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      latestLocation: null,
      viewerCount: 0,
      creatorSocketId: null
    });
  }

  return sessions.get(sessionId);
}

function cleanupSession(sessionId) {
  const session = sessions.get(sessionId);

  if (!session) {
    return;
  }

  if (!session.creatorSocketId && session.viewerCount <= 0) {
    sessions.delete(sessionId);
  }
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, sessions: sessions.size });
});

io.on("connection", (socket) => {
  socket.on("viewer:join", (sessionId) => {
    const normalized = String(sessionId || "").trim().toUpperCase();
    if (!normalized) {
      socket.emit("session:error", "Missing session code.");
      return;
    }

    const session = ensureSession(normalized);
    socket.join(`session:${normalized}`);
    socket.data.viewerSessionId = normalized;
    session.viewerCount += 1;

    socket.emit("viewer:joined", {
      sessionId: normalized,
      latestLocation: session.latestLocation
    });
    io.to(`session:${normalized}`).emit("session:stats", {
      viewerCount: session.viewerCount,
      hasBroadcaster: Boolean(session.creatorSocketId)
    });
  });

  socket.on("creator:join", (sessionId) => {
    const normalized = String(sessionId || "").trim().toUpperCase();
    if (!normalized) {
      socket.emit("session:error", "Missing session code.");
      return;
    }

    const session = ensureSession(normalized);
    socket.join(`session:${normalized}`);
    socket.data.creatorSessionId = normalized;
    session.creatorSocketId = socket.id;

    socket.emit("creator:joined", {
      sessionId: normalized,
      latestLocation: session.latestLocation
    });
    io.to(`session:${normalized}`).emit("session:stats", {
      viewerCount: session.viewerCount,
      hasBroadcaster: true
    });
  });

  socket.on("location:update", (payload) => {
    const sessionId = socket.data.creatorSessionId;
    if (!sessionId) {
      socket.emit("session:error", "Join a creator session before sending updates.");
      return;
    }

    const session = ensureSession(sessionId);
    const normalizedPayload = {
      lat: Number(payload?.lat),
      lon: Number(payload?.lon),
      accuracy: Number(payload?.accuracy || 0),
      source: payload?.source === "ip" ? "ip" : "gps",
      timestamp: payload?.timestamp || new Date().toISOString(),
      label: payload?.label || ""
    };

    if (!Number.isFinite(normalizedPayload.lat) || !Number.isFinite(normalizedPayload.lon)) {
      socket.emit("session:error", "Invalid coordinates.");
      return;
    }

    session.latestLocation = normalizedPayload;
    io.to(`session:${sessionId}`).emit("location:update", normalizedPayload);
  });

  socket.on("disconnect", () => {
    const viewerSessionId = socket.data.viewerSessionId;
    if (viewerSessionId) {
      const session = sessions.get(viewerSessionId);
      if (session) {
        session.viewerCount = Math.max(0, session.viewerCount - 1);
        io.to(`session:${viewerSessionId}`).emit("session:stats", {
          viewerCount: session.viewerCount,
          hasBroadcaster: Boolean(session.creatorSocketId)
        });
      }
      cleanupSession(viewerSessionId);
    }

    const creatorSessionId = socket.data.creatorSessionId;
    if (creatorSessionId) {
      const session = sessions.get(creatorSessionId);
      if (session && session.creatorSocketId === socket.id) {
        session.creatorSocketId = null;
        io.to(`session:${creatorSessionId}`).emit("session:stats", {
          viewerCount: session.viewerCount,
          hasBroadcaster: false
        });
      }
      cleanupSession(creatorSessionId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Live GPS app running on http://localhost:${PORT}`);
});
