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

const HOST = process.env.HOST || "ws://192.168.0.205:3000";
const USERNAME = process.argv[2] || "TriviaBot";
const GROQ_KEY = process.env.GROQ_KEY_ALT || process.env.GROQ_KEY || "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_KEY = process.env.GEMINI_KEY || "";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
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
const CEREBRAS_KEY = process.env.CEREBRAS_KEY || "";
const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
const SAMBANOVA_KEY = process.env.SAMBANOVA_KEY || "";
const SAMBANOVA_URL = "https://api.sambanova.ai/v1/chat/completions";
let currentProvider = 0;

const ANSWER_TIMEOUT = 60000;    // 1 min para responder, si nadie responde -> siguiente pregunta

// Estado
const scores = {};
const askedQuestions = new Set(); // evitar repeticiones
let currentQuestion = null;
let answerTimer = null;
let questionTimer = null;
let busy = false;
let questionCount = 0;

async function callGroq(prompt) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 400,
      temperature: 1.0,
    }),
  });
  const data = await res.json();
  if (data.choices && data.choices[0]) {
    return data.choices[0].message.content.trim();
  }
  throw new Error(data.error?.message || JSON.stringify(data));
}

async function callOpenRouter(prompt) {
  const shuffled = [...OPENROUTER_MODELS].sort(() => Math.random() - 0.5);
  for (const model of shuffled) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENROUTER_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 400,
          temperature: 1.0,
        }),
      });
      const data = await res.json();
      if (data.choices && data.choices[0]) {
        return data.choices[0].message.content.trim();
      }
      const err = data.error?.message || data.message || "";
      console.error(`[OpenRouter ${model.split("/")[1]?.split(":")[0]}: ${err || "sin respuesta"}]`);
    } catch (e) {
      console.error(`[OpenRouter ${model.split("/")[1]?.split(":")[0]}: ${e.message}]`);
    }
  }
  throw new Error("Todos los modelos de OpenRouter fallaron");
}

async function callCerebras(prompt) {
  const res = await fetch(CEREBRAS_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CEREBRAS_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 400,
      temperature: 1.0,
    }),
  });
  const data = await res.json();
  if (data.choices && data.choices[0]) {
    return data.choices[0].message.content.trim();
  }
  throw new Error(data.error?.message || JSON.stringify(data));
}

async function callSambaNova(prompt) {
  const res = await fetch(SAMBANOVA_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SAMBANOVA_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "Meta-Llama-3.3-70B-Instruct",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 400,
      temperature: 1.0,
    }),
  });
  const data = await res.json();
  if (data.choices && data.choices[0]) {
    return data.choices[0].message.content.trim();
  }
  throw new Error(data.error?.message || JSON.stringify(data));
}

async function callGemini(prompt) {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 1.0, maxOutputTokens: 400 },
    }),
  });
  const data = await res.json();
  if (data.candidates && data.candidates[0]) {
    return data.candidates[0].content.parts[0].text.trim();
  }
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

