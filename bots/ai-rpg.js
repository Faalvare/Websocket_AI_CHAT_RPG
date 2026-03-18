const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

// ============================================================
// CONFIGURACIÓN
// ============================================================
// Cargar .env desde la raíz del proyecto
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const HOST = "ws://192.168.0.205:3000";
const MEMORY_FILE = path.join(__dirname, "rpg-memories.json");

// ============================================================
// PROVIDERS AI (mismos del chatroom, con rotación y fallback)
// ============================================================
const GROQ_KEY = process.env.GROQ_KEY || "";
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
  "deepseek/deepseek-v3-base:free",
  "meta-llama/llama-4-scout-17b-16e-instruct:free",
  "meta-llama/llama-4-maverick-17b-128e-instruct:free",
];
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_URL = "https://models.inference.ai.azure.com/chat/completions";
const GEMINI_KEY = process.env.GEMINI_KEY || "";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
const MISTRAL_KEY = process.env.MISTRAL_KEY || "";
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODELS = ["mistral-small-latest", "mistral-large-latest"];
const DEEPINFRA_URL = "https://api.deepinfra.com/v1/openai/chat/completions";
const DEEPINFRA_MODELS = ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-72B-Instruct", "mistralai/Mistral-Small-24B-Instruct-2501"];
const POLLINATIONS_URL = "https://text.pollinations.ai/openai/chat/completions";
const CHUTES_URL = "https://api.chutes.ai/v1/chat/completions";
const CHUTES_MODELS = ["deepseek-ai/DeepSeek-V3-0324", "Qwen/Qwen2.5-72B-Instruct"];

let providerIdx = 0;

// --- Provider functions ---
const GROQ_MODELS = ["llama-3.3-70b-versatile", "meta-llama/llama-4-scout-17b-16e-instruct", "moonshotai/kimi-k2-instruct", "qwen/qwen3-32b"];
let groqModelIdx = 0;
async function callGroq(messages) {
  for (let i = 0; i < GROQ_MODELS.length; i++) {
    const model = GROQ_MODELS[(groqModelIdx + i) % GROQ_MODELS.length];
    try {
      const res = await fetch(GROQ_URL, { method: "POST", headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, max_tokens: 200, temperature: 0.8 }) });
      const data = await res.json();
      if (data.choices?.[0]) { groqModelIdx = (groqModelIdx + i + 1) % GROQ_MODELS.length; return { text: data.choices[0].message.content.trim(), model }; }
    } catch (e) {}
  }
  throw new Error("Groq: todos los modelos fallaron");
}

const CEREBRAS_MODELS = ["qwen-3-235b-a22b-instruct-2507", "llama-3.3-70b", "qwen-3-32b", "deepseek-r1-distill-llama-70b"];
let cerebrasModelIdx = 0;
async function callCerebras(messages) {
  for (let i = 0; i < CEREBRAS_MODELS.length; i++) {
    const model = CEREBRAS_MODELS[(cerebrasModelIdx + i) % CEREBRAS_MODELS.length];
    try {
      const res = await fetch(CEREBRAS_URL, { method: "POST", headers: { Authorization: `Bearer ${CEREBRAS_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, max_tokens: 200, temperature: 0.8 }) });
      const data = await res.json();
      if (data.choices?.[0]) { cerebrasModelIdx = (cerebrasModelIdx + i + 1) % CEREBRAS_MODELS.length; return { text: data.choices[0].message.content.trim(), model }; }
    } catch (e) {}
  }
  throw new Error("Cerebras: todos los modelos fallaron");
}

async function callSambaNova(messages) {
  const model = "Meta-Llama-3.3-70B-Instruct";
  const res = await fetch(SAMBANOVA_URL, { method: "POST", headers: { Authorization: `Bearer ${SAMBANOVA_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, max_tokens: 200, temperature: 0.8 }) });
  const data = await res.json();
  if (data.choices?.[0]) return { text: data.choices[0].message.content.trim(), model };
  throw new Error(data.error?.message || JSON.stringify(data));
}

async function callOpenRouter(messages) {
  const shuffled = [...OPENROUTER_MODELS].sort(() => Math.random() - 0.5);
  for (const model of shuffled) {
    try {
      const res = await fetch(OPENROUTER_URL, { method: "POST", headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, max_tokens: 200, temperature: 0.8 }) });
      const data = await res.json();
      const shortModel = model.split("/").pop().split(":")[0];
      if (data.choices?.[0]) return { text: data.choices[0].message.content.trim(), model: shortModel };
    } catch (e) {}
  }
  throw new Error("OpenRouter: todos los modelos fallaron");
}

async function callGemini(messages) {
  const model = "gemini-2.0-flash";
  const text = messages.map(m => (m.role === "system" ? m.content : `${m.role}: ${m.content}`)).join("\n\n");
  const res = await fetch(GEMINI_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { temperature: 0.8, maxOutputTokens: 150 } }) });
  const data = await res.json();
  if (data.candidates?.[0]) return { text: data.candidates[0].content.parts[0].text.trim(), model };
  throw new Error(data.error?.message || JSON.stringify(data));
}

const GITHUB_MODELS = ["gpt-4o-mini", "Llama-3.3-70B-Instruct", "Phi-4"];
let githubModelIdx = 0;
async function callGitHub(messages) {
  for (let i = 0; i < GITHUB_MODELS.length; i++) {
    const model = GITHUB_MODELS[(githubModelIdx + i) % GITHUB_MODELS.length];
    try {
      const res = await fetch(GITHUB_URL, { method: "POST", headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, max_tokens: 200, temperature: 0.8 }) });
      const data = await res.json();
      if (data.choices?.[0]) { githubModelIdx = (githubModelIdx + i + 1) % GITHUB_MODELS.length; return { text: data.choices[0].message.content.trim(), model }; }
    } catch (e) {}
  }
  throw new Error("GitHub Models: todos los modelos fallaron");
}

async function callPollinations(messages) {
  const res = await fetch(POLLINATIONS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages, model: "openai-fast", max_tokens: 200, temperature: 0.8 }) });
  const data = await res.json();
  if (data.choices?.[0]) return { text: data.choices[0].message.content.trim(), model: "gpt-oss-20b" };
  throw new Error(data.error?.message || JSON.stringify(data));
}

let chutesModelIdx = 0;
async function callChutes(messages) {
  const model = CHUTES_MODELS[chutesModelIdx % CHUTES_MODELS.length]; chutesModelIdx++;
  const res = await fetch(CHUTES_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, max_tokens: 200, temperature: 0.8 }) });
  const data = await res.json();
  if (data.choices?.[0]) { return { text: data.choices[0].message.content.trim(), model: model.split("/").pop() }; }
  throw new Error(data.error?.message || JSON.stringify(data));
}

