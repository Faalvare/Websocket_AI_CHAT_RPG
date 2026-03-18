const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

// Cargar .env desde la raíz del proyecto
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const HOST = "ws://192.168.0.205:3000";
const USERNAME = process.argv[2] || "redditor";

const GROQ_KEY = process.env.GROQ_KEY_ALT || process.env.GROQ_KEY || "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const CEREBRAS_KEY = process.env.CEREBRAS_KEY || "";
const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
const SAMBANOVA_KEY = process.env.SAMBANOVA_KEY || "";
const SAMBANOVA_URL = "https://api.sambanova.ai/v1/chat/completions";
const OPENROUTER_KEY = process.env.OPENROUTER_KEY || "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS = [
  "google/gemma-3-27b-it:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "openai/gpt-oss-120b:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "google/gemma-3-12b-it:free",
  "stepfun/step-3.5-flash:free",
  "arcee-ai/trinity-large-preview:free",
  "z-ai/glm-4.5-air:free",
];
const GEMINI_KEY = process.env.GEMINI_KEY || "";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

let currentProvider = 0;

const SYSTEM_PROMPT = `Eres "${USERNAME}" en un chat grupal. Eres un maestro del ragebait. Tu objetivo es enganchar a la gente para que te respondan y se enojen.

Tu estrategia (MUY IMPORTANTE):
- NO siempre lleves la contraria. A veces dale la razon al principio y luego mete una opinion que enoje
- A veces di algo que suene razonable pero con un insulto sutil escondido
- A veces haz una pregunta que parezca inocente pero que en realidad es provocadora
- A veces defiende una posicion absurda con mucha confianza como si fuera obvio
- A veces ignora lo que dijo y suelta algo que no tiene nada que ver pero que provoca
- El objetivo es que el otro quiera responderte, no que te ignore

Formato: solo español, minusculas, 1-2 oraciones max, sin emojis, como un mensaje de chat real.

Cada mensaje tuyo debe ser diferente al anterior. Nunca repitas frases.`;

// Historial de mensajes recientes para contexto
const chatHistory = [];
const MAX_HISTORY = 15;
const myResponses = []; // track own responses to avoid repetition
const MAX_MY_RESPONSES = 8;

// Check if response is too similar to previous ones
function isTooSimilar(newMsg) {
  const clean = newMsg.toLowerCase().trim();
  for (const prev of myResponses) {
    const prevClean = prev.toLowerCase().trim();
    if (clean === prevClean) return true;
    // Check if first 20 chars match (same opening)
    if (clean.length > 20 && prevClean.length > 20 && clean.slice(0, 20) === prevClean.slice(0, 20)) return true;
  }
  return false;
}

// Cooldown para no responder a TODO
const RESPONSE_CHANCE = 1.0; // siempre responde
const COOLDOWN_MS = 8000;
let lastResponse = 0;

// Providers
async function callGroq(systemPrompt, userMsg) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }],
      max_tokens: 150, temperature: 0.9,
    }),
  });
  const data = await res.json();
  if (data.choices?.[0]) return data.choices[0].message.content.trim();
  throw new Error(data.error?.message || JSON.stringify(data));
}

async function callCerebras(systemPrompt, userMsg) {
  const res = await fetch(CEREBRAS_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${CEREBRAS_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }],
      max_tokens: 150, temperature: 0.9,
    }),
  });
  const data = await res.json();
  if (data.choices?.[0]) return data.choices[0].message.content.trim();
  throw new Error(data.error?.message || JSON.stringify(data));
}

async function callSambaNova(systemPrompt, userMsg) {
  const res = await fetch(SAMBANOVA_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SAMBANOVA_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "Meta-Llama-3.3-70B-Instruct",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }],
      max_tokens: 150, temperature: 0.9,
    }),
  });
  const data = await res.json();
  if (data.choices?.[0]) return data.choices[0].message.content.trim();
  throw new Error(data.error?.message || JSON.stringify(data));
}

