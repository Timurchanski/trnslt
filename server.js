const express = require("express");
const multer = require("multer");
const OpenAI = require("openai");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3000;

const requiredEnvVars = ["DEEPGRAM_API_KEY", "OPENAI_API_KEY", "ADMIN_PASSWORD"];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingEnvVars.length > 0) {
  console.warn(`Missing environment variables: ${missingEnvVars.join(", ")}`);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const ROOM_ID = "hillsong-edinburgh";
const ROOM_NAME = "Hillsong Edinburgh";
const ALLOWED_LANGUAGES = {
  Russian: "Russian",
  Ukrainian: "Ukrainian",
  English: "English",
  Polish: "Polish"
};

const session = {
  roomId: ROOM_ID,
  roomName: ROOM_NAME,
  active: false,
  adminNickname: "",
  startedAt: null,
  sequence: 0,
  history: []
};

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

app.get("/api/config", (_req, res) => {
  res.json({
    room: {
      id: ROOM_ID,
      name: ROOM_NAME
    },
    languages: Object.keys(ALLOWED_LANGUAGES)
  });
});

app.post("/api/admin/login", (req, res) => {
  const { password, nickname } = req.body || {};

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid password." });
  }

  const cleanNickname = String(nickname || "Admin").trim().slice(0, 40) || "Admin";
  session.adminNickname = cleanNickname;

  return res.json({
    success: true,
    nickname: cleanNickname,
    room: {
      id: ROOM_ID,
      name: ROOM_NAME
    }
  });
});

app.post("/api/admin/start", (req, res) => {
  const { password, nickname, roomId } = req.body || {};

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid password." });
  }

  if (roomId !== ROOM_ID) {
    return res.status(400).json({ error: "Unknown room." });
  }

  session.active = true;
  session.adminNickname = String(nickname || session.adminNickname || "Admin").trim().slice(0, 40) || "Admin";
  session.startedAt = Date.now();

  return res.json({
    success: true,
    active: true,
    nickname: session.adminNickname
  });
});

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const { roomId, adminNickname } = req.body || {};
    const audioFile = req.file;

    if (roomId !== ROOM_ID) {
      return res.status(400).json({ error: "Unknown room." });
    }

    if (!session.active) {
      return res.status(409).json({ error: "Translation session is not active." });
    }

    if (!audioFile || !audioFile.buffer?.length) {
      return res.status(400).json({ error: "Audio chunk is required." });
    }

    const transcript = await transcribeWithDeepgram(audioFile.buffer, audioFile.mimetype);
    if (!transcript) {
      return res.json({ success: true, ignored: true });
    }

    const translations = await translateTranscript(transcript);
    const entry = {
      id: ++session.sequence,
      transcript,
      translations,
      speaker: String(adminNickname || session.adminNickname || "Admin").trim(),
      createdAt: new Date().toISOString()
    };

    session.history.push(entry);

    res.json({
      success: true,
      entry
    });
  } catch (error) {
    console.error("Transcription pipeline failed:", error);
    res.status(500).json({
      error: error.message || "Failed to process audio chunk."
    });
  }
});

app.get("/api/session", (req, res) => {
  const roomId = req.query.roomId;
  const language = req.query.language;
  const since = Number(req.query.since || 0);

  if (roomId !== ROOM_ID) {
    return res.status(400).json({ error: "Unknown room." });
  }

  if (!language || !ALLOWED_LANGUAGES[language]) {
    return res.status(400).json({ error: "Unsupported language." });
  }

  const items = session.history
    .filter((entry) => entry.id > since)
    .map((entry) => ({
      id: entry.id,
      text: entry.translations[language] || entry.transcript,
      transcript: entry.transcript,
      createdAt: entry.createdAt
    }));

  return res.json({
    active: session.active,
    adminNickname: session.adminNickname,
    room: {
      id: ROOM_ID,
      name: ROOM_NAME
    },
    items,
    lastSequence: session.sequence
  });
});

app.delete("/api/session", (req, res) => {
  const { password } = req.body || {};

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid password." });
  }

  session.active = false;
  session.adminNickname = "";
  session.startedAt = null;
  session.sequence = 0;
  session.history = [];

  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

async function transcribeWithDeepgram(audioBuffer, mimeType) {
  const response = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&encoding=opus&container=webm",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        "Content-Type": "audio/webm"
      },
      body: audioBuffer
    }
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Deepgram error: ${response.status} ${details}`);
  }

  const data = await response.json();
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";
}

async function translateTranscript(transcript) {
  const languageList = Object.keys(ALLOWED_LANGUAGES).join(", ");
  const completion = await openai.responses.create({
    model: "gpt-4o-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You translate sermon transcripts. Return strict JSON only with keys Russian, Ukrainian, English, Polish. Preserve meaning, tone, and line breaks when possible."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Translate this sermon transcript into ${languageList}.\n\nTranscript:\n${transcript}`
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "sermon_translations",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            Russian: { type: "string" },
            Ukrainian: { type: "string" },
            English: { type: "string" },
            Polish: { type: "string" }
          },
          required: ["Russian", "Ukrainian", "English", "Polish"]
        }
      }
    }
  });

  const content = completion.output_text;
  return JSON.parse(content);
}