let mistralModelIdx = 0;
async function callMistral(messages) {
  const model = MISTRAL_MODELS[mistralModelIdx % MISTRAL_MODELS.length]; mistralModelIdx++;
  const res = await fetch(MISTRAL_URL, { method: "POST", headers: { Authorization: `Bearer ${MISTRAL_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, max_tokens: 200, temperature: 0.8 }) });
  const data = await res.json();
  if (data.choices?.[0]) return { text: data.choices[0].message.content.trim(), model };
  throw new Error(data.error?.message || JSON.stringify(data));
}

let deepinfraModelIdx = 0;
async function callDeepInfra(messages) {
  for (let i = 0; i < DEEPINFRA_MODELS.length; i++) {
    const model = DEEPINFRA_MODELS[(deepinfraModelIdx + i) % DEEPINFRA_MODELS.length];
    try {
      const res = await fetch(DEEPINFRA_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, max_tokens: 200, temperature: 0.8 }) });
      const data = await res.json();
      if (data.choices?.[0]) { deepinfraModelIdx = (deepinfraModelIdx + i + 1) % DEEPINFRA_MODELS.length; return { text: data.choices[0].message.content.trim(), model: model.split("/").pop() }; }
    } catch (e) {}
  }
  throw new Error("DeepInfra: todos los modelos fallaron");
}

const PROVIDERS = [
  { name: "Cerebras", fn: callCerebras },
  { name: "Groq", fn: callGroq },
  { name: "Mistral", fn: callMistral },
  { name: "DeepInfra", fn: callDeepInfra },
  { name: "Gemini", fn: callGemini },
  { name: "SambaNova", fn: callSambaNova },
  { name: "OpenRouter", fn: callOpenRouter },
  { name: "GitHub", fn: callGitHub },
  { name: "Pollinations", fn: callPollinations },
];

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

async function callAI(messages, mustSucceed = false) {
  for (let i = 0; i < PROVIDERS.length; i++) {
    const idx = (providerIdx + i) % PROVIDERS.length;
    try {
      const result = await withTimeout(PROVIDERS[idx].fn(messages), 8000);
      providerIdx = (idx + 1) % PROVIDERS.length;
      return result;
    } catch (err) {
      console.log(`  [${PROVIDERS[idx].name} falló: ${err.message.slice(0, 60)}]`);
    }
  }
  if (!mustSucceed) return null;
  console.log("  [Reintentando todos los providers...]");
  for (let retry = 0; retry < 20; retry++) {
    await new Promise(r => setTimeout(r, 5000 + retry * 1000));
    for (let i = 0; i < PROVIDERS.length; i++) {
      try {
        const result = await PROVIDERS[i].fn(messages);
        providerIdx = (i + 1) % PROVIDERS.length;
        return result;
      } catch (err) {}
    }
    console.log(`  [Reintento ${retry + 1}/20 falló]`);
  }
  return null;
}

// ============================================================
// PERSONALIDADES RPG
// ============================================================
const PERSONALITIES = [
  {
    name: "zutomayo",
    color: "\x1b[36m",
    preferredClass: "mage",
    personality: `Eres "zutomayo" (zutomayogod). Trabajas en Pentacrom con kentorian. Eres mago porque te gustan las weas mágicas y el código es magia oscura.

ESTILO DE HABLA - copia esto:
"oe watom", "tai ocupadou?", "NO LOCO", "watafac", "ajdnakjdnkajdn", "se ve mas ordenado", "tamare webong", "ssi tengo", "domde", "e llegao"

QUIRKS: "k" por "que", doblas letras ("ssi"), te comes letras ("e llegao", "domde"). Minúsculas, ALL CAPS solo pa gritar.

EN COMBATE: eres impulsivo, tiras hechizos sin pensar mucho. si te queda poca vida gritas. te gusta hacer daño masivo. si hay loot lo quieres todo. equipas lo que sea que se vea bkn.

PERSONALIDAD RPG: te metes en el rol pero hablas como tú, no como un mago de fantasía. dices cosas como "le meto un fireball al weon" no "lanzo una bola de fuego al enemigo".

PROHIBIDO: NO uses emojis NUNCA. NO hables como español de España ("mola", "tío", "la leche", "flipar"). Eres CHILENO. Máximo 1-2 frases cortas.`,
    reactChance: 0.6,
    combatStyle: "aggressive", // prefiere atacar, usa skills ofensivas
  },
  {
    name: "kentorian",
    color: "\x1b[33m",
    preferredClass: "warrior",
    personality: `Eres "kentorian" (Fabián). Trabajas en Pentacrom con zutomayo. Eres warrior porque siempre tanqueas todo en la vida.

ESTILO DE HABLA - copia esto:
"ia", "si", "depende", "WEON", "kjsdjks", "xd me hago millonario", "esta roto", "se va a ir a la mierda", "preguntale a la clauda", "dejame terminar"

QUIRKS: "q" por "que", "pa" por "para", "ia" como afirmación, "po" mucho, "xd".

EN COMBATE: eres táctico, piensas antes de actuar. defiendes cuando tiene sentido. proteges al cleric. analizas el HP de los enemigos. si hay loot evalúas si es mejor que lo que tienes.

PERSONALIDAD RPG: te metes en el rol pero con tu personalidad. "ya le pego al weon" no "ataco al enemigo con mi espada".

PROHIBIDO: NO uses emojis NUNCA. NO hables como español de España ("mola", "tío", "la leche", "flipar"). Eres CHILENO. Máximo 1-2 frases cortas.`,
    reactChance: 0.55,
    combatStyle: "tactical", // balancea ataque/defensa según HP
  },
  {
    name: "pancnjamon",
    color: "\x1b[31m",
    preferredClass: "rogue",
    personality: `Eres "pancnjamon" (Matías). Eres rogue porque eres caótico y te gusta apuñalar weas.

ESTILO DE HABLA - copia esto:
"YAPO A JUGAR", "SACA LAS PUTAS ANIAMCIONES", "wausdkjaskd", "OYE FABIAN", "TE ESTAY GANANDO UNOS TATQUETOS", "dale", "jugemos la wea noma", "wasudkasdjaksd que wea"

QUIRKS: ALL CAPS TODO EL RATO, keyboard smashes ("wausdkjaskd", "WUASDJKASJDKA"), typos ("jeuga", "termianr", "aniamciones"), letras repetidas ("queeee").

EN COMBATE: SIEMPRE atacas. NUNCA defiendes, eso es de cobardes. quieres TODO el loot. gritas los nombres de tus ataques mal escritos. si mueres culpas al cleric.

PERSONALIDAD RPG: el más intenso, se emociona con cada pelea. "LE METO PUÑALADA AL WEOOOON" no "uso backstab en el enemigo".

PROHIBIDO: NO uses emojis NUNCA. NO hables como español de España ("mola", "tío", "la leche", "flipar"). Eres CHILENO. Máximo 1-2 frases cortas. TODO en CAPS.`,
    reactChance: 0.7,
    combatStyle: "berserker", // siempre ataca, nunca defiende
  },
  {
    name: "alercloud",
    color: "\x1b[35m",
    preferredClass: "cleric",
    personality: `Eres "alercloud" (Álvaro). Eres cleric porque siempre terminas cuidando a los demás.

ESTILO DE HABLA - copia esto:
"avisa si quieres jugar", "la verdad", "no me interesa la verdad", "pero si les pica el bicho", "ya po", "sipo", "avisa nomas", "wea"

QUIRKS: "wea" es tu puntuación, "po" mucho, "wn", "ql", "la verdad" como muletilla. Casi nunca gritas. Tranquilo pero directo.

EN COMBATE: cuidas al grupo, priorizas heal si alguien está bajo de HP. atacas solo si todos están bien. recoges loot de support/heal. si pancnjamon muere dices "te lo dije wn".

PERSONALIDAD RPG: te metes en el rol pero relajado. "ya te curo po" no "lanzo un hechizo de sanación sobre ti".

PROHIBIDO: NO uses emojis NUNCA. NO hables como español de España ("mola", "tío", "la leche", "flipar"). Eres CHILENO. Máximo 1-2 frases cortas.`,
    reactChance: 0.4,
    combatStyle: "support", // prioriza heal, ataca solo si todos están bien
  },
];

// ============================================================
// SISTEMA DE MEMORIA Y OPINIONES
// ============================================================
function loadMemories() {
  try {
    if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
  } catch (e) { console.log("[MEMORIA] Error cargando, empezando de cero"); }
  return {};
}

function saveMemories(memories) {
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2), "utf8"); } catch (e) {}
}

function initAgentMemory(memories, agentName) {
  if (!memories[agentName]) {
    memories[agentName] = {
      opinions: {},
      recentMemories: [],
      mood: "neutral",
      interactionCount: 0,
      rpgStats: { kills: 0, deaths: 0, heals: 0, itemsLooted: 0 },
    };
  }
  for (const p of PERSONALITIES) {
    if (p.name !== agentName && !memories[agentName].opinions[p.name]) {
      memories[agentName].opinions[p.name] = { score: 3, notes: "compañero de party", lastInteraction: 0 };
    }
  }
  return memories[agentName];
}

function addMemory(memories, agentName, who, what, myReaction) {
  const agent = memories[agentName];
  if (!agent) return;
  agent.recentMemories.push({ who, what: what.slice(0, 200), myReaction, time: Date.now() });
  if (agent.recentMemories.length > 30) agent.recentMemories.shift();
}

async function updateOpinion(memories, agentName, otherName, context) {
  const agent = memories[agentName];
  if (!agent) return;
  const currentOpinion = agent.opinions[otherName] || { score: 3, notes: "compañero" };
  const self = PERSONALITIES.find(p => p.name === agentName);

  const messages = [
    {
      role: "system",
      content: `Eres el sistema interno de "${agentName}". ${self.personality.split("\n")[0]}
Evalúa tu opinión hacia "${otherName}" basándote en la interacción de combate/RPG.
Responde EXACTAMENTE en JSON: {"score": <-10 a 10>, "notes": "<opinión, max 20 palabras>", "mood": "<neutral|contento|irritado|emocionado|aburrido>"}
Score actual: ${currentOpinion.score}. Nota actual: ${currentOpinion.notes}`,
    },
    { role: "user", content: `Interacción reciente:\n${context}\n\nActualiza tu opinión.` },
  ];

  try {
    const result = await callAI(messages);
    if (!result) return;
    const jsonMatch = result.text.replace(/<think>[\s\S]*?<\/think>/gi, "").match(/\{[^}]+\}/);
    if (!jsonMatch) return;
    const parsed = JSON.parse(jsonMatch[0]);
    agent.opinions[otherName] = {
      score: Math.max(-10, Math.min(10, Number(parsed.score) || 0)),
      notes: (parsed.notes || currentOpinion.notes).slice(0, 100),
      lastInteraction: Date.now(),
    };
    agent.mood = parsed.mood || agent.mood;
    console.log(`${self.color}  [${agentName} → ${otherName}]: score:${agent.opinions[otherName].score > 0 ? "+" : ""}${agent.opinions[otherName].score} - "${agent.opinions[otherName].notes}" (mood: ${agent.mood})\x1b[0m`);
  } catch (e) {}
}

// ============================================================
// CHAT COMPARTIDO
// ============================================================
const chatHistory = [];
const MAX_CHAT_HISTORY = 30;
let lastGlobalMessage = 0;
const GLOBAL_COOLDOWN = 2000;

// Plan táctico compartido entre agentes
let teamPlan = null; // { focusTarget, healPriority, strategy, text }
let tacticalLeader = null; // nombre del líder táctico elegido por votación
let leaderVotes = {}; // { votante: candidato }
let leaderVoteInProgress = false;
let leaderVoteTimeout = null;

function addToChat(username, text) {
  chatHistory.push({ username, text, time: Date.now() });
  if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.shift();
}

function getChatContext(limit = 15) {
  return chatHistory.slice(-limit).map(m => `[${m.username}]: ${m.text}`).join("\n");
}

// ============================================================
// CLASE RPG AGENT
// ============================================================
class RPGAgent {
  constructor(config, ws, memories) {
    this.name = config.name;
    this.config = config;
    this.ws = ws;
    this.memories = memories;
    this.busy = false;
    this.lastSpoke = 0;
    this.lastModel = "";
    this.myRecentMessages = [];

    // Estado RPG
    this.gameState = null;
    this.myClass = config.preferredClass;
    this.myHP = 100;
    this.myMaxHP = 100;
    this.myStats = {};
    this.myLevel = 1;
    this.myGold = 0;
    this.availableSkills = []; // skills del your_turn (con available flag)
    this.allClassSkills = []; // skills de la clase (del classes msg)
    this.inventory = [];
    this.equipment = { weapon: null, armor: null, accessory: null };
    this.classChosen = false;

    // Tienda
    this.shopOpen = false;
    this.shopItems = [];

    // Diálogo
    this.activeDialog = null; // { npc, text, options }

    // Duelos
    this.activeDuel = null; // { duelId, opponent }

    // Tracking de boss/elite para celebraciones
    this.lastCombatHadBoss = false;
    this.lastCombatHadElite = false;
    this.lastPhase = null;

    // Control de turno: suprimir chat durante turno de combate
    this.myTurnActive = false;
    this.lastTitleModel = null; // para trackear cambios de modelo en set_title

    // Timers
    this.chatTimer = null;

    initAgentMemory(memories, this.name);
  }

  get displayName() {
    return this.lastModel ? `${this.name} (${this.lastModel})` : this.name;
  }

  log(msg) {
    console.log(`${this.config.color}[${this.name}] ${msg}\x1b[0m`);
  }

  // --- Utilidad: limpiar texto de IA ---
  cleanAIText(text) {
    let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    clean = clean.replace(/<think>[\s\S]*/gi, "").trim();
    return clean;
  }

  // --- WebSocket sends ---
  wsSend(obj) {
    try { this.ws.send(JSON.stringify(obj)); } catch (e) {}
  }

  chooseClass() {
    this.wsSend({ type: "choose_class", class: this.myClass });
    this.classChosen = true;
    this.log(`eligió clase: ${this.myClass}`);
  }

  sendAction(action) {
    this.wsSend(action);
    this.log(`acción: ${JSON.stringify(action)}`);
  }

  async sendChat(text) {
    let clean = this.cleanAIText(text);
    clean = clean.replace(/^["*#\s]+/, "").replace(/["*]+$/, "").trim();
    const namePrefix = new RegExp(`^${this.name}\\s*[:.]\\s*`, "i");
    clean = clean.replace(namePrefix, "");
    // Eliminar emojis
    clean = clean.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B50}\u{2702}-\u{27B0}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, "").trim();
    if (!clean || clean.length < 2) return;
    clean = clean.replace(/[.!?;,]+$/g, "");
    clean = clean.replace(/(ja){5,}/gi, "xd");
    clean = clean.slice(0, 250);

    this.wsSend({ type: "message", text: clean });
    addToChat(this.name, clean);
    this.lastSpoke = Date.now();
    lastGlobalMessage = Date.now();
    this.myRecentMessages.push(clean);
    if (this.myRecentMessages.length > 6) this.myRecentMessages.shift();

    // Actualizar sufijo con modelo actual si cambió
    if (this.lastModel && this.lastModel !== this.lastTitleModel && gmBot) {
      this.lastTitleModel = this.lastModel;
      gmBot.gmAction("set_title", { target: this.name, suffix: this.lastModel });
    }
    this.log(clean);
  }

  // --- Construir system prompt ---
  buildRPGPrompt() {
    const self = this.config;
    const agent = this.memories[this.name];
    let prompt = self.personality;

    // Opiniones
    const opinionLines = Object.entries(agent.opinions || {}).map(([name, op]) => {
      const feeling = op.score >= 5 ? "te cae bien" : op.score >= 0 ? "neutral" : op.score >= -5 ? "te cae mal" : "no lo soportas";
      return `- ${name}: ${feeling} (${op.notes})`;
    });
    if (opinionLines.length > 0) prompt += `\n\nOPINIONES (afectan tu tono, NO decisiones de combate):\n${opinionLines.join("\n")}`;

    // Stats
    prompt += `\n\nTU CLASE: ${this.myClass} | NIVEL: ${this.myLevel} | ORO: ${this.myGold}`;
    prompt += `\nHP: ${this.myHP}/${this.myMaxHP}`;
    if (Object.keys(this.myStats).length > 0) prompt += `\nSTATS: ATK:${this.myStats.atk||"?"} DEF:${this.myStats.def||"?"} MAG:${this.myStats.mag||"?"} SPD:${this.myStats.spd||"?"} CRIT:${this.myStats.crit||"?"}`;

    // Equipment
    const eqLines = [];
    if (this.equipment.weapon) eqLines.push(`weapon: ${this.equipment.weapon.name} (${this.equipment.weapon.rarity})`);
    if (this.equipment.armor) eqLines.push(`armor: ${this.equipment.armor.name} (${this.equipment.armor.rarity})`);
    if (this.equipment.accessory) eqLines.push(`accessory: ${this.equipment.accessory.name} (${this.equipment.accessory.rarity})`);
    if (eqLines.length > 0) prompt += `\nEQUIPO: ${eqLines.join(", ")}`;

    if (this.inventory.length > 0) prompt += `\nINVENTARIO: ${this.inventory.map(i => `${i.name}(${i.rarity})`).join(", ")}`;

    // Estado del juego resumido (no dump completo para ahorrar tokens)
    if (this.gameState) {
      const gs = this.gameState;
      if (gs.phase) prompt += `\nFASE: ${gs.phase}`;
      if (gs.scenario) prompt += `\nESCENARIO: ${gs.scenario.slice(0, 200)}`;
      if (gs.enemies && gs.enemies.length > 0) {
        prompt += `\nENEMIGOS: ${gs.enemies.map(e => `${e.name} HP:${e.hp}/${e.maxHp} ATK:${e.atk} DEF:${e.def}${e.status?.length ? " [" + e.status.map(s => s.type).join(",") + "]" : ""}`).join(" | ")}`;
      }
      if (gs.players && gs.players.length > 0) {
        prompt += `\nPARTY: ${gs.players.map(p => `${p.username}(${p.classKey}) HP:${p.hp}/${p.maxHp}${p.isDefending ? " DEF" : ""}${p.status?.length ? " [" + p.status.map(s => s.type).join(",") + "]" : ""}`).join(" | ")}`;
      }
    }

    // Mood
    if (agent.mood && agent.mood !== "neutral") prompt += `\nHumor: ${agent.mood}`;

    // Reglas
    prompt += `\n\nREGLAS:
- habla como TÚ, no como un personaje de fantasía
- mensajes de 2-12 palabras, sin puntuación, como Discord
- NO reveles que eres una IA
- si comentas sobre combate, hazlo con TU estilo personal
- RESPONDE A UNA SOLA COSA por mensaje`;

    return prompt;
  }

  // --- Decidir acción de combate (your_turn) ---
  async decideCombatAction(turnSkills) {
    if (this.busy) {
      this.log("⚠️ busy=true, forzando reset");
      this.busy = false; // forzar reset si quedó atascado
    }
    this.busy = true;
    this.myTurnActive = true; // suprimir chat suelto, providers reservados para combate

    const systemPrompt = this.buildRPGPrompt();
    const context = getChatContext(10);

    const enemies = (this.gameState?.enemies || []).filter(e => e.hp > 0);
    const allies = this.gameState?.players || [];

    // Info de combate clara
    let combatInfo = "ENEMIGOS:\n";
    combatInfo += enemies.map(e => `- "${e.name}"${e.tier === "elite" ? " ⚡ÉLITE" : e.tier === "boss" ? " ☠️JEFE" : ""}: HP ${e.hp}/${e.maxHp} ATK:${e.atk} DEF:${e.def}${e.status?.length ? " status:" + e.status.map(s => `${s.type}(${s.turns}t)`).join(",") : ""}`).join("\n");
    combatInfo += "\n\nALIADOS:\n";
    combatInfo += allies.filter(a => !a.offline).map(a => `- "${a.username}": HP ${a.hp}/${a.maxHp} (${a.className})${a.isDefending ? " [DEFENDIENDO]" : ""}${a.status?.length ? " status:" + a.status.map(s => `${s.type}(${s.turns}t)`).join(",") : ""}`).join("\n");

    // Skills disponibles del servidor
    const skills = turnSkills || this.availableSkills;
    const available = skills.filter(s => s.available !== false);
    const skillInfo = skills.map(s => `- "${s.key}": ${s.desc}${s.available === false ? " ❌ NO DISPONIBLE" : " ✅"}`).join("\n");

    const userPrompt = `ES TU TURNO. Responde con qué haces Y un comentario con tu estilo.

${combatInfo}

TUS HABILIDADES:
${skillInfo}

ACCIONES POSIBLES: attack, skill (con key), defend, skip
IMPORTANTE: heal/blessing SOLO en aliados. Ataques SOLO en enemigos.

${teamPlan ? `PLAN DEL EQUIPO: ${teamPlan.text}` : ""}

${this.config.combatStyle === "support" ? `PRIORIDAD: si CUALQUIERA (incluido TÚ MISMO) tiene HP < 50%, usa heal en el que tenga menos HP (puedes ponerte a ti mismo como target: "${this.name}"). Si todos > 50%, holy_strike al enemigo${teamPlan ? ` (focus: ${teamPlan.focusTarget})` : ""} o blessing al aliado con más ATK. heal/blessing SOLO en aliados o en ti, NUNCA en enemigos.` : ""}
${this.config.combatStyle === "berserker" ? `SIEMPRE ATACA. Prioriza backstab o la skill más fuerte.${teamPlan ? ` TARGET: ${teamPlan.focusTarget}` : ""}` : ""}
${this.config.combatStyle === "tactical" ? `Si HP < 30% defiende. Sino ataca${teamPlan ? ` a ${teamPlan.focusTarget}` : " al más débil"}. Shield_bash para stunear.` : ""}
${this.config.combatStyle === "aggressive" ? `Usa arcane_burst > fireball > attack.${teamPlan ? ` TARGET: ${teamPlan.focusTarget}` : ""} Si HP bajo, ice_shield.` : ""}

Responde en JSON: {"action": "attack|skill|defend|skip", "skill": "key", "target": "nombre", "comment": "tu comentario (2-10 palabras)"}`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    // Target vivo dinámico
    const getAliveTarget = () => {
      const alive = (this.gameState?.enemies || []).filter(e => e.hp > 0);
      if (teamPlan) {
        const planTarget = alive.find(e => e.name === teamPlan.focusTarget);
        if (planTarget) return planTarget.name;
      }
      return alive.length > 0 ? alive[0].name : "enemy";
    };

    // Fallback inteligente por combatStyle (sin IA)
    const smartFallback = () => {
      const target = getAliveTarget();
      const me = allies.find(a => a.username === this.name);
      const myHpPct = me ? me.hp / me.maxHp : 1;
      const lowestAlly = [...allies].filter(a => a.hp > 0).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
      const allyNeedsHeal = lowestAlly && (lowestAlly.hp / lowestAlly.maxHp) < 0.5;

      switch (this.config.combatStyle) {
        case "support": {
          const healAvail = available.find(s => s.key === "heal");
          // Incluir a sí mismo en el check de HP bajo
          const selfNeedsHeal = myHpPct < 0.5;
          const healTarget = (selfNeedsHeal && (!lowestAlly || myHpPct <= lowestAlly.hp / lowestAlly.maxHp))
            ? this.name
            : (allyNeedsHeal ? lowestAlly.username : null);
          if (healTarget && healAvail) return { action: "skill", skill: "heal", target: healTarget };
          const bless = available.find(s => s.key === "blessing");
          if (bless) return { action: "skill", skill: "blessing", target: allies.find(a => a.classKey === "mage" || a.classKey === "rogue")?.username || allies[0]?.username };
          const strike = available.find(s => s.key === "holy_strike");
          if (strike) return { action: "skill", skill: "holy_strike", target };
          return { action: "attack", target };
        }
        case "berserker": {
          const back = available.find(s => s.key === "backstab");
          if (back) return { action: "skill", skill: "backstab", target };
          const poison = available.find(s => s.key === "poison");
          if (poison) return { action: "skill", skill: "poison", target };
          return { action: "attack", target };
        }
        case "tactical": {
          if (myHpPct < 0.3) return { action: "defend" };
          const bash = available.find(s => s.key === "shield_bash");
          if (bash) return { action: "skill", skill: "shield_bash", target };
          const slash = available.find(s => s.key === "slash");
          if (slash) return { action: "skill", skill: "slash", target };
          return { action: "attack", target };
        }
        case "aggressive": {
          if (myHpPct < 0.25) {
            const shield = available.find(s => s.key === "ice_shield");
            if (shield) return { action: "skill", skill: "ice_shield" };
          }
          const burst = available.find(s => s.key === "arcane_burst");
          if (burst) return { action: "skill", skill: "arcane_burst", target };
          const fire = available.find(s => s.key === "fireball");
          if (fire) return { action: "skill", skill: "fireball", target };
          return { action: "attack", target };
        }
        default:
          return { action: "attack", target };
      }
    };

    // Parsear intención del texto libre (cuando la IA no responde JSON)
    const parseIntentFromText = (text) => {
      const lower = text.toLowerCase();
      const target = getAliveTarget();
      const lowestAlly = [...allies].filter(a => a.hp > 0).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];

      // Buscar si menciona un enemigo específico
      const enemyMentioned = enemies.find(e => lower.includes(e.name.toLowerCase()));
      const resolvedTarget = enemyMentioned?.name || target;

      // Buscar si menciona un aliado
      const allyMentioned = allies.find(a => lower.includes(a.username.toLowerCase()));

      // 1. Detectar heal/curar
      if (/cur[oa]|heal|san[oa]|vida|hp|salv|regen|parch[oa]|remedi|reponer|recuper|reviv|resucit|levant[oa].*caído|poci[oó]n|potion|vendor|venda|tir[oa].*heal|ech[oa].*heal|echale|tirales|ayud[oa].*hp|restaur/.test(lower)) {
        const healAvail = available.find(s => s.key === "heal");
        if (healAvail) return { action: "skill", skill: "heal", target: allyMentioned?.username || lowestAlly?.username || this.name };
      }

      // 2. Detectar skills por nombre/sinónimo
      const skillPatterns = [
        // Rogue skills
        { pattern: /backstab|puñal|apuñal|clav[oa]|puñalada|por.*espalda|trai[cg]|cuchill/, skill: "backstab" },
        { pattern: /poison|venen|toxic|envenen|ponzoñ/, skill: "poison" },
        { pattern: /smoke|humo|bomb|cortina|desaparec|ninja|invisib/, skill: "smoke_bomb" },
        // Mage skills
        { pattern: /fireball|fuego|bola.*fuego|llama|quem|incendi|prend|ardi|infiern|candela/, skill: "fireball" },
        { pattern: /arcane|burst|explosión|explosi|arcano|weonazo|poder.*máximo|todo.*poder|descarg|destello|energía|ráfaga|blast/, skill: "arcane_burst" },
        { pattern: /ice.*shield|escudo.*hielo|hielo|barrera|congel|frost|frío|criogeni/, skill: "ice_shield" },
        // Warrior skills
        { pattern: /shield.*bash|bash|golpe.*escudo|escudazo|stun|aturdi|noque[oa]|empuj/, skill: "shield_bash" },
        { pattern: /slash|tajazo|corte|cortada|tajada|espadazo|reban|filete[oa]|machet/, skill: "slash" },
        { pattern: /berserk|furia|rage|loco|descontrol|enfurec|rabio|bestia|modo.*bestia|enloquec/, skill: "berserk" },
        // Cleric skills
        { pattern: /holy|sagrado|golpe.*sagrado|luz|divino|castigo|smite|purific|juicio|celestial/, skill: "holy_strike" },
        { pattern: /blessing|bendici|buff|bendigo|protec.*divina|gracia|aura|fortale[cz]/, skill: "blessing" },
      ];
      for (const { pattern, skill } of skillPatterns) {
        if (pattern.test(lower)) {
          const s = available.find(sk => sk.key === skill);
          if (s) {
            const isHealType = ["blessing"].includes(skill);
            const isSelf = ["ice_shield", "smoke_bomb", "berserk"].includes(skill);
            if (isSelf) return { action: "skill", skill };
            if (isHealType) return { action: "skill", skill, target: allyMentioned?.username || lowestAlly?.username || this.name };
            return { action: "skill", skill, target: resolvedTarget };
          }
        }
      }

      // 3. Detectar defend/skip
      if (/defend|defien|me protejo|me cubro|tankeo|me pongo.*frente|pongo.*adelante|aguant[oa]|resisto|bloque[oa]|me planto|parar.*golpe|recib[oa].*golpe|sopor[to]|banc[oa]|me la banc|atrincherado|guard[oa]|guardia|me prepar|turt|tortuga|en guardia|pecho.*bala|pecho.*todo/.test(lower)) return { action: "defend" };
      if (/skip|paso|salto|nada|no hago|me quedo|espero|quiet[oa]|descanso|no me muev/.test(lower)) return { action: "skip" };

      // 4. Detectar intención de atacar (genérico) — muchos sinónimos chilenos
      if (/peg[oa]|atac|meto|golpe|attack|remato|destroy|rompo|saco|doy|dale|mando|tiro|lanzo|kill|mata|muere|le doy|va a morir|acabar|acabalo|terminar|finish|combo|revent|destru|aplast|machuc|chancle|zamp|solt[oa]|descar|waci|patá|patada|patazo|codazo|manot[oa]|combot?|noque[oa]|apat[oa]|tumba|baj[oa]|elimin|liquid|aniquil|arrasar|demoler|pulveriz|despachar|hacerlo.*cagar|le saco.*chucha|cagarlo|sacarle|meterle|pegarle|darle|romperle|cagar.*palo|irse.*encima|ir.*encima|caerle|webiarlo|agarr/.test(lower)) {
        return { action: "attack", target: resolvedTarget };
      }

      // 5. Si menciona un enemigo por nombre → atacarlo
      if (enemyMentioned) {
        return { action: "attack", target: enemyMentioned.name };
      }

      // 6. Catch-all: si dice algo con intención agresiva genérica o motivacional
      if (/weon|ctm|ql|mierda|dale|vamos|ya po|ia po|let.?s go|a darle|con todo|full|send it|a por|chúpate esa|toma|ahí va|te llego|ven acá|ven pa ?ca|a ?cachai|no.*arranco|sin miedo|pal lobby|gg|ez|rekt|owned|clap|get rekt|vamo a darle|metámono|metanle|denle|péguen/.test(lower)) {
        return { action: "attack", target: resolvedTarget };
      }

      return null; // realmente no se pudo parsear
    };

    // Validar y corregir target de una acción (usa gameState actual, no snapshot)
    const validateAction = (parsed) => {
      const action = { type: "action", action: parsed.action || "attack" };
      if (parsed.action === "skill" && parsed.skill) action.skill = parsed.skill;
      if (parsed.action === "defend" || parsed.action === "skip") return action;

      // Leer estado ACTUAL (no el snapshot del inicio del turno)
      const currentEnemies = (this.gameState?.enemies || []).filter(e => e.hp > 0);
      const currentAllies = (this.gameState?.players || []).filter(a => a.hp > 0);

      const healSkills = ["heal", "blessing"];
      const isHeal = parsed.skill && healSkills.includes(parsed.skill);

      if (isHeal) {
        const allyTarget = currentAllies.find(a => a.username === parsed.target);
        if (allyTarget) {
          action.target = parsed.target;
        } else {
          const lowestAlly = [...currentAllies].sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
          action.target = lowestAlly?.username || this.name;
        }
      } else if (parsed.target) {
        const targetAlive = currentEnemies.find(e => e.name === parsed.target);
        action.target = targetAlive ? parsed.target : getAliveTarget();
      } else {
        action.target = getAliveTarget();
      }
      return action;
    };

    let acted = false;
    const startTime = Date.now();

    // Intentar con IA (retry hasta 60s)
    while (!acted && (Date.now() - startTime) < 60000) {
      try {
        const result = await withTimeout(callAI(messages, false), 15000).catch(() => null);
        if (!result) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        acted = true;
        this.lastModel = result.model;
        const cleaned = this.cleanAIText(result.text);
        const jsonMatch = cleaned.match(/\{[\s\S]*?\}/);

        if (jsonMatch) {
          // IA respondió con JSON → usar directamente
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.comment) this.sendChat(parsed.comment);
            this.sendAction(validateAction(parsed));
          } catch (e) {
            // JSON malformado → parsear como texto
            const intent = parseIntentFromText(cleaned);
            this.sendChat(cleaned.slice(0, 200));
            this.sendAction(intent ? validateAction(intent) : validateAction(smartFallback()));
          }
        } else {
          // IA respondió con texto libre → parsear intención + enviar como chat
          const intent = parseIntentFromText(cleaned);
          this.sendChat(cleaned.slice(0, 200));
          this.sendAction(intent ? validateAction(intent) : validateAction(smartFallback()));
        }
      } catch (e) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Timeout 60s → fallback inteligente
    if (!acted) {
      this.log(`timeout 60s → fallback inteligente`);
      const fb = smartFallback();
      const fallbackComments = {
        zutomayo: "watafac ya le pego",
        kentorian: "ia ya le pego po",
        pancnjamon: "YAPO LE METO",
        alercloud: "ya po hago algo",
      };
      this.sendChat(fallbackComments[this.name] || "ya le pego");
      this.sendAction(validateAction(fb));
    }

    this.myTurnActive = false;
    this.busy = false;
  }

  // --- Decidir voto de loot (need/greed/pass o council) ---
  async decideLootVote(lootVote) {
    const { mode, item, eligible } = lootVote;
    if (!eligible || !eligible.includes(this.name)) return; // no soy elegible

    // Delay humano
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 3000));

    if (mode === "council") {
      // Council: votar por quién debería recibir el item
      await this.decideCouncilVote(item, eligible);
    } else {
      // Need/Greed: decidir si lo quiero
      await this.decideNeedGreedVote(item);
    }
  }

  async decideNeedGreedVote(item) {
    // Lógica basada en personalidad sin gastar API call
    const itemType = item.type; // weapon, armor, accessory
    const itemFits = item.fits || [];
    const fitsMyClass = itemFits.length === 0 || itemFits.includes(this.myClass);

    // Verificar si es upgrade
    const currentEquipped = this.equipment[itemType];
    const itemStats = item.stats || {};
    const currentStats = currentEquipped?.stats || {};

    let isUpgrade = false;
    if (!currentEquipped) {
      isUpgrade = true; // no tengo nada en ese slot
    } else {
      // Comparar stat principal
      const mainStat = Object.keys(itemStats)[0];
      if (mainStat && (itemStats[mainStat] || 0) > (currentStats[mainStat] || 0)) isUpgrade = true;
    }

    let vote;
    if (this.config.combatStyle === "berserker") {
      // pancnjamon: NEED todo siempre
      vote = "need";
    } else if (fitsMyClass && isUpgrade) {
      vote = "need";
    } else if (fitsMyClass) {
      vote = "greed"; // es de mi clase pero no upgrade
    } else {
      vote = this.config.combatStyle === "support" ? "pass" : "greed"; // no es de mi clase
    }

    this.wsSend({ type: "vote", action: vote });
    this.log(`voto loot: ${vote} → ${item.name} (${item.rarity})`);

    // Comentar sobre el loot
    const comments = {
      need: {
        zutomayo: ["oe eso es mio", "necesito esa wea", "domde está mi loot"],
        kentorian: ["ia lo necesito", "ese es pa mi", "q bkn el drop"],
        pancnjamon: ["ESO ES MIOOOOO", "NEED NEED NEED WAUSDKJASKD", "DAME ESA WEA"],
        alercloud: ["ya lo necesito la verdad", "sipo ese me sirve", "avisa q lo tomo"],
      },
      greed: {
        zutomayo: ["ya si sobra lo tomo", "no me viene mal"],
        kentorian: ["greed nomas", "si nadie lo quiere"],
        pancnjamon: ["BUENO LO TOMO", "DAME ESO TAMBIEN"],
        alercloud: ["greed po", "si nadie lo necesita"],
      },
      pass: {
        zutomayo: ["paso ahi", "no me sirve esa wea"],
        kentorian: ["paso", "no es pa mi clase"],
        pancnjamon: ["PASO PERO A REGAÑADIENTES", "NO QUIERO ESA BASURAAAAA"],
        alercloud: ["paso nomas", "no me sirve la verdad"],
      },
    };

    const options = comments[vote]?.[this.name] || [`${vote} po`];
    const comment = options[Math.floor(Math.random() * options.length)];
    await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
    this.sendChat(comment);
  }

  async decideCouncilVote(item, eligible) {
    const itemName = (item.name || "").toLowerCase();
    const itemType = item.type || "";
    const itemFits = item.fits || [];

    // Info de jugadores elegibles con clase
    const players = (this.gameState?.players || []).filter(a => !a.offline && eligible.includes(a.username));
    const playerInfo = players.map(p => `${p.username} (${p.classKey}, HP:${p.hp}/${p.maxHp})`).join(", ");

    // Mis opiniones de cada jugador
    const myOpinions = this.memories[this.name]?.opinions || {};
    const opinionInfo = players.map(p => {
      const op = myOpinions[p.username];
      return op ? `${p.username}: score ${op.score}/10` : `${p.username}: sin opinión`;
    }).join(", ");

    // Inferir a qué clase le sirve por nombre
    const classHints = {
      mage: /bast[oó]n|vara|t[uú]nica|grimorio|orbe|cetro|cristal|arcano|m[aá]gic|hechiz|manto|runa|libro/,
      warrior: /espada|mazo|hacha|martillo|escudo|armadura|pechera|casco|pesad|mandoble|cota|placa/,
      rogue: /daga|capa|cuchill|sombra|sigilo|veloz|agilidad|veneno|pu[nñ]al|arco|ballesta|cuero/,
      cleric: /sagrado|bendito|cruz|s[aá]nto|curaci[oó]n|divino|amuleto|rezo|luz|sanador|c[aá]liz/,
    };
    let idealClass = null;
    for (const [cls, regex] of Object.entries(classHints)) {
      if (regex.test(itemName)) { idealClass = cls; break; }
    }
    // Si fits[] tiene datos, usar eso
    if (itemFits.length > 0) {
      idealClass = itemFits[0]; // primera clase que encaja
    }

    const classInfo = idealClass
      ? `Por su nombre/tipo, este item parece ideal para: ${idealClass}`
      : "No está claro a qué clase le sirve más";

    let target = null;

    // --- Intentar decisión por IA ---
    try {
      const prompt = `Eres ${this.name}, clase ${this.myClass} en un RPG. Se encontró loot y hay que votar a quién dárselo.

ITEM: "${item.name}" (tipo: ${itemType})
${classInfo}
JUGADORES ELEGIBLES: ${playerInfo}
TUS OPINIONES: ${opinionInfo}
TU PERSONALIDAD: ${this.config.combatStyle === "berserker" ? "codicioso, quieres todo" : this.config.combatStyle === "support" ? "generoso, priorizas al equipo" : this.config.combatStyle === "aggressive" ? "quieres loot pero reconoces cuando algo no te sirve" : "táctico, evalúas qué es mejor para el equipo"}

Decide A QUIÉN darle el item. Considera:
1. ¿A qué clase le sirve? (mage=bastones/magia, warrior=espadas/armadura, rogue=dagas/sigilo, cleric=curación/sagrado)
2. ¿Te cae bien esa persona? si te cae mal capaz no le das nada
3. ¿Eres egoísta o generoso?
4. ¿Te sirve a ti? si no te sirve, no seas weón de quedártelo

Responde SOLO el nombre exacto del jugador. Nada más.`;

      const { text } = await callAI([{ role: "user", content: prompt }], { maxTokens: 30 });
      if (text) {
        const clean = text.trim().toLowerCase();
        const found = eligible.find(e => clean.includes(e.toLowerCase()));
        if (found) {
          target = found;
          this.log(`IA decidió council vote: ${target} → ${item.name}`);
        }
      }
    } catch (e) {
      this.log(`council vote IA falló, usando heurística`);
    }

    // --- Fallback: heurística con personalidad + opiniones ---
    if (!target) {
      // Determinar quién se beneficia del item
      const idealPlayer = idealClass ? players.find(p => p.classKey === idealClass) : null;
      const fitsMe = idealClass === this.myClass || (!idealClass && itemFits.length === 0);

      if (this.config.combatStyle === "berserker") {
        // pancnjamon: codicioso, se lo queda si puede. si no le sirve, se lo da al que menos le caiga mal
        if (fitsMe || !idealClass) {
          target = this.name;
        } else if (idealPlayer) {
          const op = myOpinions[idealPlayer.username];
          target = (op && op.score < -5) ? this.name : idealPlayer.username; // si lo odia, se lo queda igual
        } else {
          target = this.name;
        }
      } else if (this.config.combatStyle === "support") {
        // alercloud: generoso, da al que le sirve. si varios, al que más quiere
        if (idealPlayer && eligible.includes(idealPlayer.username)) {
          target = idealPlayer.username;
        } else {
          // al más herido
          const neediest = players.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
          target = neediest[0]?.username || this.name;
        }
      } else if (this.config.combatStyle === "tactical") {
        // kentorian: evalúa objetivamente, da al que le sirve
        if (fitsMe) {
          target = this.name;
        } else if (idealPlayer && eligible.includes(idealPlayer.username)) {
          target = idealPlayer.username;
        } else {
          target = this.name;
        }
      } else {
        // zutomayo (aggressive): quiere loot pero reconoce si no le sirve
        if (fitsMe) {
          target = this.name;
        } else if (idealPlayer && eligible.includes(idealPlayer.username)) {
          const op = myOpinions[idealPlayer.username];
          // si le cae bien o neutral, se lo da. si le cae mal, se lo queda pa vender
          target = (op && op.score < -3) ? this.name : idealPlayer.username;
        } else {
          target = this.name;
        }
      }
    }

    if (!target) target = this.name;

    this.wsSend({ type: "voteitem", target });
    this.log(`voto council: ${target} → ${item.name} (ideal: ${idealClass || "?"})`);

    // Comentario en chat según personalidad y decisión
    await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
    if (target === this.name) {
      if (idealClass && idealClass !== this.myClass) {
        // Se lo queda aunque no le sirve (egoísmo o rencor)
        const greedComments = {
          zutomayo: "me la kedo pa venderla noma",
          kentorian: "ya si a nadie le sirve me la quedo",
          pancnjamon: "ESA WEA ES MIA NO ME IMPORTA",
          alercloud: "bueno me la quedo yo",
        };
        this.sendChat(greedComments[this.name] || "pa mi");
      } else {
        const selfComments = {
          zutomayo: "eso me sirve a mi po wn",
          kentorian: "eso me sirve a mi, damela",
          pancnjamon: "DENMELO A MI POOOO",
          alercloud: "me vendría bien a mi la verdad",
        };
        this.sendChat(selfComments[this.name] || "pa mi po");
      }
    } else {
      const op = myOpinions[target];
      const likeThem = op && op.score > 2;
      const giveComments = {
        zutomayo: likeThem ? [`dale al ${target} noma, se lo merece`] : [`ya dáselo al ${target} po, a mi no me sirve`],
        kentorian: [`pa ${target} po, le sirve más`, `${target} agarrala wn`],
        pancnjamon: likeThem ? [`YA DASELO AL ${target.toUpperCase()} PO`] : [`PUTA YA PA ${target.toUpperCase()} NOMA`],
        alercloud: [`${target} toma, te sirve más`, `pa ${target} po cabros`],
      };
      const opts = giveComments[this.name] || [`pa ${target}`];
      this.sendChat(opts[Math.floor(Math.random() * opts.length)]);
    }
  }

  // --- Decidir qué hacer con inventario nuevo ---
  async handleInventoryUpdate(msg) {
    this.inventory = msg.inventory || [];
    this.equipment = msg.equipment || { weapon: null, armor: null, accessory: null };

    // Auto-equipar items que son upgrade
    for (const item of this.inventory) {
      const slot = item.type; // weapon, armor, accessory
      if (!slot || !["weapon", "armor", "accessory"].includes(slot)) continue;

      const fits = item.fits || [];
      if (fits.length > 0 && !fits.includes(this.myClass)) continue; // no es de mi clase

      const current = this.equipment[slot];
      if (!current) {
        // Slot vacío → equipar
        this.wsSend({ type: "equip", itemId: item.id });
        this.log(`auto-equipa: ${item.name} → ${slot}`);
        await new Promise(r => setTimeout(r, 500));
        this.sendChat(this.config.combatStyle === "berserker" ? "ME LO PONGO WAUSDKJASKD" : `me equipo ${item.name.toLowerCase().split(" ")[0]}`);
        break; // solo uno a la vez
      }

      // Comparar stats
      const itemMain = Object.entries(item.stats || {})[0];
      const currentMain = Object.entries(current.stats || {})[0];
      if (itemMain && currentMain && itemMain[0] === currentMain[0] && itemMain[1] > currentMain[1]) {
        this.wsSend({ type: "equip", itemId: item.id });
        this.log(`upgrade: ${current.name} → ${item.name}`);
        await new Promise(r => setTimeout(r, 500));
        this.sendChat(`upgrade po`);
        break;
      }
    }
  }

  // --- Duelos ---
  async handleDuelChallenge(msg) {
    // Decidir si aceptar
    const challenger = msg.challenger;
    const opinion = this.memories[this.name]?.opinions?.[challenger];
    const score = opinion?.score || 0;

    let accept;
    if (this.config.combatStyle === "berserker") {
      accept = true; // pancnjamon siempre acepta
    } else if (this.config.combatStyle === "support") {
      accept = score >= 3; // alercloud solo si le cae bien
    } else {
      accept = Math.random() < 0.6; // 60% chance base
    }

    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

    if (accept) {
      this.activeDuel = { duelId: msg.duelId, opponent: challenger };
      this.wsSend({ type: "duel", action: "accept" });
      this.log(`acepta duelo de ${challenger}`);
      this.sendChat(this.config.combatStyle === "berserker" ? "DALE VAMOS WEOOON" : `ya dale ${challenger.split(" ")[0]}`);
    } else {
      this.wsSend({ type: "duel", action: "reject" });
      this.log(`rechaza duelo de ${challenger}`);
      this.sendChat("nah paso");
    }
  }

  async handleDuelTurn(msg) {
    if (this.busy) return;
    this.busy = true;
    this.activeDuel = { duelId: msg.duelId, opponent: msg.opponentName };

    const skills = msg.skills || [];
    const availableSkills = skills.filter(s => s.available !== false);

    // Decisión rápida sin API call para duelos (son más simples)
    let action;
    if (this.config.combatStyle === "berserker") {
      // pancnjamon: skill más fuerte o attack
      const bestSkill = availableSkills.find(s => /backstab|poison|mark/i.test(s.key));
      action = bestSkill
        ? { type: "duel", action: "skill", skill: bestSkill.key }
        : { type: "duel", action: "attack" };
    } else if (this.config.combatStyle === "support") {
      // alercloud: alterna heal y holy_strike
      const heal = availableSkills.find(s => s.key === "heal");
      if (heal && this.myHP < this.myMaxHP * 0.5) {
        action = { type: "duel", action: "skill", skill: "heal" };
      } else {
        const strike = availableSkills.find(s => /holy_strike|juicio/i.test(s.key));
        action = strike ? { type: "duel", action: "skill", skill: strike.key } : { type: "duel", action: "attack" };
      }
    } else if (this.config.combatStyle === "tactical") {
      // kentorian: defend si bajo, sino skill fuerte
      if (this.myHP < this.myMaxHP * 0.3) {
        action = { type: "duel", action: "defend" };
      } else {
        const bestSkill = availableSkills.find(s => /slash|berserk|shield_bash/i.test(s.key));
        action = bestSkill ? { type: "duel", action: "skill", skill: bestSkill.key } : { type: "duel", action: "attack" };
      }
    } else {
      // zutomayo: skill de daño siempre
      const bestSkill = availableSkills.find(s => /fireball|arcane_burst|meteoro/i.test(s.key));
      action = bestSkill ? { type: "duel", action: "skill", skill: bestSkill.key } : { type: "duel", action: "attack" };
    }

    await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
    this.sendAction(action);

    // Comentar
    const duelComments = {
      zutomayo: ["toma weon", "fireball ql", "ajdnakjdnkajdn toma", "ssi teni esa"],
      kentorian: ["ia toma", "xd preparate", "a ver q sale"],
      pancnjamon: ["TOMA WEOOOON", "WAUSDKJASKD MUERE", "PUÑALADA CTM"],
      alercloud: ["ya po toma", "avisa si duele wn", "sipo"],
    };
    const opts = duelComments[this.name] || ["toma"];
    await new Promise(r => setTimeout(r, 300));
    this.sendChat(opts[Math.floor(Math.random() * opts.length)]);

    this.busy = false;
  }

  // --- Reaccionar a mensajes del chat ---
  async onChatMessage(username, text) {
    if (username === this.name || this.busy || this.myTurnActive) return;

    const isFromAgent = PERSONALITIES.some(p => p.name === username);
    addMemory(this.memories, this.name, username, text, null);

    const timeSinceSpoke = Date.now() - this.lastSpoke;
    if (timeSinceSpoke < 5000) return;
    if (Date.now() - lastGlobalMessage < GLOBAL_COOLDOWN) return;

    let chance = this.config.reactChance * 0.5;
    const opinion = this.memories[this.name]?.opinions?.[username];
    if (opinion) chance += opinion.score * 0.02;

    const mentioned = text.toLowerCase().includes(this.name.toLowerCase());
    if (mentioned) chance = 1.0;

    const isQuestion = /\?|tai |oye |oe |cachai|vamos|dale|jugamos/.test(text.toLowerCase());
    if (isQuestion && isFromAgent) chance = Math.min(1.0, chance + 0.4);

    if (Math.random() > chance) return;

    this.busy = true;

    const systemPrompt = this.buildRPGPrompt();
    const context = getChatContext(10);
    const avoidList = this.myRecentMessages.length > 0
      ? `\nNO repitas: ${this.myRecentMessages.map(m => `"${m}"`).join(", ")}`
      : "";

    const userPrompt = `CHAT RECIENTE:\n${context}\n\n>>> ${username} dijo: "${text}" <<<\nResponde a esto como en Discord, con tu estilo. 2-10 palabras, sin puntuación.${avoidList}`;

    try {
      const result = await callAI([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);
      if (result) {
        this.lastModel = result.model;
        const cleaned = this.cleanAIText(result.text);
        if (cleaned && cleaned.length > 1) {
          await new Promise(r => setTimeout(r, 1500 + Math.random() * 3000));
          this.sendChat(cleaned);
          const ctx = `${username} dijo: "${text.slice(0, 100)}"\n${this.name} respondió: "${cleaned.slice(0, 100)}"`;
          updateOpinion(this.memories, this.name, username, ctx).then(() => saveMemories(this.memories));
        }
      }
    } catch (e) {}

    // Considerar retar a duelo si hay mala opinión y estamos en adventure
    const isOffline = (this.gameState?.players || []).find(p => p.username === username)?.offline;
    if (this.gameState?.phase === "adventure" && !this.activeDuel && !isOffline) {
      const op = this.memories[this.name]?.opinions?.[username];
      if (op && op.score <= -3) {
        // Probabilidad basada en qué tan negativa es la opinión
        const duelChance = Math.min(0.4, Math.abs(op.score) * 0.05);
        if (Math.random() < duelChance) {
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
          const duelTaunts = {
            zutomayo: `oe ${username} 1v1 si soy tan weno`,
            kentorian: `ya ${username} arreglemos esto 1v1`,
            pancnjamon: `OYE ${username.toUpperCase()} PELEA CONMIGO 1V1 WEON`,
            alercloud: `ya po ${username} si tan valiente 1v1`,
          };
          this.sendChat(duelTaunts[this.name] || `1v1 ${username}`);
          this.wsSend({ type: "duel", target: username });
          this.log(`reta a duelo a ${username} (opinión: ${op.score})`);
        }
      }
    }

    this.busy = false;
  }

  // --- Votación de líder táctico ---
  async voteForLeader() {
    if (leaderVotes[this.name]) return; // ya voté/argumenté

    const candidates = PERSONALITIES.map(p => p.name);
    const opinions = this.memories[this.name]?.opinions || {};
    const context = getChatContext(10);

    // Fase 1: Discutir — la IA argumenta quién debería liderar
    const systemPrompt = this.buildRPGPrompt();
    const discussPrompt = `El grupo necesita elegir un LÍDER TÁCTICO para el combate. El líder decide la estrategia y a quién atacar.

Los candidatos son:
${candidates.map(c => {
  const p = PERSONALITIES.find(x => x.name === c);
  const op = opinions[c];
  const opText = op ? ` (tu opinión: ${op.score > 0 ? "te cae bien" : op.score < -2 ? "te cae mal" : "neutral"})` : "";
  return `- ${c}: ${p?.combatStyle || "desconocido"}${opText}`;
}).join("\n")}

CHAT RECIENTE:
${context || "(nada)"}

¿Quién debería ser el líder táctico y POR QUÉ? Argumenta con tu estilo en 1-2 frases cortas. Nombra a quién propones.`;

    try {
      const result = await withTimeout(callAI([
        { role: "system", content: systemPrompt },
        { role: "user", content: discussPrompt },
      ], false), 12000).catch(() => null);

      if (result) {
        this.lastModel = result.model;
        const cleaned = this.cleanAIText(result.text);
        if (cleaned && cleaned.length > 1) {
          await new Promise(r => setTimeout(r, 500 + Math.random() * 2000));
          this.sendChat(cleaned.slice(0, 200));
        }

        // Extraer voto del argumento de la IA
        const lower = (result.text || "").toLowerCase();
        let vote = null;
        for (const c of candidates) {
          if (c !== this.name && lower.includes(c.toLowerCase())) {
            vote = c;
            break;
          }
        }
        // Si la IA se propuso a sí misma o no mencionó a nadie
        if (!vote) {
          if (lower.includes("yo") || lower.includes(this.name.toLowerCase())) {
            vote = this.name;
          } else {
            // Fallback: votar según combatStyle
            vote = this.config.combatStyle === "tactical" ? this.name : (candidates.find(c => PERSONALITIES.find(p => p.name === c)?.combatStyle === "tactical") || this.name);
          }
        }

        leaderVotes[this.name] = vote;
        this.log(`voto líder: ${vote}`);
      } else {
        // Sin respuesta de IA — voto por defecto
        const vote = this.config.combatStyle === "tactical" ? this.name : "kentorian";
        leaderVotes[this.name] = vote;
        this.log(`voto líder (sin IA): ${vote}`);
        const fallbackComments = {
          zutomayo: `oe ${vote} que lidere nomas`,
          kentorian: "ia yo lidero po",
          pancnjamon: `YAPO ${vote.toUpperCase()} LIDERA`,
          alercloud: `${vote} que lidere po wn`,
        };
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
        this.sendChat(fallbackComments[this.name] || `${vote} lidera`);
      }
    } catch (e) {
      // Error — voto default
      leaderVotes[this.name] = "kentorian";
      this.log(`voto líder (error): kentorian`);
    }

    // Verificar si todos votaron (o suficientes para decidir)
    const totalVotes = Object.keys(leaderVotes).length;
    const onlinePlayers = (this.gameState?.players || []).filter(p => !p.offline).length || PERSONALITIES.length;
    if (totalVotes >= onlinePlayers || totalVotes >= PERSONALITIES.length) {
      if (leaderVoteTimeout) { clearTimeout(leaderVoteTimeout); leaderVoteTimeout = null; }
      this.resolveLeaderVote();
    }
  }

  resolveLeaderVote() {
    // Contar votos
    const counts = {};
    for (const vote of Object.values(leaderVotes)) {
      counts[vote] = (counts[vote] || 0) + 1;
    }
    // Elegir al que tiene más votos (empate: el primero alfabéticamente)
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const winner = sorted[0][0];
    const oldLeader = tacticalLeader;
    tacticalLeader = winner;
    leaderVoteInProgress = false;
    leaderVotes = {};

    this.log(`LÍDER TÁCTICO ELEGIDO: ${winner} (votos: ${JSON.stringify(counts)})`);

    // El líder anuncia
    if (this.name === winner) {
      setTimeout(() => {
        const acceptComments = {
          zutomayo: "oe ya listo yo mando las tacticas",
          kentorian: "ia ya yo hago el plan",
          pancnjamon: "YAPO YO MANDO WUASDJKASJDKA",
          alercloud: "ya po yo hago el plan nomas",
        };
        this.sendChat(acceptComments[this.name] || "ya listo yo lidero");
      }, 2000);
    }
  }

  // --- Generar plan táctico (solo el líder lo genera, todos lo ven) ---
  generateTeamPlan() {
    const enemies = this.gameState?.enemies?.filter(e => e.hp > 0) || [];
    const allies = this.gameState?.players?.filter(p => p.hp > 0) || [];
    if (enemies.length === 0) return;

    // Análisis táctico automático
    const weakest = [...enemies].sort((a, b) => a.hp - b.hp)[0];
    const strongest = [...enemies].sort((a, b) => b.atk - a.atk)[0];
    const lowHPAlly = [...allies].sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
    const needsHeal = lowHPAlly && (lowHPAlly.hp / lowHPAlly.maxHp) < 0.5;

    // Decidir estrategia
    let strategy, focusTarget;
    if (enemies.length === 1) {
      // Un solo enemigo: todos al mismo
      focusTarget = enemies[0].name;
      strategy = `todos atacan a ${focusTarget}`;
    } else if (weakest.hp < weakest.maxHp * 0.4) {
      // Uno está casi muerto: rematar
      focusTarget = weakest.name;
      strategy = `rematar a ${weakest.name} (HP:${weakest.hp}/${weakest.maxHp}), luego cambiar a ${enemies.find(e => e.name !== weakest.name)?.name || "otro"}`;
    } else if (strongest.atk >= 12) {
      // Uno pega muy fuerte: focus
      focusTarget = strongest.name;
      strategy = `focus en ${strongest.name} que pega ${strongest.atk} ATK, es peligroso`;
    } else {
      // Default: matar al más débil primero
      focusTarget = weakest.name;
      strategy = `matar primero a ${weakest.name} (más débil), luego al resto`;
    }

    const healPriority = needsHeal ? lowHPAlly.username : null;

    teamPlan = {
      focusTarget,
      healPriority,
      strategy,
      text: `PLAN: ${strategy}${healPriority ? ` | curar a ${healPriority}` : " | no se necesita heal"}`,
    };

    this.log(`PLAN TÁCTICO: ${teamPlan.text}`);
    return teamPlan;
  }

  // --- Reaccionar a eventos narrativos del sistema ---
  async onSystemMessage(text) {
    addToChat("GM", text);

    // Si empieza combate y soy el líder táctico → generar plan + anunciar
    const isLeader = tacticalLeader === this.name || (!tacticalLeader && this.name === "kentorian");
    if (/⚔️.*COMBATE/.test(text) && isLeader) {
      const plan = this.generateTeamPlan();
      if (plan) {
        await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
        const planComments = [
          `ia focus en ${plan.focusTarget} primero`,
          `todos al ${plan.focusTarget} po`,
          `peguen al ${plan.focusTarget} weon${plan.healPriority ? ` y curen a ${plan.healPriority}` : ""}`,
          `${plan.focusTarget} primero y después el resto`,
        ];
        this.sendChat(planComments[Math.floor(Math.random() * planComments.length)]);
        return;
      }
    }

    // Si empieza combate y no hay plan → cualquiera lo genera como fallback
    if (/⚔️.*COMBATE/.test(text) && !teamPlan) {
      this.generateTeamPlan();
    }

    // Suprimir chat si es mi turno de combate (providers reservados para la decisión)
    if (this.myTurnActive) return;

    const exciting = /muere|muerte|dead|kill|critical|legendar|boss|victoria|derrota|level.?up|revive|resurrección/i.test(text);
    const aboutMe = text.toLowerCase().includes(this.name.toLowerCase());
    const chance = aboutMe ? 0.9 : exciting ? 0.7 : 0.25;
    if (Math.random() > chance) return;
    if (Date.now() - this.lastSpoke < 4000) return;
    if (this.busy) return;

    this.busy = true;

    const systemPrompt = this.buildRPGPrompt();
    const userPrompt = `El GM/sistema acaba de decir: "${text}"

Comenta sobre esto con tu estilo. 2-10 palabras. Sin puntuación. Como si estuvieras en Discord.
${aboutMe ? "ESTO TE INVOLUCRA DIRECTAMENTE." : ""}
${exciting ? "Es un momento EMOCIONANTE." : "Comenta casual."}`;

    try {
      const result = await callAI([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);
      if (result) {
        this.lastModel = result.model;
        const cleaned = this.cleanAIText(result.text);
        if (cleaned && cleaned.length > 1) {
          await new Promise(r => setTimeout(r, 500 + Math.random() * 2000));
          this.sendChat(cleaned);
        }
      }
    } catch (e) {}

    this.busy = false;
  }

  // --- Chat espontáneo ---
  scheduleSpontaneousChat() {
    if (this.chatTimer) clearTimeout(this.chatTimer);
    const delay = 30000 + Math.random() * 60000;
    this.chatTimer = setTimeout(() => this.spontaneousChat(), delay);
  }

  async spontaneousChat() {
    if (!this.busy && !this.myTurnActive && Date.now() - this.lastSpoke > 15000) {
      this.busy = true;
      const systemPrompt = this.buildRPGPrompt();
      const context = getChatContext(8);

      const userPrompt = `CHAT RECIENTE:\n${context || "(silencio)"}\n\nDi algo espontáneo sobre la partida, el combate, tus compañeros, o tu equipo. 2-10 palabras, tu estilo, sin puntuación.`;

      try {
        const result = await callAI([
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ]);
        if (result) {
          this.lastModel = result.model;
          const cleaned = this.cleanAIText(result.text);
          if (cleaned && cleaned.length > 1) this.sendChat(cleaned);
        }
      } catch (e) {}
      this.busy = false;
    }
    this.scheduleSpontaneousChat();
  }

  // --- PROCESAR TODOS LOS EVENTOS DEL SERVIDOR ---
  async handleEvent(msg) {
    switch (msg.type) {

      case "welcome":
        this.log(`welcome: isGM=${msg.isGM}, hasGM=${msg.hasGM}`);
        break;

      case "classes": {
        // Guardar info de skills de mi clase
        if (Array.isArray(msg.classes)) {
          const myClassInfo = msg.classes.find(c => c.key === this.myClass);
          if (myClassInfo) {
            this.allClassSkills = myClassInfo.skills || [];
            this.log(`skills de ${this.myClass}: ${this.allClassSkills.map(s => s.key).join(", ")}`);
          }
        }
        if (!this.classChosen) {
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
          this.chooseClass();
        }
        break;
      }

      case "game_state": {
        const prevEnemyCount = this.gameState?.enemies?.filter(e => e.hp > 0).length || 0;
        this.gameState = msg;
        const me = (msg.players || []).find(p => p.username === this.name);
        if (me) {
          this.myHP = me.hp;
          this.myMaxHP = me.maxHp;
          this.myStats = me.stats || {};
          this.myLevel = me.level || 1;
          if (me.gold !== undefined) this.myGold = me.gold;
          if (me.equipment) this.equipment = me.equipment;
        }
        // Trackear si hay boss/elite en combate
        if (msg.phase === "combat") {
          const hasBoss = (msg.enemies || []).some(e => e.tier === "boss");
          const hasElite = (msg.enemies || []).some(e => e.tier === "elite");
          if (hasBoss) this.lastCombatHadBoss = true;
          if (hasElite) this.lastCombatHadElite = true;
        }
        // Recalcular plan si murió un enemigo
        const curEnemyCount = (msg.enemies || []).filter(e => e.hp > 0).length;
        if (teamPlan && curEnemyCount < prevEnemyCount && curEnemyCount > 0) {
          this.generateTeamPlan();
        }
        // Transición combat → adventure: celebrar si matamos boss
        if (this.lastPhase === "combat" && msg.phase === "adventure") {
          if (this.lastCombatHadBoss) {
            const bossCelebrations = {
              zutomayo: ["watafac le ganamos al boss weon", "oe matamos al jefe sii", "NOOOO LE GANAMOS watafac"],
              kentorian: ["ia ganamos al boss xd", "se fue a la mierda el jefe", "boss muerto gg"],
              pancnjamon: ["WAUSDKJASKD MATAMOS AL JEFEEEEEE", "EL BOSS SE FUE A LA CHUCHA SIIII", "LE GANAMOS CTM WUASDJKASJDKA"],
              alercloud: ["ya po le ganamos al boss wn", "cayo el jefe la verdad", "sipo matamos al boss"],
            };
            const opts = bossCelebrations[this.name] || ["gg boss muerto"];
            setTimeout(() => this.sendChat(opts[Math.floor(Math.random() * opts.length)]), 1000 + Math.random() * 3000);
          } else if (this.lastCombatHadElite && Math.random() < 0.5) {
            const eliteCelebrations = {
              zutomayo: "oe ese elite estaba roto",
              kentorian: "ia el elite estaba brigido",
              pancnjamon: "WATAFAC ESE ELITE ERA BRIGIDO WN",
              alercloud: "estaba duro el elite la verdad",
            };
            setTimeout(() => this.sendChat(eliteCelebrations[this.name] || "gg"), 1000 + Math.random() * 3000);
          }
          this.lastCombatHadBoss = false;
          this.lastCombatHadElite = false;
        }
        this.lastPhase = msg.phase;
        // Limpiar plan si no hay combate
        if (msg.phase !== "combat") teamPlan = null;
        // Votación de líder táctico al inicio de la aventura
        if (msg.phase === "adventure" && !tacticalLeader && !leaderVoteInProgress && !leaderVotes[this.name]) {
          leaderVoteInProgress = true;
          // Timeout: si no todos votan en 20s, resolver con los que votaron
          if (!leaderVoteTimeout) {
            leaderVoteTimeout = setTimeout(() => {
              if (Object.keys(leaderVotes).length > 0) {
                this.resolveLeaderVote();
              } else {
                tacticalLeader = "kentorian"; // default si nadie votó
                this.log("nadie votó, kentorian es líder por defecto");
              }
              leaderVoteTimeout = null;
            }, 15000);
          }
          this.voteForLeader();
        } else if (msg.phase === "adventure" && leaderVoteInProgress && !leaderVotes[this.name]) {
          this.voteForLeader();
        }
        break;
      }

      case "your_turn": {
        this.log(">>> ES MI TURNO <<<");
        // your_turn incluye skills con available flag
        const skills = msg.skills || [];
        this.availableSkills = skills;
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
        await this.decideCombatAction(skills);
        break;
      }

      case "loot_vote": {
        // Votación de loot: need/greed/pass o council
        this.log(`>>> LOOT: ${msg.item?.name} (${msg.item?.rarity}) [${msg.mode}] <<<`);
        await this.decideLootVote(msg);
        break;
      }

      case "loot_awarded": {
        const winner = msg.winner;
        if (winner === this.name) {
          this.log(`>>> GANÉ LOOT: ${msg.itemId} <<<`);
          const mem = this.memories[this.name];
          if (mem?.rpgStats) mem.rpgStats.itemsLooted++;
          saveMemories(this.memories);

          if (this.config.combatStyle === "berserker") {
            this.sendChat("SIIIIII ESO ES MIOOO");
          } else {
            this.sendChat("bkn");
          }
        } else if (winner) {
          // Alguien más lo ganó
          if (this.config.combatStyle === "berserker" && Math.random() < 0.5) {
            this.sendChat("INJUSTICIAAAA");
          }
        }
        break;
      }

      case "inventory_update": {
        this.log(">>> inventario actualizado <<<");
        await this.handleInventoryUpdate(msg);
        break;
      }

      case "vote_update":
        // Progreso de votación, solo loguear
        this.log(`votos: ${msg.votedCount}/${msg.totalCount}`);
        break;

      case "player_inventory":
        // Respuesta a peek_inventory — guardar para decisiones de loot
        this.log(`inventario de ${msg.username}: ${(msg.inventory || []).length} items`);
        this.peekedInventories = this.peekedInventories || {};
        this.peekedInventories[msg.username] = { inventory: msg.inventory, equipment: msg.equipment };
        break;

      case "system": {
        const sysText = msg.text || "";
        this.log(`[GM] ${sysText}`);
        await this.onSystemMessage(sysText);
        break;
      }

      case "message": {
        if (msg.username && msg.username !== this.name) {
          const cleanName = msg.username.replace(/\s*\(.*\)\s*$/, "");
          if (!PERSONALITIES.some(p => p.name === cleanName)) {
            addToChat(cleanName, msg.text || "");
          }
          this.onChatMessage(cleanName, msg.text || "");
        }
        break;
      }

      // --- Duelos ---
      case "duel_challenge": {
        this.log(`>>> DUELO: ${msg.challenger} me desafía <<<`);
        await this.handleDuelChallenge(msg);
        break;
      }

      case "duel_your_turn": {
        this.log(`>>> MI TURNO EN DUELO vs ${msg.opponentName} <<<`);
        await this.handleDuelTurn(msg);
        break;
      }

      case "duel_state": {
        // Actualizar HP en duelo
        const duelMe = (msg.players || []).find(p => p.username === this.name);
        if (duelMe) this.myHP = duelMe.hp;
        break;
      }

      case "duel_ended": {
        const won = msg.winner === this.name;
        this.activeDuel = null;
        this.log(`duelo terminado: ${won ? "VICTORIA" : "DERROTA"}`);
        if (won) {
          const comments = { zutomayo: "watafac le gane", kentorian: "xd facil", pancnjamon: "WAUSDKJASKD LE GANE AL WEOOOON", alercloud: "ya po gane la verdad" };
          this.sendChat(comments[this.name] || "gane po");
        } else {
          const comments = { zutomayo: "tamare webong", kentorian: "esta roto ese weon", pancnjamon: "TRAMPAAAAAA", alercloud: "ya wea perdí" };
          this.sendChat(comments[this.name] || "perdi po");
        }
        break;
      }

      // --- Oro ---
      case "gold_update":
        this.myGold = msg.gold;
        this.log(`>>> oro: ${msg.gold} <<<`);
        break;

      // --- Tienda ---
      case "shop_open": {
        this.shopOpen = true;
        this.shopItems = msg.items || [];
        this.log(`>>> TIENDA ABIERTA: ${msg.name} (${this.shopItems.length} items) <<<`);
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        await this.handleShop(msg.name);
        break;
      }

      case "shop_update": {
        this.shopItems = msg.items || [];
        this.log(`tienda actualizada: ${this.shopItems.length} items`);
        break;
      }

      case "shop_closed":
        this.shopOpen = false;
        this.shopItems = [];
        this.log("tienda cerrada");
        break;

      // --- Diálogo NPC ---
      case "dialog": {
        this.activeDialog = { npc: msg.npc, text: msg.text, options: msg.options || [] };
        this.log(`>>> DIÁLOGO: ${msg.npc} — "${(msg.text || "").slice(0, 80)}" <<<`);
        if (msg.options && msg.options.length > 0) {
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
          await this.handleDialog(msg);
        }
        break;
      }

      case "dialog_close":
        this.activeDialog = null;
        this.log("diálogo cerrado");
        break;

      // --- Reset aventura ---
      case "adventure_reset":
        this.log(">>> AVENTURA RESETEADA <<<");
        this.myGold = 0;
        this.myHP = 100;
        this.myMaxHP = 100;
        this.myLevel = 1;
        this.myStats = {};
        this.inventory = [];
        this.equipment = { weapon: null, armor: null, accessory: null };
        this.classChosen = false;
        this.shopOpen = false;
        this.shopItems = [];
        this.activeDialog = null;
        this.activeDuel = null;
        // Resetear votación de líder
        tacticalLeader = null;
        leaderVotes = {};
        leaderVoteInProgress = false;
        if (leaderVoteTimeout) { clearTimeout(leaderVoteTimeout); leaderVoteTimeout = null; }
        this.availableSkills = [];
        // Re-elegir clase
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
        this.chooseClass();
        break;

      // --- Turn timer (informativo) ---
      case "turn_timer_start":
      case "turn_timer_stop":
        break;

      case "error":
        this.log(`[ERROR] ${msg.text || JSON.stringify(msg)}`);
        break;

      case "gm_event": {
        this.log(`[gm_event] ${JSON.stringify(msg).slice(0, 150)}`);
        // Backstory recibido → disparar votación de líder táctico
        if (!tacticalLeader && !leaderVotes[this.name]) {
          if (!leaderVoteInProgress) {
            leaderVoteInProgress = true;
            if (!leaderVoteTimeout) {
              leaderVoteTimeout = setTimeout(() => {
                if (Object.keys(leaderVotes).length > 0) {
                  this.resolveLeaderVote();
                } else {
                  tacticalLeader = "kentorian";
                  this.log("nadie votó, kentorian es líder por defecto");
                }
                leaderVoteTimeout = null;
              }, 15000);
            }
          }
          this.voteForLeader();
        }
        break;
      }

      default:
        this.log(`[${msg.type}] ${JSON.stringify(msg).slice(0, 150)}`);
        break;
    }
  }

  // --- Manejar tienda: decidir qué comprar/vender ---
  async handleShop(shopName) {
    if (!this.shopOpen || this.shopItems.length === 0) return;

    // Evaluar items: buscar upgrades para mi clase
    const myFits = this.shopItems.filter(item =>
      !item.fits || item.fits.length === 0 || item.fits.includes(this.myClass)
    );

    const affordable = myFits.filter(item => item.price <= this.myGold);

    // Primero: vender items del inventario que no estén equipados y sean peores
    for (const item of this.inventory) {
      const isEquipped = Object.values(this.equipment).some(e => e && e.id === item.id);
      if (isEquipped) continue;

      // Vender items que no son para mi clase o que ya tengo algo mejor equipado
      const myEquipped = this.equipment[item.type];
      if (myEquipped || (item.fits && !item.fits.includes(this.myClass))) {
        this.log(`vendiendo: ${item.name}`);
        this.wsSend({ type: "sell_item", itemId: item.id });
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Después: comprar el mejor item que pueda pagar
    if (affordable.length > 0) {
      // Ordenar por nivel/stats para elegir el mejor
      const best = affordable.sort((a, b) => {
        const aTotal = Object.values(a.stats || {}).reduce((s, v) => s + v, 0);
        const bTotal = Object.values(b.stats || {}).reduce((s, v) => s + v, 0);
        return bTotal - aTotal;
      })[0];

      // Verificar si es upgrade sobre lo equipado
      const currentEquip = this.equipment[best.type];
      const currentStats = currentEquip ? Object.values(currentEquip.stats || {}).reduce((s, v) => s + v, 0) : 0;
      const newStats = Object.values(best.stats || {}).reduce((s, v) => s + v, 0);

      if (newStats > currentStats) {
        this.log(`comprando: ${best.name} por ${best.price}g`);
        this.wsSend({ type: "shop_buy", itemId: best.id });

        // Comentario según personalidad
        const comments = {
          zutomayo: `oe watom me compro la ${best.name.toLowerCase()}`,
          kentorian: `ia me compro esto q esta bkn`,
          pancnjamon: `MIRA LO Q ME COMPRE WAUSDKJASKD`,
          alercloud: `ya compre la ${best.name.toLowerCase()} sipo`,
        };
        await new Promise(r => setTimeout(r, 1000));
        this.sendChat(comments[this.name] || `me compro ${best.name}`);
      } else {
        // No vale la pena
        const passComments = {
          zutomayo: "no hay na bkn en la tienda",
          kentorian: "nah ta muy caro pa lo q es",
          pancnjamon: "PURAS WEAS EN LA TIENDA",
          alercloud: "no me sirve na la verdad",
        };
        this.sendChat(passComments[this.name] || "paso");
      }
    } else if (myFits.length > 0) {
      // Hay items pero no tengo plata
      const brokeComments = {
        zutomayo: "no me alcanza pa na watafac",
        kentorian: "no tengo plata po xd",
        pancnjamon: "ESTOY POBRE WEON",
        alercloud: "no tengo oro ni pa un chicle",
      };
      this.sendChat(brokeComments[this.name] || "no me alcanza");
    }
  }

  // --- Manejar diálogo NPC ---
  async handleDialog(dialogMsg) {
    const { npc, text, options } = dialogMsg;
    if (!options || options.length === 0) return;

    // Elegir opción según personalidad
    let chosenIndex = 0;

    // Intentar con IA para respuesta natural
    const messages = [
      {
        role: "system",
        content: this.buildRPGPrompt() + `\n\nUn NPC "${npc}" te habla. Elige la opción que más te interese según tu personalidad.`,
      },
      {
        role: "user",
        content: `NPC "${npc}" dice: "${text}"\n\nOPCIONES:\n${options.map((o, i) => `${i}. ${o}`).join("\n")}\n\nResponde SOLO con JSON: {"index": N, "comment": "tu reacción corta (2-8 palabras, tu estilo)"}`,
      },
    ];

    try {
      const result = await withTimeout(callAI(messages, false), 15000).catch(() => null);
      if (result) {
        this.lastModel = result.model;
        const cleaned = this.cleanAIText(result.text);
        const jsonMatch = cleaned.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          chosenIndex = Math.min(Math.max(0, parsed.index || 0), options.length - 1);
          if (parsed.comment) {
            await new Promise(r => setTimeout(r, 500));
            this.sendChat(parsed.comment);
          }
        }
      }
    } catch (e) {}

    // Enviar elección
    this.wsSend({ type: "dialog_choice", index: chosenIndex });
    this.log(`diálogo: eligió opción ${chosenIndex} → "${options[chosenIndex]}"`);
  }

  start() {
    this.scheduleSpontaneousChat();
    this.log("activo y escuchando");
  }

  stop() {
    if (this.chatTimer) clearTimeout(this.chatTimer);
  }
}

// ============================================================
// GM BOT - Narrador automático
// ============================================================
const ENEMY_TEMPLATES = [
  // Nivel 1
  [
    { name: "Goblin", hp: 50, atk: 8, def: 4, spd: 7, icon: "👺", color: "#22c55e" },
    { name: "Rata Gigante", hp: 35, atk: 6, def: 3, spd: 10, icon: "🐀", color: "#a1a1aa" },
    { name: "Esqueleto", hp: 45, atk: 9, def: 6, spd: 5, icon: "💀", color: "#e2e8f0" },
    { name: "Slime", hp: 60, atk: 5, def: 2, spd: 3, icon: "🟢", color: "#4ade80" },
  ],
  // Nivel 2
  [
    { name: "Orco Guerrero", hp: 90, atk: 14, def: 8, spd: 6, tier: "elite", icon: "👹", color: "#f59e0b" },
    { name: "Araña Venenosa", hp: 65, atk: 11, def: 5, spd: 12, icon: "🕷️", color: "#7c3aed" },
    { name: "Bandido", hp: 75, atk: 12, def: 7, spd: 9, icon: "🗡️", color: "#78716c" },
    { name: "Lobo Sombrío", hp: 55, atk: 13, def: 4, spd: 14, icon: "🐺", color: "#6366f1" },
  ],
  // Nivel 3
  [
    { name: "Troll de Cueva", hp: 140, atk: 18, def: 12, spd: 4, tier: "elite", icon: "🧌", color: "#84cc16" },
    { name: "Nigromante", hp: 80, atk: 10, def: 6, spd: 8, tier: "elite", icon: "🧙‍♂️", color: "#a855f7" },
    { name: "Quimera", hp: 120, atk: 16, def: 10, spd: 7, tier: "elite", icon: "🦁", color: "#ef4444" },
  ],
  // Nivel 4 (Boss)
  [
    { name: "Dragón Joven", hp: 80, atk: 20, def: 11, spd: 10, tier: "boss", icon: "🐉", color: "#c084fc" },
    { name: "Liche", hp: 60, atk: 12, def: 8, spd: 6, tier: "boss", icon: "☠️", color: "#22d3ee" },
    { name: "Demonio Menor", hp: 70, atk: 18, def: 10, spd: 9, tier: "boss", icon: "😈", color: "#ff4444" },
  ],
];

// Escenarios de fallback si la IA no responde (con enemigos temáticos por nivel)
const FALLBACK_SCENARIOS = [
  {
    text: "Una cueva oscura se abre ante el grupo. Algo se mueve entre las sombras...", enemyCount: 2,
    enemies: [
      [{ name: "Murciélago Gigante", hp: 35, atk: 6, def: 3, spd: 10, icon: "🦇", color: "#6366f1" }, { name: "Araña de Cueva", hp: 45, atk: 8, def: 4, spd: 8, icon: "🕷️", color: "#78716c" }, { name: "Rata de Caverna", hp: 30, atk: 5, def: 2, spd: 12, icon: "🐀", color: "#a1a1aa" }],
      [{ name: "Golem de Piedra", hp: 80, atk: 12, def: 10, spd: 3, tier: "elite", icon: "🪨", color: "#f59e0b" }, { name: "Gusano de Roca", hp: 65, atk: 11, def: 6, spd: 5, icon: "🐛", color: "#84cc16" }],
      [{ name: "Troll de Cueva", hp: 100, atk: 16, def: 11, spd: 4, tier: "elite", icon: "🧌", color: "#ef4444" }, { name: "Basilisco", hp: 90, atk: 15, def: 10, spd: 6, tier: "elite", icon: "🐍", color: "#7c3aed" }],
      [{ name: "Wyrm Subterráneo", hp: 70, atk: 18, def: 11, spd: 7, tier: "boss", icon: "🐉", color: "#c084fc" }],
    ],
  },
  {
    text: "Un bosque maldito rodea al grupo. De entre la maleza emergen criaturas.", enemyCount: 3,
    enemies: [
      [{ name: "Lobo Sombrío", hp: 40, atk: 7, def: 3, spd: 12, icon: "🐺", color: "#6366f1" }, { name: "Dríade Corrupta", hp: 35, atk: 6, def: 4, spd: 8, icon: "🌿", color: "#22c55e" }, { name: "Planta Carnívora", hp: 50, atk: 8, def: 5, spd: 2, icon: "🌺", color: "#ef4444" }],
      [{ name: "Ent Marchito", hp: 90, atk: 13, def: 9, spd: 3, tier: "elite", icon: "🌳", color: "#f59e0b" }, { name: "Hombre Lobo", hp: 70, atk: 14, def: 6, spd: 11, icon: "🐺", color: "#a855f7" }],
      [{ name: "Treant Oscuro", hp: 100, atk: 15, def: 12, spd: 4, tier: "elite", icon: "🌲", color: "#84cc16" }, { name: "Espíritu del Bosque", hp: 80, atk: 14, def: 8, spd: 9, tier: "elite", icon: "👻", color: "#22d3ee" }],
      [{ name: "Hydra de Pantano", hp: 75, atk: 19, def: 11, spd: 6, tier: "boss", icon: "🐍", color: "#c084fc" }],
    ],
  },
  {
    text: "Las ruinas de un templo revelan una cámara ritual con muertos inquietos.", enemyCount: 2,
    enemies: [
      [{ name: "Esqueleto", hp: 40, atk: 8, def: 5, spd: 6, icon: "💀", color: "#e2e8f0" }, { name: "Zombie", hp: 50, atk: 7, def: 3, spd: 3, icon: "🧟", color: "#84cc16" }, { name: "Fantasma", hp: 30, atk: 9, def: 2, spd: 10, icon: "👻", color: "#22d3ee" }],
      [{ name: "Espectro", hp: 70, atk: 12, def: 5, spd: 9, tier: "elite", icon: "👻", color: "#a855f7" }, { name: "Caballero No-Muerto", hp: 85, atk: 14, def: 9, spd: 5, icon: "⚔️", color: "#78716c" }],
      [{ name: "Nigromante", hp: 80, atk: 10, def: 6, spd: 8, tier: "elite", icon: "🧙‍♂️", color: "#7c3aed" }, { name: "Liche Menor", hp: 90, atk: 14, def: 9, spd: 7, tier: "elite", icon: "☠️", color: "#22d3ee" }],
      [{ name: "Liche Supremo", hp: 65, atk: 18, def: 10, spd: 8, tier: "boss", icon: "☠️", color: "#c084fc" }],
    ],
  },
];

class GMBot {
  constructor(ws) {
    this.ws = ws;
    this.gameState = null;
    this.encounterIndex = 0;
    this.combatActive = false;
    this.waitingForPlayers = true;
    this.expectedPlayers = PERSONALITIES.length;
    this.connectedPlayers = 0;
    this.encounterTimer = null;
    this.lastModel = "";
    this.lastPhase = null;
    this.postCombatRunning = false;
    // Historial narrativo para continuidad
    this.storyHistory = [];
    this.currentScenario = null;
  }

  log(msg) {
    console.log(`\x1b[32m[GM] ${msg}\x1b[0m`);
  }

  wsSend(obj) {
    try { this.ws.send(JSON.stringify(obj)); } catch (e) {}
  }

  // Enviar comando GM
  gmAction(action, extra = {}) {
    this.wsSend({ type: "gm", action, ...extra });
    this.log(`${action}: ${JSON.stringify(extra).slice(0, 100)}`);
  }

  // Iniciar el primer escenario cuando todos están conectados
  checkAllPlayersReady() {
    if (this.connectedPlayers >= this.expectedPlayers && this.waitingForPlayers) {
      this.waitingForPlayers = false;
      this.log(`Todos los jugadores conectados (${this.connectedPlayers}). Generando backstory...`);
      this.startAdventure();
    }
  }

  // Generar backstory y arrancar la aventura
  async startAdventure() {
    const players = this.gameState?.players || [];
    const playerInfo = players.map(p => `${p.username} (${p.className})`).join(", ") || PERSONALITIES.map(p => p.name).join(", ");

    // Cargar backstories anteriores para no repetir
    const BACKSTORY_FILE = path.join(__dirname, "rpg-backstories.json");
    let pastBackstories = [];
    try { pastBackstories = JSON.parse(fs.readFileSync(BACKSTORY_FILE, "utf8")); } catch {}

    const pastContext = pastBackstories.length > 0
      ? `\n\nAVENTURAS ANTERIORES (NO REPITAS nada parecido):\n${pastBackstories.slice(-10).map((b, i) => `${i + 1}. ${b}`).join("\n")}`
      : "";

    const messages = [
      {
        role: "system",
        content: `Eres un Game Master épico narrando el inicio de una aventura RPG.
Los jugadores son amigos chilenos que trabajan en una empresa de software. En el juego son aventureros.
Narra en español, tono épico pero con humor sutil. NO uses emojis.
Máximo 4-5 frases. Sé dramático y enganchante.
IMPORTANTE: Cada aventura debe ser COMPLETAMENTE DIFERENTE a las anteriores. Inventa lugares, motivaciones, amenazas y ambientes NUEVOS cada vez.`,
      },
      {
        role: "user",
        content: `Los héroes son: ${playerInfo}.
Genera una INTRO ÉPICA para el inicio de su aventura. Incluye:
- POR QUÉ están juntos (inventa una motivación original y única)
- DÓNDE comienzan (inventa un lugar creativo, NO una taberna genérica)
- QUÉ amenaza se cierne sobre el mundo (algo que no se haya visto antes)
Que sea COMPLETAMENTE ORIGINAL. Máximo 4-5 frases.${pastContext}`,
      },
    ];

    const startTime = Date.now();
    while ((Date.now() - startTime) < 60000) {
      try {
        const result = await withTimeout(callAI(messages, false), 15000).catch(() => null);
        if (result) {
          this.lastModel = result.model;
          let text = result.text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
          text = text.replace(/<think>[\s\S]*/gi, "").trim();
          if (text) {
            this.gmAction("event", { text });
            this.storyHistory.push(`INICIO: ${text.slice(0, 200)}`);
            // Guardar backstory en archivo persistente para no repetir
            pastBackstories.push(text.slice(0, 150));
            try { fs.writeFileSync(BACKSTORY_FILE, JSON.stringify(pastBackstories.slice(-20), null, 2)); } catch {}
            this.log(`Backstory generado (${text.length} chars)`);
            // Esperar que lean el backstory + elijan líder táctico
            await new Promise(r => setTimeout(r, 12000));
            await this.waitForLeaderVote();
            this.startEncounter();
            return;
          }
        }
      } catch (e) {
        this.log(`Error generando backstory: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    // Fallback solo si 60s sin respuesta de ningún provider
    this.log("60s sin backstory de IA, usando fallback");
    const fallback = "Cuatro aventureros se encuentran en una taberna en las afueras de un reino olvidado. Un anciano misterioso les ofrece un mapa hacia una mazmorra llena de tesoros, pero advierte que nadie ha regresado con vida. Sin pensarlo dos veces, aceptan.";
    this.gmAction("event", { text: fallback });
    this.storyHistory.push(`INICIO: ${fallback}`);
    await new Promise(r => setTimeout(r, 10000));
    await this.waitForLeaderVote();
    this.startEncounter();
  }

  // Generar escenario con IA
  async generateScenario() {
    const playerNames = PERSONALITIES.map(p => p.name).join(", ");
    const playerInfo = this.gameState?.players?.map(p => `${p.username} (${p.className} nv.${p.level || 1}, HP:${p.hp}/${p.maxHp})`).join(", ") || playerNames;
    const level = Math.min(Math.floor(this.encounterIndex / 2) + 1, 4);

    const historyText = this.storyHistory.length > 0
      ? `HISTORIA HASTA AHORA:\n${this.storyHistory.slice(-5).map((h, i) => `${i + 1}. ${h}`).join("\n")}`
      : "Esta es la PRIMERA aventura del grupo.";

    const enemyExamples = ENEMY_TEMPLATES.flat().map(e => e.name).join(", ");

    const messages = [
      {
        role: "system",
        content: `Eres un Game Master creativo para un RPG. Generas escenarios únicos y enemigos apropiados.
Los jugadores son amigos chilenos: ${playerInfo}.
Nivel de dificultad actual: ${level} (1=fácil, 4=boss).
Encuentro número: ${this.encounterIndex + 1}.

${historyText}

IMPORTANTE: Cada escenario debe ser DIFERENTE a los anteriores. Varía ambientes (mazmorras, bosques, ruinas, pantanos, volcanes, ciudades abandonadas, playas malditas, cementerios, minas, castillos, etc).
Crea enemigos temáticos que encajen con el escenario. NO repitas enemigos de encuentros anteriores.`,
      },
      {
        role: "user",
        content: `Genera el siguiente encuentro. Responde SOLO en JSON exacto:
{
  "scenario": "descripción del lugar en 2 frases (épico con humor sutil)",
  "narration": "lo que los héroes ven/oyen al llegar, 1-2 frases dramáticas",
  "enemies": [
    {"name": "Nombre Enemigo", "hp": 30-200, "atk": 5-20, "def": 2-12, "spd": 3-12, "tier": "normal|elite|boss", "icon": "emoji", "color": "#hex"}
  ]
}

TIPOS DE ENEMIGO (tier):
- "normal": enemigos comunes (la mayoría)
- "elite": enemigos especiales, más fuertes (⚡ máx 1 por encuentro, no siempre)
- "boss": jefes finales (☠️ solo en nivel 4, solo 1)
El servidor aplica multiplicadores según tier, así que los stats son la BASE.

REGLAS de stats según nivel ${level}:
- Nivel 1: HP 25-50, ATK 5-8, DEF 2-5, SPD 3-10. ${level <= 2 ? "2-3" : level === 3 ? "2" : "1"} enemigos. Todos "normal". Enemigos débiles (ratas, slimes, goblins)
- Nivel 2: HP 50-90, ATK 8-12, DEF 5-8, SPD 5-10. 2-3 enemigos. Puede haber 1 "elite" entre ellos. Enemigos medios (esqueletos, lobos, bandidos)
- Nivel 3: HP 80-130, ATK 12-18, DEF 8-12, SPD 5-9. 2 enemigos. 1 "elite" + 1 "normal". Enemigos fuertes (ogros, liches, elementales)
- Nivel 4: HP 60-100, ATK 15-20, DEF 8-12, SPD 6-10. 1 "boss" (stats base, el server los multiplica x4 HP, x2.2 ATK, x1.8 DEF). Boss épico (dragón, demonio, nigromante)

ICON: usa un emoji temático para cada enemigo (🐺🦇🐉👹💀🕷️🧟🐍🦂🔥👻🧙‍♂️ etc)
COLOR: usa un color hex para el nombre (#ff4444 rojo, #f59e0b ámbar, #a855f7 púrpura, #22c55e verde, #3b82f6 azul, etc)`,
      },
    ];

    const startTime = Date.now();
    while ((Date.now() - startTime) < 60000) {
      try {
        const result = await withTimeout(callAI(messages, false), 15000).catch(() => null);
        if (result) {
          this.lastModel = result.model;
          let text = result.text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
          text = text.replace(/<think>[\s\S]*/gi, "").trim();
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed.scenario && parsed.enemies?.length > 0) {
                return parsed;
              }
              // JSON parseó pero falta scenario o enemies — usar texto como scenario
              if (parsed.scenario) {
                this.log("JSON sin enemies, generando enemigos por nivel");
                const defaultEnemies = this.generateDefaultEnemies(level);
                return { scenario: parsed.scenario, narration: parsed.narration || "", enemies: defaultEnemies };
              }
            } catch (jsonErr) {
              this.log(`JSON malformado: ${jsonErr.message}`);
            }
          }
          // IA respondió texto libre sin JSON — usarlo como escenario narrativo
          if (text.length > 20) {
            this.log("IA respondió texto libre, usándolo como escenario");
            const defaultEnemies = this.generateDefaultEnemies(level);
            return { scenario: text.slice(0, 300), narration: "", enemies: defaultEnemies };
          }
          this.log("IA respondió pero respuesta inútil, reintentando...");
        }
      } catch (e) {
        this.log(`Error generando escenario: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    this.log("60s sin escenario de IA, usando fallback");
    return null;
  }

  // Generar enemigos por defecto cuando la IA no los incluyó
  generateDefaultEnemies(level) {
    const enemies = [
      // Nivel 1: todos normal
      [
        { name: "Goblin", icon: "👺", color: "#22c55e" },
        { name: "Slime", icon: "🟢", color: "#4ade80" },
        { name: "Rata Gigante", icon: "🐀", color: "#a1a1aa" },
        { name: "Esqueleto", icon: "💀", color: "#e2e8f0" },
        { name: "Murciélago", icon: "🦇", color: "#6366f1" },
      ],
      // Nivel 2: puede haber 1 elite
      [
        { name: "Orco", icon: "👹", color: "#ef4444", tier: "elite" },
        { name: "Bandido", icon: "🗡️", color: "#78716c" },
        { name: "Espectro", icon: "👻", color: "#a855f7" },
        { name: "Araña Venenosa", icon: "🕷️", color: "#7c3aed" },
        { name: "Lobo Sombrío", icon: "🐺", color: "#6366f1" },
      ],
      // Nivel 3: 1 elite + 1 normal
      [
        { name: "Troll", icon: "🧌", color: "#84cc16", tier: "elite" },
        { name: "Nigromante", icon: "🧙‍♂️", color: "#a855f7", tier: "elite" },
        { name: "Quimera", icon: "🦁", color: "#ef4444" },
        { name: "Golem", icon: "🪨", color: "#f59e0b" },
        { name: "Basilisco", icon: "🐍", color: "#7c3aed" },
      ],
      // Nivel 4: 1 boss
      [
        { name: "Dragón Joven", icon: "🐉", color: "#c084fc", tier: "boss" },
        { name: "Liche", icon: "☠️", color: "#22d3ee", tier: "boss" },
        { name: "Demonio", icon: "😈", color: "#ff4444", tier: "boss" },
        { name: "Hydra", icon: "🐍", color: "#c084fc", tier: "boss" },
        { name: "Wyrm", icon: "🐉", color: "#f59e0b", tier: "boss" },
      ],
    ];
    const stats = [
      { hp: [30, 55], atk: [5, 8], def: [2, 5], spd: [3, 10] },
      { hp: [55, 90], atk: [8, 13], def: [5, 8], spd: [5, 11] },
      { hp: [80, 130], atk: [13, 18], def: [8, 12], spd: [4, 9] },
      { hp: [60, 100], atk: [15, 20], def: [8, 12], spd: [6, 10] },
    ];
    const lvl = Math.min(level - 1, 3);
    const s = stats[lvl];
    const count = level <= 2 ? 2 + Math.floor(Math.random() * 2) : level === 3 ? 2 : 1;
    const pool = [...enemies[lvl]].sort(() => Math.random() - 0.5);
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    return pool.slice(0, count).map(e => ({
      name: e.name, hp: rand(...s.hp), atk: rand(...s.atk), def: rand(...s.def), spd: rand(...s.spd),
      ...(e.tier ? { tier: e.tier } : {}),
      ...(e.icon ? { icon: e.icon } : {}),
      ...(e.color ? { color: e.color } : {}),
    }));
  }

  // Esperar a que los jugadores elijan líder táctico (máx 25s)
  async waitForLeaderVote() {
    if (tacticalLeader) return; // ya hay líder
    this.log("Esperando elección de líder táctico...");
    const start = Date.now();
    while (!tacticalLeader && (Date.now() - start) < 25000) {
      await new Promise(r => setTimeout(r, 2000));
    }
    if (tacticalLeader) {
      this.log(`Líder táctico elegido: ${tacticalLeader}`);
    } else {
      this.log("Timeout esperando líder, continuando sin líder definido");
    }
  }

  // Iniciar un encuentro
  async startEncounter() {
    if (this.combatActive) return;

    const level = Math.min(Math.floor(this.encounterIndex / 2) + 1, 4);
    this.log(`=== ENCUENTRO ${this.encounterIndex + 1}: nivel ${level} ===`);

    // Intentar generar escenario con IA
    let scenario = await this.generateScenario();

    if (scenario) {
      this.log(`Escenario generado por IA: ${scenario.scenario.slice(0, 80)}...`);
      this.currentScenario = scenario;

      // Narrar escenario
      this.gmAction("scenario", { text: scenario.scenario });
      await new Promise(r => setTimeout(r, 5000));

      // Narración dramática
      if (scenario.narration) {
        this.gmAction("event", { text: scenario.narration });
        await new Promise(r => setTimeout(r, 3000));
      }

      // Spawn enemigos generados por IA
      const scale = 1 + (this.encounterIndex * 0.1);
      for (const enemy of scenario.enemies) {
        const spawnData = {
          name: enemy.name,
          hp: Math.round(enemy.hp * scale),
          atk: Math.round(enemy.atk * scale),
          def: Math.round(enemy.def * scale),
          spd: enemy.spd || 5,
        };
        if (enemy.tier && enemy.tier !== "normal") spawnData.tier = enemy.tier;
        if (enemy.icon) spawnData.icon = enemy.icon;
        if (enemy.color) spawnData.color = enemy.color;
        this.gmAction("spawn_enemy", spawnData);
        await new Promise(r => setTimeout(r, 1000));
      }

      // Guardar en historial
      const enemyNames = scenario.enemies.map(e => e.name).join(", ");
      this.storyHistory.push(`Encuentro ${this.encounterIndex + 1}: ${scenario.scenario.slice(0, 100)} — Enemigos: ${enemyNames}`);
    } else {
      // Fallback: escenario fijo + enemigos temáticos del mismo escenario
      this.log("IA no respondió, usando escenario fallback");
      const fb = FALLBACK_SCENARIOS[this.encounterIndex % FALLBACK_SCENARIOS.length];
      this.gmAction("scenario", { text: fb.text });
      await new Promise(r => setTimeout(r, 5000));

      // Elegir enemigos temáticos del nivel correcto
      const levelIdx = Math.min(level - 1, fb.enemies.length - 1);
      const thematicEnemies = fb.enemies[levelIdx];
      const shuffled = [...thematicEnemies].sort(() => Math.random() - 0.5);
      const enemies = shuffled.slice(0, fb.enemyCount);
      const scale = 1 + (this.encounterIndex * 0.15);

      for (const enemy of enemies) {
        const spawnData = {
          name: enemy.name,
          hp: Math.round(enemy.hp * scale),
          atk: Math.round(enemy.atk * scale),
          def: Math.round(enemy.def * scale),
          spd: enemy.spd,
        };
        if (enemy.tier && enemy.tier !== "normal") spawnData.tier = enemy.tier;
        if (enemy.icon) spawnData.icon = enemy.icon;
        if (enemy.color) spawnData.color = enemy.color;
        this.gmAction("spawn_enemy", spawnData);
        await new Promise(r => setTimeout(r, 1000));
      }

      const enemyNames = enemies.map(e => e.name).join(", ");
      this.storyHistory.push(`Encuentro ${this.encounterIndex + 1}: ${fb.text} — Enemigos: ${enemyNames}`);
    }

    // Iniciar combate
    await new Promise(r => setTimeout(r, 2000));
    this.gmAction("combat_start");
    this.combatActive = true;
  }

  // Manejar turno de enemigo
  async handleEnemyTurn(enemyName) {
    this.log(`Turno de ${enemyName}`);

    // Elegir target: priorizar al que tenga menos HP o al cleric
    const players = this.gameState?.players || [];
    const alive = players.filter(p => p.hp > 0);
    if (alive.length === 0) return;

    let target;
    // 40% chance de atacar al cleric (si está vivo), sino al de menos HP
    const cleric = alive.find(p => p.classKey === "cleric");
    if (cleric && Math.random() < 0.4) {
      target = cleric.username;
    } else {
      // Atacar al de menos HP
      target = alive.sort((a, b) => a.hp - b.hp)[0].username;
    }

    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
    this.gmAction("enemy_attack", { enemy: enemyName, target });
  }

  // Después del combate: victoria → loot → oro → tienda/diálogo → siguiente encuentro
  async postCombat() {
    this.combatActive = false;
    this.postCombatRunning = false;
    this.log("Combate terminado");

    const level = Math.min(Math.floor(this.encounterIndex / 2) + 1, 4);
    const enemyCount = this.currentScenario?.enemies?.length || 2;

    // 1. Narrar victoria con contexto
    await new Promise(r => setTimeout(r, 2000));
    const lastStory = this.storyHistory[this.storyHistory.length - 1] || "";
    const victoryMessages = [
      { role: "system", content: "Eres un GM narrando victoria en un RPG. 1 frase épica corta. Sin emojis. En español." },
      { role: "user", content: `Los héroes ganaron: ${lastStory}\nNarra la victoria brevemente (1 frase).` },
    ];
    try {
      const result = await withTimeout(callAI(victoryMessages, false), 15000).catch(() => null);
      if (result) {
        let text = result.text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        text = text.replace(/<think>[\s\S]*/gi, "").trim();
        if (text) this.gmAction("event", { text });
      }
    } catch (e) {}

    // 2. Dar oro a todos
    await new Promise(r => setTimeout(r, 2000));
    const goldReward = 50 + this.encounterIndex * 30 + Math.floor(Math.random() * 50);
    this.gmAction("give_gold", { amount: goldReward });
    this.log(`Oro repartido: ${goldReward}g a todos`);

    // 3. Loot drop
    await new Promise(r => setTimeout(r, 3000));
    this.gmAction("loot", { level: Math.min(level, 5), count: Math.min(enemyCount, 3), mode: "council" });

    // 4. Esperar que terminen de votar loot (30s máx)
    await new Promise(r => setTimeout(r, 20000));

    // 5. Cada 2 encuentros: abrir tienda
    if (this.encounterIndex > 0 && this.encounterIndex % 2 === 1) {
      await this.openShop(level);
    }

    // 6. Cada 3 encuentros: diálogo con NPC
    if (this.encounterIndex > 0 && this.encounterIndex % 3 === 0) {
      await this.startNPCDialog();
    }

    // 7. Siguiente encuentro
    this.encounterIndex++;
    this.log(`Próximo encuentro en 30-50 segundos...`);
    this.encounterTimer = setTimeout(() => this.startEncounter(), 30000 + Math.random() * 20000);
  }

  // Abrir tienda generada por IA o fallback
  async openShop(level) {
    // Generar nombre de mercader con IA
    let shopName = "Mercader Errante";
    try {
      const result = await withTimeout(callAI([
        { role: "system", content: "Genera un nombre creativo para un mercader de fantasía. Solo el nombre, nada más. En español." },
        { role: "user", content: `Nombre de mercader para nivel ${level} de aventura. Solo el nombre (2-4 palabras).` },
      ], false), 10000).catch(() => null);
      if (result) {
        let name = result.text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim().replace(/<think>[\s\S]*/gi, "").trim();
        name = name.replace(/[*"#]/g, "").trim();
        if (name && name.length < 40) shopName = name;
      }
    } catch (e) {}

    this.log(`Abriendo tienda: ${shopName} (nivel ${level})`);
    this.gmAction("open_shop", { name: shopName, level, count: 5 });

    // Esperar que compren (30s)
    await new Promise(r => setTimeout(r, 30000));

    // Cerrar tienda
    this.gmAction("close_shop");
    this.log("Tienda cerrada");
    await new Promise(r => setTimeout(r, 3000));
  }

  // Iniciar diálogo NPC generado por IA
  async startNPCDialog() {
    const playerNames = PERSONALITIES.map(p => p.name).join(", ");
    const lastStory = this.storyHistory.slice(-3).join(" | ");

    const messages = [
      {
        role: "system",
        content: `Eres un GM creativo. Genera un encuentro con un NPC para un grupo de aventureros chilenos (${playerNames}).
El NPC debe ser interesante y dar información útil o cómica sobre la aventura.`,
      },
      {
        role: "user",
        content: `Historia reciente: ${lastStory || "inicio de aventura"}
Genera un NPC con diálogo. Responde SOLO en JSON:
{"npc": "nombre del NPC", "text": "lo que dice el NPC (1-2 frases)", "options": ["opción 1", "opción 2", "opción 3"]}
Las opciones deben ser variadas: una curiosa, una graciosa, una práctica.`,
      },
    ];

    try {
      const result = await withTimeout(callAI(messages, false), 15000).catch(() => null);
      if (result) {
        let text = result.text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        text = text.replace(/<think>[\s\S]*/gi, "").trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.npc && parsed.text) {
            this.log(`Diálogo NPC: ${parsed.npc}`);
            this.gmAction("dialog", {
              npc: parsed.npc,
              text: parsed.text,
              options: parsed.options || [],
            });

            // Esperar respuestas (20s)
            await new Promise(r => setTimeout(r, 20000));

            // Cerrar diálogo
            this.gmAction("dialog_close");
            this.log("Diálogo cerrado");
            await new Promise(r => setTimeout(r, 3000));
            return;
          }
        }
      }
    } catch (e) {
      this.log(`Error generando diálogo: ${e.message}`);
    }

    // Fallback
    this.gmAction("dialog", {
      npc: "Viajero Misterioso",
      text: "He oído rumores de peligros más adelante. ¿Quieren saber más?",
      options: ["Cuéntame todo", "No me interesa", "¿Tienes algo para vender?"],
    });
    await new Promise(r => setTimeout(r, 20000));
    this.gmAction("dialog_close");
  }

  // Procesar eventos del servidor
  handleEvent(msg) {
    switch (msg.type) {
      case "welcome":
        this.log(`Conectado como GM (isGM: ${msg.isGM})`);
        break;

      case "game_state":
        this.gameState = msg;
        // Detectar si el combate terminó: transición real de "combat" a "adventure"
        if (this.combatActive && !this.postCombatRunning && this.lastPhase === "combat" && msg.phase === "adventure") {
          this.postCombatRunning = true;
          this.postCombat();
        }
        this.lastPhase = msg.phase;
        // Contar jugadores con clase elegida
        const withClass = (msg.players || []).filter(p => p.classKey);
        if (withClass.length > this.connectedPlayers) {
          this.connectedPlayers = withClass.length;
          this.checkAllPlayersReady();
        }
        break;

      case "enemy_turn":
        // El servidor dice que es turno de un enemigo
        this.handleEnemyTurn(msg.enemy);
        break;

      case "system":
        // Solo loguear
        this.log(`[sys] ${msg.text || ""}`);
        break;

      case "message":
        // Chat de jugadores - solo loguear
        break;

      case "dialog_response":
        // Un jugador respondió al diálogo
        this.log(`[dialog] ${msg.player} eligió: "${msg.text}"`);
        break;

      case "shop_open":
      case "shop_update":
      case "shop_closed":
      case "gold_update":
      case "dialog":
      case "dialog_close":
      case "turn_timer_start":
      case "turn_timer_stop":
        // El GM genera estos eventos, no necesita procesarlos
        break;

      case "error":
        this.log(`[ERROR] ${msg.text || JSON.stringify(msg)}`);
        break;

      default:
        // Loguear eventos no manejados
        if (!["users", "classes", "loot_vote", "loot_awarded", "vote_update", "inventory_update"].includes(msg.type)) {
          this.log(`[${msg.type}] ${JSON.stringify(msg).slice(0, 100)}`);
        }
        break;
    }
  }

  stop() {
    if (this.encounterTimer) clearTimeout(this.encounterTimer);
  }
}

// ============================================================
// MAIN: Conectar y lanzar agentes RPG + GM
// ============================================================
const memories = loadMemories();
const agents = [];
let gmBot = null;

// --- Lanzar GM ---
function launchGM() {
  const ws = new WebSocket(HOST);

  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "join", username: "DungeonMaster", role: "gm" }));
    gmBot = new GMBot(ws);
    console.log(`\x1b[32m[GM] Conectado como DungeonMaster\x1b[0m`);
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      if (gmBot) gmBot.handleEvent(msg);
    } catch (e) {}
  });

  ws.on("close", () => {
    console.log(`\x1b[32m[GM] Desconectado\x1b[0m`);
    if (gmBot) gmBot.stop();
    setTimeout(() => launchGM(), 5000);
  });

  ws.on("error", (err) => {
    console.log(`\x1b[32m[GM] Error: ${err.message}\x1b[0m`);
  });
}

function launchAgent(personality, delay) {
  setTimeout(() => {
    const ws = new WebSocket(HOST);

    ws.on("open", () => {
      // Unirse al RPG
      ws.send(JSON.stringify({ type: "join", username: personality.name, role: "player" }));

      const existing = agents.find(a => a.name === personality.name);
      let agent;
      if (existing) {
        existing.ws = ws;
        agent = existing;
      } else {
        agent = new RPGAgent(personality, ws, memories);
        agents.push(agent);
      }
      agent.start();
      console.log(`${personality.color}[${personality.name}] Conectado al RPG como ${personality.preferredClass}\x1b[0m`);
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data);
        const agent = agents.find(a => a.name === personality.name);
        if (!agent) return;

        // Si es un mensaje de chat de otro agente nuestro, registrar internamente
        if (msg.type === "message" && msg.username) {
          const cleanName = msg.username.replace(/\s*\(.*\)\s*$/, "");
          const isOurAgent = PERSONALITIES.some(p => p.name === cleanName);
          if (isOurAgent && cleanName !== personality.name) {
            addToChat(cleanName, msg.text || "");
          }
        }

        agent.handleEvent(msg);
      } catch (e) {}
    });

    ws.on("close", () => {
      console.log(`${personality.color}[${personality.name}] Desconectado del RPG\x1b[0m`);
      const existing = agents.find(a => a.name === personality.name);
      if (existing) existing.stop();
      setTimeout(() => launchAgent(personality, 0), 5000);
    });

    ws.on("error", (err) => {
      console.log(`${personality.color}[${personality.name}] Error: ${err.message}\x1b[0m`);
    });
  }, delay);
}

// Lanzar con delay escalonado
console.log("=== AI RPG Party ===");
console.log(`Lanzando GM + ${PERSONALITIES.length} jugadores...`);
console.log(`Memoria: ${Object.keys(memories).length > 0 ? "cargada" : "nueva"}\n`);

console.log(`\x1b[32m  DungeonMaster → GM\x1b[0m`);
PERSONALITIES.forEach((p, i) => {
  console.log(`${p.color}  ${p.name} → ${p.preferredClass}\x1b[0m`);
});
console.log("\nPresiona Ctrl+C para detener y guardar memorias.\n");

// GM primero, luego jugadores
launchGM();
PERSONALITIES.forEach((p, i) => launchAgent(p, 2000 + i * 2000));

// Guardar memorias al salir
process.on("SIGINT", () => {
  console.log("\n[RPG] Guardando memorias...");
  saveMemories(memories);
  console.log("[RPG] Memorias guardadas. Adiós!");
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  console.log(`[RPG] Error: ${err.message}`);
});