async function callAI(prompt) {
  // Intenta desde el provider actual, rotando si falla
  for (let i = 0; i < PROVIDERS.length; i++) {
    const idx = (currentProvider + i) % PROVIDERS.length;
    const provider = PROVIDERS[idx];
    try {
      const result = await provider.fn(prompt);
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
  currentProvider = 0; // reset para próximo intento
  return null;
}

// Categorías para variedad
const CATEGORIES = [
  "RPG clásicos (Final Fantasy, Chrono Trigger, Dragon Quest, etc.)",
  "shooters (Halo, Call of Duty, Counter-Strike, Doom, etc.)",
  "Nintendo (Mario, Zelda, Pokemon, Metroid, Kirby, etc.)",
  "PlayStation exclusivos (God of War, Uncharted, The Last of Us, etc.)",
  "juegos indie (Hollow Knight, Celeste, Undertale, Stardew Valley, etc.)",
  "juegos retro de los 80s y 90s (Pac-Man, Tetris, Street Fighter, etc.)",
  "battle royale y online (Fortnite, PUBG, Apex Legends, etc.)",
  "sandbox y supervivencia (Minecraft, Terraria, Rust, ARK, etc.)",
  "juegos de pelea (Tekken, Mortal Kombat, Smash Bros, etc.)",
  "horror (Resident Evil, Silent Hill, Outlast, Amnesia, etc.)",
  "carreras (Mario Kart, Need for Speed, Gran Turismo, Forza, etc.)",
  "MMORPGs (World of Warcraft, Guild Wars, RuneScape, etc.)",
  "desarrolladoras y estudios (Valve, Rockstar, FromSoftware, etc.)",
  "speedruns y records mundiales en videojuegos",
  "easter eggs y secretos famosos en videojuegos",
  "música y soundtracks de videojuegos",
  "lore y historia profunda de videojuegos",
  "juegos de estrategia (Age of Empires, StarCraft, Civilization, etc.)",
  "Souls-like (Dark Souls, Elden Ring, Bloodborne, Sekiro, etc.)",
  "GTA y Rockstar Games",
  "juegos móviles famosos",
  "consolas y hardware (historia de PlayStation, Xbox, Nintendo, etc.)",
  "personajes icónicos y sus orígenes",
  "fracasos épicos y juegos controversiales",
];

async function generateQuestion() {
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const alreadyAsked = [...askedQuestions].slice(-20).join("; ");

  const prompt = `Eres un generador de trivia de VIDEOJUEGOS. Genera UNA pregunta sobre: ${category}

PREGUNTAS YA HECHAS (NO REPETIR): ${alreadyAsked || "ninguna"}

Responde SOLO con este JSON exacto, sin texto adicional:
{"question":"¿Pregunta aquí?","options":{"A":"opción 1","B":"opción 2","C":"opción 3","D":"opción 4"},"answer":"X","fact":"Dato curioso en 1 oración"}

Reglas:
- "answer" es solo la letra correcta (A, B, C o D)
- Escribe todo en español
- Sé creativo, no hagas preguntas genéricas
- Las opciones incorrectas deben ser creíbles (no obvias)
- Seed: ${Math.random().toString(36).slice(2)}`;

  const text = await callAI(prompt);
  if (!text) return null;

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const q = JSON.parse(jsonMatch[0]);
      // Verificar que no se repita (sin recursión)
      if (askedQuestions.has(q.question)) {
        console.log("[SKIP] Pregunta repetida, descartada");
        return null;
      }
      askedQuestions.add(q.question);
      return q;
    }
  } catch (e) {
    console.error("[Parse Error]", e.message);
  }
  return null;
}

async function generateComment(username, userAnswer, correctAnswer, question, options) {
  const prompt = `Eres el host de una trivia de videojuegos en un chat grupal. Tu nombre es ${USERNAME}.

${username} respondió "${userAnswer}) ${options[userAnswer]}" a la pregunta: "${question}"
La respuesta correcta era: "${correctAnswer}) ${options[correctAnswer]}"

Responde en español, 1-2 oraciones máximo:
- Explica brevemente por qué "${options[correctAnswer]}" es correcto
- Si la respuesta del usuario es confundible, menciona por qué se pudo confundir
- Sé conversacional y divertido, no condescendiente
- No uses emojis`;

  return await callAI(prompt);
}

async function generateCorrectComment(username, correctAnswer, question, options, fact) {
  const prompt = `Eres el host de una trivia de videojuegos en un chat grupal. Tu nombre es ${USERNAME}.

${username} respondió CORRECTAMENTE "${correctAnswer}) ${options[correctAnswer]}" a la pregunta: "${question}"
Dato: ${fact}

Responde en español, 1-2 oraciones:
- Felicita brevemente y agrega un dato interesante o comenta algo divertido
- Sé conversacional, no genérico
- No uses emojis`;

  return await callAI(prompt);
}

function formatQuestionMessages(q, num) {
  return [
    `===== TRIVIA #${num} ===== ${q.question}`,
    `A) ${q.options.A}  |  B) ${q.options.B}  |  C) ${q.options.C}  |  D) ${q.options.D}`,
  ];
}

function formatScoreboardMessages() {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return ["Nadie ha jugado todavia."];
  const medals = ["1ro", "2do", "3ro"];
  const lines = sorted.map(([user, score], i) => {
    const medal = medals[i] || `${i + 1}to`;
    return `${medal}. ${user} - ${score} pts`;
  });
  return [`===== RANKING =====`, ...lines];
}

function send(ws, text) {
  ws.send(JSON.stringify({ type: "message", text }));
}

function sendMultiple(ws, messages, delay = 300) {
  messages.forEach((msg, i) => {
    setTimeout(() => send(ws, msg), i * delay);
  });
}

function resetTimer(ws) {
  if (questionTimer) clearTimeout(questionTimer);
  questionTimer = setTimeout(() => askQuestion(ws), ANSWER_TIMEOUT);
}

// Genera la siguiente pregunta y la devuelve formateada (no la envía)
async function prepareNextQuestion() {
  const q = await generateQuestion();
  if (!q) return null;
  questionCount++;
  currentQuestion = q;
  console.log(`[PREGUNTA #${questionCount}] ${q.question} -> ${q.answer}`);
  return formatQuestionMessages(q, questionCount);
}

