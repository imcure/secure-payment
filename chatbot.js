/* ============================================================
   IMCURE CHATBOT — chatbot.js
   Drop this file in your website root alongside app.js
   ============================================================ */

(function () {
  "use strict";

  /* ──────────────────────────────────────────
     1. CONFIGURATION — Edit freely
  ────────────────────────────────────────── */
  const CB_CONFIG = {
    // ▼ PASTE YOUR CLOUDFLARE WORKER URL HERE (no trailing slash) ▼
    proxyUrl: "PASTE_YOUR_WORKER_URL_HERE",

    // Model is set server-side in gemini-worker.js — no need to change this
    model: "gemini-2.5-flash",

    // Brand details shown in the header
    agentName: "IMCure Assistant",
    agentSub:  "Typically replies instantly",

    // Sound notification
    soundEnabled: true,

    // How many messages to remember per session
    historyLimit: 20,

    // Local storage key
    storageKey: "imcure_chat_v1",
  };

  /* ──────────────────────────────────────────
     2. SYSTEM PROMPT — Full personality here
        Edit this block to change AI behaviour
  ────────────────────────────────────────── */
  const SYSTEM_PROMPT = `
You are "IMCure Assistant", the official AI helper for IMCure — a premium healthcare and wellness company based in India.

PERSONALITY:
- Warm, professional, and trustworthy (like a senior relationship manager)
- Speak naturally; never robotic
- Use short paragraphs — never massive walls of text
- Use emojis sparingly (1–2 per reply maximum)
- Respond in the same language the user writes: English or Hindi

COMPANY INFO:
- Brand: IMCure | Tagline: "Passion for better life"
- Services: Healthcare onboarding, subscription-based wellness plans, eKYC
- Payment modes: UPI, NEFT/RTGS via Kotak Mahindra Bank
- Bank: Kotak Mahindra Bank | A/C: 0051571139 | IFSC: KKBK0002129
- Company legal name: CYGNUS SERVICES PVT LTD (for bank transfers)
- After payment, customers share screenshot with their IMCure representative
- Website is SSL-secured and PCI-compliant

PAYMENT HELP:
- The payment amount is preset in the URL link provided by your rep
- You can pay via UPI (scan QR on the site) or NEFT bank transfer
- If UPI fails, advise NEFT/RTGS as a reliable fallback
- After paying, share the payment screenshot via WhatsApp to your rep

KYC / ONBOARDING HELP:
- KYC is done via the onboarding portal at /secure-payment
- Upload Aadhaar + PAN (front & back) clearly
- Selfie should be bright and clear
- KYC approval usually takes 24–48 hours

COMMON FAQs:
- "Is this safe?" → Yes, 256-bit SSL + PCI-compliant + verified by IMCure
- "What if payment fails?" → Retry or use NEFT; share proof with rep
- "How do I change my plan?" → Contact your IMCure representative directly
- "Refund policy?" → Contact support; each case is reviewed individually

TONE RULES:
- Never make up prices or amounts — say "your rep shared a specific link with the amount"
- Never share data to third parties
- If unsure about something specific, say "Please contact your IMCure representative for this"
- Keep replies concise — under 120 words unless the question needs detail
- Never say you are ChatGPT, GPT, or any other AI brand
`;

  /* ──────────────────────────────────────────
     3. FAQ CHIPS — Quick tap suggestions
  ────────────────────────────────────────── */
  const FAQ_CHIPS = [
    "How do I pay? 💳",
    "Is this secure? 🔒",
    "KYC kaise kare?",
    "Payment failed 😟",
    "NEFT details",
    "Contact support",
  ];

  /* ──────────────────────────────────────────
     4. BUILD THE CHATBOT HTML
  ────────────────────────────────────────── */
  function buildUI() {
    // Trigger button
    const trigger = document.createElement("button");
    trigger.id = "cb-trigger";
    trigger.setAttribute("aria-label", "Open IMCure chat");
    trigger.innerHTML = `
      <svg class="cb-icon-chat" width="26" height="26" viewBox="0 0 26 26" fill="none">
        <path d="M13 2C6.925 2 2 6.478 2 12c0 2.19.72 4.22 1.944 5.875L2.5 22l4.5-1.25A11.24 11.24 0 0 0 13 22c6.075 0 11-4.478 11-10S19.075 2 13 2Z" fill="#1a2340"/>
        <path d="M8 11h10M8 15h6" stroke="#F5A623" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <svg class="cb-icon-close" width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M4 4l14 14M18 4L4 18" stroke="#1a2340" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
      <span id="cb-badge"></span>
    `;
    document.body.appendChild(trigger);

    // Chat window
    const win = document.createElement("div");
    win.id = "cb-window";
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-label", "IMCure chat window");
    win.innerHTML = `
      <!-- Header -->
      <div id="cb-header">
        <div class="cb-avatar" style="position:relative;">
          IM
          <span class="cb-status-dot"></span>
        </div>
        <div class="cb-header-info">
          <div class="cb-header-name">${CB_CONFIG.agentName}</div>
          <div class="cb-header-sub">${CB_CONFIG.agentSub}</div>
        </div>
        <div class="cb-header-actions">
          <button class="cb-icon-btn" id="cb-sound-btn" title="Toggle sound" aria-label="Toggle sound">
            <svg id="cb-sound-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 6H2v4h2l4 3V3L4 6Z" fill="currentColor"/>
              <path d="M11 5.5C11.8 6.3 12 7.1 12 8c0 .9-.2 1.7-1 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="cb-icon-btn" id="cb-minimize-btn" title="Minimize" aria-label="Minimize chat">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- FAQ Chips -->
      <div id="cb-faq-strip">
        ${FAQ_CHIPS.map(q => `<button class="cb-faq-chip">${q}</button>`).join("")}
      </div>

      <!-- Messages -->
      <div id="cb-messages"></div>

      <!-- Input -->
      <div id="cb-input-area">
        <div class="cb-input-row">
          <textarea id="cb-input" placeholder="Type your question…" rows="1" aria-label="Message input"></textarea>
          <button id="cb-send" aria-label="Send message">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M14 8L2 2l3 6-3 6 12-6Z" fill="#1a2340"/>
            </svg>
          </button>
        </div>
        <p class="cb-input-hint">Press Enter to send · Shift+Enter for new line</p>
      </div>
    `;
    document.body.appendChild(win);
  }

  /* ──────────────────────────────────────────
     5. STATE
  ────────────────────────────────────────── */
  let isOpen        = false;
  let isThinking    = false;
  let soundOn       = CB_CONFIG.soundEnabled;
  let unreadCount   = 0;
  let conversationHistory = []; // [{role, parts:[{text}]}]

  /* ──────────────────────────────────────────
     6. DOM REFS (populated after buildUI)
  ────────────────────────────────────────── */
  let elTrigger, elWindow, elMessages, elInput, elSend, elBadge, elSoundIcon;

  /* ──────────────────────────────────────────
     7. HELPERS
  ────────────────────────────────────────── */
  function ts() {
    return new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }

  function scrollBottom() {
    elMessages.scrollTo({ top: elMessages.scrollHeight, behavior: "smooth" });
  }

  function playSound() {
    if (!soundOn) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch (_) {}
  }

  function setBadge(n) {
    unreadCount = n;
    elBadge.textContent = n > 9 ? "9+" : n;
    elBadge.classList.toggle("show", n > 0);
  }

  /* ──────────────────────────────────────────
     8. RENDER MESSAGES
  ────────────────────────────────────────── */
  function appendMessage(role, text, skipSave) {
    const isUser = role === "user";
    const row = document.createElement("div");
    row.className = `cb-msg-row ${isUser ? "user" : "bot"}`;

    // Format markdown-ish bold, line breaks
    const formatted = text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br/>");

    row.innerHTML = `
      <div class="cb-msg-avatar">${isUser ? "U" : "IM"}</div>
      <div class="cb-msg-body">
        <div class="cb-msg-bubble">${formatted}</div>
        <div class="cb-msg-time">${ts()}</div>
      </div>
    `;
    elMessages.appendChild(row);
    scrollBottom();

    if (!skipSave) saveToStorage();
  }

  function showWelcome() {
    const div = document.createElement("div");
    div.className = "cb-welcome";
    div.innerHTML = `
      <div class="cb-welcome-title">👋 Namaste! I'm your IMCure Assistant</div>
      <div class="cb-welcome-sub">Ask me about payments, KYC, your subscription plan, or anything IMCure. I'm here to help!</div>
    `;
    elMessages.appendChild(div);
  }

  function showTyping() {
    removeTyping();
    const row = document.createElement("div");
    row.className = "cb-msg-row bot";
    row.id = "cb-typing-row";
    row.innerHTML = `
      <div class="cb-msg-avatar">IM</div>
      <div class="cb-msg-body">
        <div class="cb-msg-bubble cb-typing-bubble">
          <span class="cb-dot"></span>
          <span class="cb-dot"></span>
          <span class="cb-dot"></span>
        </div>
      </div>
    `;
    elMessages.appendChild(row);
    scrollBottom();
  }

  function removeTyping() {
    const old = document.getElementById("cb-typing-row");
    if (old) old.remove();
  }

  /* ──────────────────────────────────────────
     9. GEMINI API CALL
  ────────────────────────────────────────── */
  async function askGemini(userText) {
    const url = CB_CONFIG.proxyUrl;

    const payload = {
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [
        ...conversationHistory,
        { role: "user", parts: [{ text: userText }] }
      ],
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 512,
        topP: 0.9,
      }
    };

    // Retry up to 3 times with exponential backoff (handles 429 rate limits)
    const delays = [0, 3000, 7000];
    let lastError;

    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) {
        await new Promise(r => setTimeout(r, delays[i]));
      }

      let resp;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (networkErr) {
        // fetch itself failed (no internet, CORS preflight blocked, etc.)
        lastError = new Error("NETWORK_ERROR");
        console.error("[IMCure Chatbot] Network error on attempt", i + 1, networkErr);
        continue;
      }

      if (resp.status === 429) {
        lastError = new Error("RATE_LIMIT");
        continue;
      }

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        const apiMsg = errBody?.error?.message || "";
        console.error("[IMCure Chatbot] API error", resp.status, apiMsg);

        if (resp.status === 403 || apiMsg.toLowerCase().includes("api key") || apiMsg.includes("API_KEY")) {
          throw new Error("API_KEY_INVALID");
        }
        if (resp.status === 404 || apiMsg.toLowerCase().includes("not found")) {
          throw new Error("MODEL_NOT_FOUND");
        }
        throw new Error(apiMsg || `API error ${resp.status}`);
      }

      const data = await resp.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!reply) throw new Error("Empty response from Gemini");
      return reply.trim();
    }

    throw lastError || new Error("Request failed after retries");
  }

  /* ──────────────────────────────────────────
     10. SEND MESSAGE FLOW
  ────────────────────────────────────────── */
  async function sendMessage(text) {
    text = text.trim();
    if (!text || isThinking) return;

    isThinking = true;
    elSend.disabled = true;
    elInput.value = "";
    elInput.style.height = "auto";

    // Add user message to UI & history
    appendMessage("user", text);
    conversationHistory.push({ role: "user", parts: [{ text }] });
    if (conversationHistory.length > CB_CONFIG.historyLimit * 2) {
      conversationHistory = conversationHistory.slice(-CB_CONFIG.historyLimit * 2);
    }

    showTyping();

    try {
      const reply = await askGemini(text);
      removeTyping();
      appendMessage("bot", reply);
      conversationHistory.push({ role: "model", parts: [{ text: reply }] });
      playSound();

      // If window is closed, show badge
      if (!isOpen) setBadge(unreadCount + 1);

    } catch (err) {
      removeTyping();
      console.error("[IMCure Chatbot] sendMessage failed:", err.message);
      const errMsg = err.message === "API_KEY_INVALID"
        ? "There's a configuration issue on our end. Please contact your IMCure representative."
        : err.message === "MODEL_NOT_FOUND"
        ? "Service configuration error. Please contact support."
        : err.message === "RATE_LIMIT"
        ? "I'm getting a lot of requests right now. Please wait a moment and try again 🙏"
        : err.message === "NETWORK_ERROR"
        ? "Couldn't reach the server. Please check your internet connection and try again."
        : "Sorry, I couldn't connect right now. Please try again in a moment.";
      appendMessage("bot", `⚠️ ${errMsg}`);
    }

    isThinking = false;
    elSend.disabled = false;
    elInput.focus();
  }

  /* ──────────────────────────────────────────
     11. OPEN / CLOSE
  ────────────────────────────────────────── */
  function openChat() {
    isOpen = true;
    elWindow.classList.add("is-open");
    elTrigger.classList.add("is-open");
    elTrigger.setAttribute("aria-label", "Close chat");
    setBadge(0);
    setTimeout(() => elInput.focus(), 300);
  }

  function closeChat() {
    isOpen = false;
    elWindow.classList.remove("is-open");
    elTrigger.classList.remove("is-open");
    elTrigger.setAttribute("aria-label", "Open IMCure chat");
  }

  function toggleChat() {
    isOpen ? closeChat() : openChat();
  }

  /* ──────────────────────────────────────────
     12. LOCAL STORAGE
  ────────────────────────────────────────── */
  function saveToStorage() {
    try {
      const msgs = Array.from(elMessages.children)
        .filter(el => el.classList.contains("cb-msg-row"))
        .map(el => ({
          role: el.classList.contains("user") ? "user" : "bot",
          html: el.querySelector(".cb-msg-bubble").innerHTML,
          time: el.querySelector(".cb-msg-time")?.textContent || ""
        }));
      localStorage.setItem(CB_CONFIG.storageKey, JSON.stringify({
        msgs,
        history: conversationHistory,
        ts: Date.now()
      }));
    } catch (_) {}
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(CB_CONFIG.storageKey);
      if (!raw) return false;
      const data = JSON.parse(raw);
      // Expire after 12 hours
      if (Date.now() - data.ts > 12 * 60 * 60 * 1000) {
        localStorage.removeItem(CB_CONFIG.storageKey);
        return false;
      }
      conversationHistory = data.history || [];
      data.msgs.forEach(m => {
        const row = document.createElement("div");
        row.className = `cb-msg-row ${m.role === "user" ? "user" : "bot"}`;
        row.innerHTML = `
          <div class="cb-msg-avatar">${m.role === "user" ? "U" : "IM"}</div>
          <div class="cb-msg-body">
            <div class="cb-msg-bubble">${m.html}</div>
            <div class="cb-msg-time">${m.time}</div>
          </div>
        `;
        elMessages.appendChild(row);
      });
      scrollBottom();
      return data.msgs.length > 0;
    } catch (_) {
      return false;
    }
  }

  /* ──────────────────────────────────────────
     13. EVENTS
  ────────────────────────────────────────── */
  function bindEvents() {
    // Trigger toggle
    elTrigger.addEventListener("click", toggleChat);

    // Minimize button
    document.getElementById("cb-minimize-btn").addEventListener("click", closeChat);

    // Sound toggle
    document.getElementById("cb-sound-btn").addEventListener("click", () => {
      soundOn = !soundOn;
      elSoundIcon.style.opacity = soundOn ? "1" : "0.35";
    });

    // Send button
    elSend.addEventListener("click", () => sendMessage(elInput.value));

    // Enter key (Shift+Enter = new line)
    elInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(elInput.value);
      }
    });

    // Auto resize textarea
    elInput.addEventListener("input", () => {
      elInput.style.height = "auto";
      elInput.style.height = Math.min(elInput.scrollHeight, 100) + "px";
    });

    // FAQ chips
    document.querySelectorAll(".cb-faq-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        // Strip emoji for the actual query
        const q = chip.textContent.replace(/[^\u0000-\u007E\u0900-\u097F ]/g, "").trim();
        sendMessage(q);
        if (!isOpen) openChat();
      });
    });

    // Close on outside click (desktop)
    document.addEventListener("click", (e) => {
      if (isOpen && !elWindow.contains(e.target) && !elTrigger.contains(e.target)) {
        closeChat();
      }
    });

    // Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) closeChat();
    });
  }

  /* ──────────────────────────────────────────
     14. INIT
  ────────────────────────────────────────── */
  function init() {
    buildUI();

    // Cache DOM refs
    elTrigger   = document.getElementById("cb-trigger");
    elWindow    = document.getElementById("cb-window");
    elMessages  = document.getElementById("cb-messages");
    elInput     = document.getElementById("cb-input");
    elSend      = document.getElementById("cb-send");
    elBadge     = document.getElementById("cb-badge");
    elSoundIcon = document.getElementById("cb-sound-icon");

    // Load previous session or show welcome
    const hadHistory = loadFromStorage();
    if (!hadHistory) {
      showWelcome();
      // Auto-send greeting after 1.2s
      setTimeout(() => {
        appendMessage("bot", "Hello! 👋 I'm your IMCure Assistant. How can I help you today? You can ask me about payments, KYC onboarding, or anything about IMCure!");
      }, 1200);
    }

    bindEvents();

    // Show a badge after 4s if user hasn't opened yet
    setTimeout(() => {
      if (!isOpen) setBadge(1);
    }, 4000);
  }

  // Wait for DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