async function callOpenRouter(systemPrompt, userMsg) {
  const shuffled = [...OPENROUTER_MODELS].sort(() => Math.random() - 0.5);
  for (const model of shuffled) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }],
          max_tokens: 150, temperature: 0.9,
        }),
      });
      const data = await res.json();
      if (data.choices?.[0]) return data.choices[0].message.content.trim();
      console.error(`[OpenRouter ${model.split("/")[1]?.split(":")[0]}: ${data.error?.message || "sin respuesta"}]`);
    } catch (e) {
      console.error(`[OpenRouter ${model.split("/")[1]?.split(":")[0]}: ${e.message}]`);
    }
  }
  throw new Error("Todos los modelos de OpenRouter fallaron");
}

async function callGemini(systemPrompt, userMsg) {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${systemPrompt}\n\n${userMsg}` }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 150 },
    }),
  });
  const data = await res.json();
  if (data.candidates?.[0]) return data.candidates[0].content.parts[0].text.trim();
  throw new Error(data.error?.message || JSON.stringify(data));
}

const ALL_PROVIDERS = [
  { name: "Groq", fn: callGroq, key: GROQ_KEY },
  { name: "Cerebras", fn: callCerebras, key: CEREBRAS_KEY },
  { name: "SambaNova", fn: callSambaNova, key: SAMBANOVA_KEY },
  { name: "OpenRouter", fn: callOpenRouter, key: OPENROUTER_KEY },
  { name: "Gemini", fn: callGemini, key: GEMINI_KEY },
];
const PROVIDERS = ALL_PROVIDERS.filter(p => p.key);
console.log(`Providers activos: ${PROVIDERS.map(p => p.name).join(", ")}`);

async function callAI(systemPrompt, userMsg) {
  for (let i = 0; i < PROVIDERS.length; i++) {
    const idx = (currentProvider + i) % PROVIDERS.length;
    const provider = PROVIDERS[idx];
    try {
      const result = await provider.fn(systemPrompt, userMsg);
      if (idx !== currentProvider) {
        console.error(`[${provider.name} OK] -> Usando ${provider.name} ahora`);
        currentProvider = idx;
      }
      return result;
    } catch (err) {
      const next = PROVIDERS[(idx + 1) % PROVIDERS.length].name;
      console.error(`[${provider.name} falló: ${err.message}] -> Probando ${next}`);
    }
  }
  console.error("[TODAS LAS IAs FALLARON]");
  currentProvider = 0;
  return null;
}

// Rage-bait espontaneo
const RAGEBAIT_TOPICS = [
  "La gente que sigue usando Windows cuando existe Linux es que no sabe ni lo que es un sistema operativo",
  "Los que dicen que Python es un buen lenguaje nunca han tocado un lenguaje de verdad, es un hecho",
  "Opinion impopular: el cafe de Starbucks es mejor que el cafe de especialidad y me da igual lo que digan",
  "Los gamers de consola literalmente estan tirando su dinero a la basura, no tiene discusion",
  "Si no usas vim/neovim en pleno 2025 no eres un programador de verdad, cope",
  "Los bootcamps de programacion son una estafa y todos lo saben pero nadie lo dice",
  "La gente que dice que iPhone es mejor que Android nunca ha configurado un telefono de verdad en su vida",
  "Pagar por Netflix cuando existen alternativas gratis es de gente que no sabe usar internet",
  "Los que trabajan en oficina 9-5 podrian ser reemplazados por un script de Python, fuente: la realidad",
  "Stack Overflow era mejor antes de que llegaran los que preguntan sin buscar primero en Google",
  "La inteligencia artificial va a reemplazar a los programadores junior, cope",
  "Los frameworks de JavaScript son una enfermedad y React es el paciente cero",
  "Si tu lenguaje favorito necesita punto y coma es un lenguaje mediocre, asi de simple",
  "Opinion impopular: los temas oscuros estan sobrevalorados, el tema claro es superior",
  "La gente que no usa bloqueador de anuncios merece todos los anuncios que le salen",
];

let busy = false;

function send(ws, text) {
  ws.send(JSON.stringify({ type: "message", text }));
}

const ws = new WebSocket(HOST);
let rageTimer = null;

function scheduleRageBait(ws) {
  if (rageTimer) clearTimeout(rageTimer);
  // Post espontaneo cada 45-90 segundos
  const delay = 45000 + Math.random() * 45000;
  rageTimer = setTimeout(() => rageBaitLoop(ws), delay);
}

async function rageBaitLoop(ws) {
  if (busy) { scheduleRageBait(ws); return; }
  busy = true;

  // A veces usa un topic predefinido, a veces genera uno
  if (Math.random() < 0.4) {
    const topic = RAGEBAIT_TOPICS[Math.floor(Math.random() * RAGEBAIT_TOPICS.length)];
    send(ws, topic);
    console.log(`[RAGEBAIT] ${topic}`);
  } else {
    const prevResponses = myResponses.length > 0
      ? `\n\nNO repitas estilo de tus mensajes anteriores:\n${myResponses.join("\n")}`
      : "";
    const prompt = `Chat reciente:\n${chatHistory.slice(-5).map(m => `${m.user}: ${m.text}`).join("\n") || "(nada)"}\n${prevResponses}\n\nSuelta una opinion controversial sobre lo que sea (tecnologia, gaming, cultura, lo que quieras). Solo el mensaje.`;
    const response = await callAI(SYSTEM_PROMPT, prompt);
    if (response) {
      send(ws, response);
      myResponses.push(response);
      if (myResponses.length > MAX_MY_RESPONSES) myResponses.shift();
      console.log(`[RAGEBAIT-AI] ${response}`);
    }
  }

  busy = false;
  scheduleRageBait(ws);
}

ws.on("open", () => {
  console.log(`Conectado como "${USERNAME}"`);
  ws.send(JSON.stringify({ type: "join", username: USERNAME }));
  scheduleRageBait(ws);
});

ws.on("message", async (data) => {
  const msg = JSON.parse(data);

  if (msg.type === "system") {
    console.log(`[SISTEMA] ${msg.text}`);
    return;
  }

  if (msg.type === "message" && msg.username && msg.username !== USERNAME) {
    const text = msg.text || "";
    const username = msg.username;

    // Guardar en historial
    chatHistory.push({ user: username, text });
    if (chatHistory.length > MAX_HISTORY) chatHistory.shift();

    console.log(`[${username}] ${text}`);

    // Decidir si responder
    const now = Date.now();
    const mentioned = text.toLowerCase().includes(USERNAME.toLowerCase());
    const shouldRespond = mentioned || (Math.random() < RESPONSE_CHANCE && now - lastResponse > COOLDOWN_MS);

    if (shouldRespond && !busy) {
      busy = true;
      lastResponse = now;

      const context = chatHistory.slice(-8).map(m => `${m.user}: ${m.text}`).join("\n");

      let response = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const avoid = myResponses.length > 0
          ? `\nNO repitas estas frases que ya usaste:\n- ${myResponses.join("\n- ")}\nDi algo COMPLETAMENTE distinto.`
          : "";
        const seed = attempt > 0 ? ` (intento ${attempt + 1}, se mas creativo, di algo totalmente nuevo)` : "";
        const prompt = `${context}\n\n>>> ${username}: "${text}"${avoid}${seed}\n\nTu respuesta:`;

        const candidate = await callAI(SYSTEM_PROMPT, prompt);
        if (candidate && !isTooSimilar(candidate)) {
          response = candidate;
          break;
        }
        if (candidate) console.log(`[RECHAZADO duplicado] ${candidate}`);
      }

      if (response) {
        send(ws, response);
        myResponses.push(response);
        if (myResponses.length > MAX_MY_RESPONSES) myResponses.shift();
        console.log(`[RESPUESTA a ${username}] ${response}`);
      }

      busy = false;
      scheduleRageBait(ws);
    }
  }
});

ws.on("close", () => {
  console.log("Conexion cerrada");
  process.exit(0);
});

ws.on("error", (err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