async function askQuestion(ws, prefixMessages) {
  if (busy) return;
  busy = true;

  const questionMsgs = await prepareNextQuestion();
  if (!questionMsgs) {
    busy = false;
    resetTimer(ws);
    return;
  }

  // Combinar: primero los mensajes previos (respuesta), luego la pregunta
  const allMessages = [...(prefixMessages || []), ...questionMsgs];
  sendMultiple(ws, allMessages);

  // 1 min para responder, si nadie responde -> revela y lanza siguiente
  if (answerTimer) clearTimeout(answerTimer);
  answerTimer = setTimeout(async () => {
    if (currentQuestion) {
      const reveal = [
        `TIEMPO AGOTADO! Respuesta: ${currentQuestion.answer}) ${currentQuestion.options[currentQuestion.answer]}`,
        currentQuestion.fact,
      ];
      currentQuestion = null;
      busy = false;
      askQuestion(ws, reveal);
    }
  }, ANSWER_TIMEOUT);
}

async function checkAnswer(ws, username, text) {
  if (!currentQuestion) return;

  const clean = text.trim().toUpperCase();
  const match = clean.match(/^([ABCD])[).\s]?$/);
  if (!match) return;

  const letter = match[1];
  const correct = currentQuestion.answer.toUpperCase();
  const q = currentQuestion;

  if (letter === correct) {
    if (answerTimer) clearTimeout(answerTimer);
    if (!scores[username]) scores[username] = 0;
    scores[username] += 10;

    currentQuestion = null;
    busy = false;

    // Comentario con IA
    const comment = await generateCorrectComment(username, correct, q.question, q.options, q.fact);
    const response = comment || `Correcto! ${q.fact}`;
    const prefixMessages = [
      `CORRECTO! ${correct}) ${q.options[correct]} -- ${username} +10 pts (total: ${scores[username]})`,
      response,
    ];
    console.log(`[CORRECTO] ${username} -> ${scores[username]} pts`);

    askQuestion(ws, prefixMessages);
  } else {
    if (answerTimer) clearTimeout(answerTimer);
    if (!scores[username]) scores[username] = 0;
    scores[username] = Math.max(0, scores[username] - 2);

    currentQuestion = null;
    busy = false;

    // Comentario con IA sobre el error
    const comment = await generateComment(username, letter, correct, q.question, q.options);
    const response = comment || `Incorrecto.`;
    const prefixMessages = [
      `INCORRECTO! La correcta era: ${correct}) ${q.options[correct]} -- ${username} -2 pts (total: ${scores[username]})`,
      `${response} | ${q.fact}`,
    ];
    console.log(`[INCORRECTO] ${username} eligió ${letter}, era ${correct}`);

    askQuestion(ws, prefixMessages);
  }
}

// === WebSocket ===
const ws = new WebSocket(HOST);

ws.on("open", () => {
  console.log(`Conectado como "${USERNAME}"`);
  ws.send(JSON.stringify({ type: "join", username: USERNAME }));
  setTimeout(() => askQuestion(ws), 5000);
});

ws.on("message", async (data) => {
  const msg = JSON.parse(data);

  if (msg.type === "system") {
    console.log(`[SISTEMA] ${msg.text}`);
    return;
  }

  if (msg.type === "message" && msg.username && msg.username !== USERNAME) {
    const text = msg.text || "";
    const lower = text.toLowerCase().trim();

    // Comandos
    if (lower === "!ranking" || lower === "!score" || lower === "!puntos") {
      sendMultiple(ws, formatScoreboardMessages());
      resetTimer(ws);
      return;
    }

    if (lower === "!trivia" || lower === "!next") {
      if (!currentQuestion && !busy) {
        if (questionTimer) clearTimeout(questionTimer);
        askQuestion(ws);
      }
      return;
    }

    if (lower === "!help" || lower === "!ayuda") {
      sendMultiple(ws, [
        "===== TRIVIA BOT ===== Responde con la letra (A, B, C o D) | +10 pts correcta | -2 pts incorrecta",
        "!trivia / !next - Siguiente  |  !ranking - Puntajes  |  !help - Ayuda",
      ]);
      resetTimer(ws);
      return;
    }

    // Si alguien le habla al bot (menciona su nombre o pregunta), resetear timer
    const botMention = lower.includes(USERNAME.toLowerCase());
    if (botMention) {
      resetTimer(ws);
    }

    // Verificar si es una respuesta
    await checkAnswer(ws, msg.username, text);
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
