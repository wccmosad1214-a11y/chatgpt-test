import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const CONFIGURED_FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
const DEFAULT_ALTERNATE_MODEL = "gemini-3.6-flash";
const RETRY_DELAYS_MS = [1500, 3000];
const RETRYABLE_STATUSES = new Set([429, 503]);

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_HISTORY_MESSAGES = 20;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      cb(new Error("UNSUPPORTED_IMAGE_TYPE"));
      return;
    }
    cb(null, true);
  },
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getModelCandidates() {
  const fallback =
    CONFIGURED_FALLBACK_MODEL === GEMINI_MODEL
      ? DEFAULT_ALTERNATE_MODEL
      : CONFIGURED_FALLBACK_MODEL;
  return [...new Set([GEMINI_MODEL, fallback])];
}

async function requestGemini({ apiKey, contents }) {
  let lastResponse;
  let lastErrorText = "";

  for (const model of getModelCandidates()) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS_MS[attempt - 1];
        console.warn(
          `Gemini API busy: retrying model=${model} attempt=${attempt + 1} after ${delay}ms`
        );
        await sleep(delay);
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({ contents }),
        }
      );

      if (response.ok) {
        if (model !== GEMINI_MODEL) {
          console.warn(`Gemini API fallback succeeded: model=${model}`);
        }
        return response;
      }

      lastResponse = response;
      lastErrorText = await response.text();
      console.error(
        `Gemini API error: model=${model} status=${response.status} ${lastErrorText}`
      );

      if (!RETRYABLE_STATUSES.has(response.status)) {
        return { response, errorText: lastErrorText, exhausted: false };
      }
    }

    console.warn(`Gemini API fallback: switching away from model=${model}`);
  }

  return { response: lastResponse, errorText: lastErrorText, exhausted: true };
}

function parseHistory(rawHistory) {
  if (!rawHistory) return [];

  let parsed;
  try {
    parsed = JSON.parse(rawHistory);
  } catch {
    throw new Error("INVALID_HISTORY_FORMAT");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("INVALID_HISTORY_FORMAT");
  }

  const validated = parsed.filter(
    (item) =>
      item &&
      (item.role === "user" || item.role === "model") &&
      typeof item.text === "string" &&
      item.text.trim() !== ""
  );

  return validated.slice(-MAX_HISTORY_MESSAGES);
}

app.post("/api/chat", (req, res) => {
  upload.single("image")(req, res, async (uploadError) => {
    if (uploadError) {
      if (uploadError.code === "LIMIT_FILE_SIZE") {
        return res
          .status(400)
          .json({ error: "画像のサイズが大きすぎます。5MB以内の画像を選択してください。" });
      }
      if (uploadError.message === "UNSUPPORTED_IMAGE_TYPE") {
        return res
          .status(400)
          .json({ error: "対応していない画像形式です。JPEG・PNG・WebPのいずれかを選択してください。" });
      }
      return res.status(400).json({ error: "画像のアップロードに失敗しました。もう一度お試しください。" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "サーバー側にGEMINI_API_KEYが設定されていません。管理者に確認してください。" });
    }

    const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
    if (!message) {
      return res.status(400).json({ error: "質問内容を入力してください。" });
    }

    let history;
    try {
      history = parseHistory(req.body.history);
    } catch {
      return res.status(400).json({ error: "会話履歴の形式が正しくありません。ページを再読み込みしてください。" });
    }

    const currentParts = [{ text: message }];
    if (req.file) {
      currentParts.push({
        inlineData: {
          mimeType: req.file.mimetype,
          data: req.file.buffer.toString("base64"),
        },
      });
    }

    const contents = [
      ...history.map((item) => ({ role: item.role, parts: [{ text: item.text }] })),
      { role: "user", parts: currentParts },
    ];

    try {
      const result = await requestGemini({ apiKey, contents });
      const response = result instanceof Response ? result : result.response;

      if (!response?.ok) {
        if (result.exhausted && RETRYABLE_STATUSES.has(response?.status)) {
          return res.status(503).json({
            code: "GEMINI_BUSY",
            error:
              "Geminiが混雑中です。自動再試行と別モデルへの切り替えを行いましたが、応答がありませんでした。少し時間を空けてお試しください。",
          });
        }
        return res.status(502).json({
          error: "Gemini APIへの問い合わせに失敗しました。設定または通信状態をご確認ください。",
        });
      }

      const data = await response.json();
      const answer = data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();

      if (!answer) {
        return res.status(502).json({ error: "Geminiから回答を取得できませんでした。もう一度お試しください。" });
      }

      return res.json({ reply: answer });
    } catch (err) {
      console.error("Gemini API request failed:", err);
      return res
        .status(502)
        .json({ error: "Gemini APIとの通信中にエラーが発生しました。ネットワークをご確認のうえ、もう一度お試しください。" });
    }
  });
});

app.listen(PORT, () => {
  console.log(`Gemini chat app running at http://localhost:${PORT}`);
});
