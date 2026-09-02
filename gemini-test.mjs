const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("GEMINI_API_KEY が設定されていません。");
  process.exit(1);
}

const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const prompt = process.argv.slice(2).join(" ") || "こんにちは。日本語で短く自己紹介してください。";

const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  }
);

if (!response.ok) {
  console.error(`Gemini API error: ${response.status}`);
  console.error(await response.text());
  process.exit(1);
}

const data = await response.json();
const answer = data?.candidates?.[0]?.content?.parts
  ?.map((part) => part.text || "")
  .join("")
  .trim();

console.log("質問:", prompt);
console.log("Gemini:", answer || "回答を取得できませんでした。");
