import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// gemini-test.mjs と同じデフォルトモデルを使用する(既存の接続テストと挙動を揃えるため)
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
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

  // 直近 MAX_HISTORY_MESSAGES 件のみをGeminiへ送る(トークン数・料金の増加を防ぐため)
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
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({ contents }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Gemini API error: ${response.status} ${errorText}`);
        return res.status(502).json({
          error: "Gemini APIへの問い合わせに失敗しました。しばらくしてからもう一度お試しください。",
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
