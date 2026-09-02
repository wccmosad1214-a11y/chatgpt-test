const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const errorBanner = document.getElementById("error-banner");
const imageInput = document.getElementById("image-input");
const imagePreviewWrap = document.getElementById("image-preview-wrap");
const imagePreview = document.getElementById("image-preview");
const removeImageBtn = document.getElementById("remove-image-btn");

// 会話履歴(このブラウザタブの中だけで保持する。サーバー側には保存しない)
const history = [];
let selectedImageFile = null;

function showError(text) {
  errorBanner.textContent = text;
  errorBanner.hidden = false;
}

function clearError() {
  errorBanner.hidden = true;
  errorBanner.textContent = "";
}

function scrollToBottom() {
  chatLog.scrollTop = chatLog.scrollHeight;
}

function appendMessage({ role, text, imageDataUrl }) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  const textNode = document.createElement("div");
  textNode.textContent = text;
  wrapper.appendChild(textNode);

  if (imageDataUrl) {
    const img = document.createElement("img");
    img.src = imageDataUrl;
    img.className = "message-image";
    img.alt = "添付した画像";
    wrapper.appendChild(img);
  }

  if (role === "model") {
    const actions = document.createElement("div");
    actions.className = "message-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "copy-btn";
    copyBtn.textContent = "コピー";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "コピーしました";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.textContent = "コピー";
          copyBtn.classList.remove("copied");
        }, 1500);
      } catch {
        copyBtn.textContent = "コピーできませんでした";
        setTimeout(() => {
          copyBtn.textContent = "コピー";
        }, 1500);
      }
    });

    actions.appendChild(copyBtn);
    wrapper.appendChild(actions);
  }

  chatLog.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function appendPendingMessage() {
  const wrapper = document.createElement("div");
  wrapper.className = "message pending";
  wrapper.textContent = "Geminiが回答を作成しています...";
  chatLog.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function resizeTextarea() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
}

function clearSelectedImage() {
  selectedImageFile = null;
  imageInput.value = "";
  imagePreview.src = "";
  imagePreviewWrap.hidden = true;
}

imageInput.addEventListener("change", () => {
  clearError();
  const file = imageInput.files?.[0];
  if (!file) return;

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    showError("対応していない画像形式です。JPEG・PNG・WebPのいずれかを選択してください。");
    imageInput.value = "";
    return;
  }

  if (file.size > MAX_IMAGE_BYTES) {
    showError("画像のサイズが大きすぎます。5MB以内の画像を選択してください。");
    imageInput.value = "";
    return;
  }

  selectedImageFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    imagePreview.src = reader.result;
    imagePreviewWrap.hidden = false;
  };
  reader.readAsDataURL(file);
});

removeImageBtn.addEventListener("click", () => {
  clearSelectedImage();
});

messageInput.addEventListener("input", resizeTextarea);

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const message = messageInput.value.trim();
  if (!message) {
    showError("質問内容を入力してください。");
    return;
  }

  const imageFile = selectedImageFile;
  let imageDataUrlForDisplay = null;
  if (imageFile) {
    imageDataUrlForDisplay = imagePreview.src;
  }

  sendBtn.disabled = true;
  sendBtn.textContent = "送信中...";

  appendMessage({ role: "user", text: message, imageDataUrl: imageDataUrlForDisplay });
  const pendingEl = appendPendingMessage();

  const formData = new FormData();
  formData.append("message", message);
  formData.append("history", JSON.stringify(history));
  if (imageFile) {
    formData.append("image", imageFile);
  }

  messageInput.value = "";
  resizeTextarea();
  clearSelectedImage();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      body: formData,
    });

    const data = await response.json().catch(() => null);

    pendingEl.remove();

    if (!response.ok || !data || data.error) {
      showError(data?.error || "エラーが発生しました。しばらくしてからもう一度お試しください。");
      return;
    }

    history.push({ role: "user", text: message });
    history.push({ role: "model", text: data.reply });

    appendMessage({ role: "model", text: data.reply });
  } catch {
    pendingEl.remove();
    showError("通信エラーが発生しました。ネットワーク状況を確認して、もう一度お試しください。");
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = "送信";
  }
});
