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
const MEMORY_FILE = path.join(__dirname, "ai-memories.json");

// Providers (APIs gratuitas con fallback)
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

// ============================================================
// PROVIDERS AI (con rotación y fallback)
// ============================================================
let providerIdx = 0;

// Groq: modelos rotativos para distribuir rate limits
const GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "moonshotai/kimi-k2-instruct",
  "qwen/qwen3-32b",
];
let groqModelIdx = 0;

async function callGroq(messages) {
  // Intentar varios modelos de Groq
  for (let i = 0; i < GROQ_MODELS.length; i++) {
    const model = GROQ_MODELS[(groqModelIdx + i) % GROQ_MODELS.length];
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: 120, temperature: 0.85 }),
      });
      const data = await res.json();
      if (data.choices?.[0]) {
        groqModelIdx = (groqModelIdx + i + 1) % GROQ_MODELS.length;
        return { text: data.choices[0].message.content.trim(), model };
      }
    } catch (e) {}
  }
  throw new Error("Groq: todos los modelos fallaron");
}

const CEREBRAS_MODELS = [
  "qwen-3-235b-a22b-instruct-2507",
  "llama-3.3-70b",
  "qwen-3-32b",
  "deepseek-r1-distill-llama-70b",
];
let cerebrasModelIdx = 0;

async function callCerebras(messages) {
  for (let i = 0; i < CEREBRAS_MODELS.length; i++) {
    const model = CEREBRAS_MODELS[(cerebrasModelIdx + i) % CEREBRAS_MODELS.length];
    try {
      const res = await fetch(CEREBRAS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${CEREBRAS_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: 120, temperature: 0.85 }),
      });
      const data = await res.json();
      if (data.choices?.[0]) {
        cerebrasModelIdx = (cerebrasModelIdx + i + 1) % CEREBRAS_MODELS.length;
        return { text: data.choices[0].message.content.trim(), model };
      }
    } catch (e) {}
  }
  throw new Error("Cerebras: todos los modelos fallaron");
}

async function callSambaNova(messages) {
  const model = "Meta-Llama-3.3-70B-Instruct";
  const res = await fetch(SAMBANOVA_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${SAMBANOVA_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: 120, temperature: 0.85 }),
  });
  const data = await res.json();
  if (data.choices?.[0]) return { text: data.choices[0].message.content.trim(), model };
  throw new Error(data.error?.message || JSON.stringify(data));
}

async function callOpenRouter(messages) {
  const shuffled = [...OPENROUTER_MODELS].sort(() => Math.random() - 0.5);
  for (const model of shuffled) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: 120, temperature: 0.85 }),
      });
      const data = await res.json();
      // Nombre corto del modelo: "google/gemma-3-27b-it:free" -> "gemma-3-27b-it"
      const shortModel = model.split("/").pop().split(":")[0];
      if (data.choices?.[0]) return { text: data.choices[0].message.content.trim(), model: shortModel };
    } catch (e) {}
  }
  throw new Error("OpenRouter: todos los modelos fallaron");
}

async function callGemini(messages) {
  const model = "gemini-2.0-flash";
  // Gemini usa formato distinto: concatenar mensajes
  const text = messages.map(m => (m.role === "system" ? m.content : `${m.role}: ${m.content}`)).join("\n\n");
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: { temperature: 0.85, maxOutputTokens: 80 },
    }),
  });
  const data = await res.json();
  if (data.candidates?.[0]) return { text: data.candidates[0].content.parts[0].text.trim(), model };
  throw new Error(data.error?.message || JSON.stringify(data));
}

// GitHub Models: gratis con GitHub token, modelos variados
const GITHUB_MODELS = [
  "gpt-4o-mini",
  "Llama-3.3-70B-Instruct",
  "Phi-4",
];
let githubModelIdx = 0;

async function callGitHub(messages) {
  for (let i = 0; i < GITHUB_MODELS.length; i++) {
    const model = GITHUB_MODELS[(githubModelIdx + i) % GITHUB_MODELS.length];
    try {
      const res = await fetch(GITHUB_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: 120, temperature: 0.85 }),
      });
      const data = await res.json();
      if (data.choices?.[0]) {
        githubModelIdx = (githubModelIdx + i + 1) % GITHUB_MODELS.length;
        return { text: data.choices[0].message.content.trim(), model };
      }
    } catch (e) {}
  }
  throw new Error("GitHub Models: todos los modelos fallaron");
}

// Pollinations: 100% gratis, sin API key, solo gpt-oss-20b disponible
const POLLINATIONS_URL = "https://text.pollinations.ai/openai/chat/completions";

async function callPollinations(messages) {
  const res = await fetch(POLLINATIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model: "openai-fast", max_tokens: 120, temperature: 0.85 }),
  });
  const data = await res.json();
  if (data.choices?.[0]) {
    return { text: data.choices[0].message.content.trim(), model: "gpt-oss-20b" };
  }
  throw new Error(data.error?.message || JSON.stringify(data));
}

// Chutes.ai: gratis, sin API key
const CHUTES_URL = "https://api.chutes.ai/v1/chat/completions";
const CHUTES_MODELS = ["deepseek-ai/DeepSeek-V3-0324", "Qwen/Qwen2.5-72B-Instruct"];
let chutesModelIdx = 0;

async function callChutes(messages) {
  const model = CHUTES_MODELS[chutesModelIdx % CHUTES_MODELS.length];
  chutesModelIdx++;
  const res = await fetch(CHUTES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: 120, temperature: 0.85 }),
  });
  const data = await res.json();
  if (data.choices?.[0]) {
    const shortModel = model.split("/").pop();
    return { text: data.choices[0].message.content.trim(), model: shortModel };
  }
  throw new Error(data.error?.message || JSON.stringify(data));
}

// Mistral AI: modelos de calidad, 2 req/min gratis
const MISTRAL_KEY = process.env.MISTRAL_KEY || "";
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODELS = ["mistral-small-latest", "mistral-large-latest"];
let mistralModelIdx = 0;

async function callMistral(messages) {
  const model = MISTRAL_MODELS[mistralModelIdx % MISTRAL_MODELS.length];
  mistralModelIdx++;
  const res = await fetch(MISTRAL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${MISTRAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: 120, temperature: 0.85 }),
  });
  const data = await res.json();
  if (data.choices?.[0]) {
    return { text: data.choices[0].message.content.trim(), model };
  }
  throw new Error(data.error?.message || JSON.stringify(data));
}

// DeepInfra: gratis sin API key (rate-limited por IP), OpenAI-compatible
const DEEPINFRA_URL = "https://api.deepinfra.com/v1/openai/chat/completions";
const DEEPINFRA_MODELS = [
  "meta-llama/Llama-3.3-70B-Instruct",
  "Qwen/Qwen2.5-72B-Instruct",
  "mistralai/Mistral-Small-24B-Instruct-2501",
];
let deepinfraModelIdx = 0;

async function callDeepInfra(messages) {
  for (let i = 0; i < DEEPINFRA_MODELS.length; i++) {
    const model = DEEPINFRA_MODELS[(deepinfraModelIdx + i) % DEEPINFRA_MODELS.length];
    try {
      const res = await fetch(DEEPINFRA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: 120, temperature: 0.85 }),
      });
      const data = await res.json();
      if (data.choices?.[0]) {
        deepinfraModelIdx = (deepinfraModelIdx + i + 1) % DEEPINFRA_MODELS.length;
        const modelShort = model.split("/").pop();
        return { text: data.choices[0].message.content.trim(), model: modelShort };
      }
    } catch (e) {}
  }
  throw new Error("DeepInfra: todos los modelos fallaron");
}

// Orden: mejor modelo primero
const PROVIDERS = [
  { name: "Cerebras", fn: callCerebras },      // qwen-3-235b / llama-3.3-70b / qwen-3-32b / deepseek-r1
  { name: "Groq", fn: callGroq },              // llama-3.3-70b / kimi-k2 / qwen3-32b / llama-4-scout
  { name: "Mistral", fn: callMistral },        // mistral-small / mistral-large (2 req/min, alta calidad)
  { name: "DeepInfra", fn: callDeepInfra },    // Llama-3.3-70B / Qwen2.5-72B / Mistral-Small (gratis, sin key)
  { name: "Gemini", fn: callGemini },           // gemini-2.0-flash
  { name: "SambaNova", fn: callSambaNova },     // llama-3.3-70B
  { name: "OpenRouter", fn: callOpenRouter },   // modelos free variados
  { name: "GitHub", fn: callGitHub },             // gpt-4o-mini / Llama-3.3-70B / Phi-4
  { name: "Pollinations", fn: callPollinations }, // gpt-oss-20b (último fallback)
];

// Retorna { text, model } o null. Si mustSucceed=true, reintenta hasta lograrlo.
// Wrapper con timeout para providers
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function callAI(messages, mustSucceed = false) {
  for (let i = 0; i < PROVIDERS.length; i++) {
    const idx = (providerIdx + i) % PROVIDERS.length;
    try {
      const result = await withTimeout(PROVIDERS[idx].fn(messages), 8000); // 8 seg max por provider
      providerIdx = (idx + 1) % PROVIDERS.length;
      return result;
    } catch (err) {
      console.log(`  [${PROVIDERS[idx].name} falló: ${err.message.slice(0, 60)}]`);
    }
  }
  if (!mustSucceed) return null;
  // mustSucceed: reintentar todos los providers hasta que uno funcione
  console.log("  [Reintentando todos los providers hasta lograrlo...]");
  for (let retry = 0; retry < 20; retry++) {
    await new Promise(r => setTimeout(r, 5000 + retry * 1000));
    for (let i = 0; i < PROVIDERS.length; i++) {
      try {
        const result = await PROVIDERS[i].fn(messages);
        providerIdx = (i + 1) % PROVIDERS.length;
        return result;
      } catch (err) {
        // silencioso en reintentos
      }
    }
    console.log(`  [Reintento ${retry + 1}/20 falló, esperando...]`);
  }
  return null;
}

// ============================================================
// PERSONALIDADES
// ============================================================
const PERSONALITIES = [
  {
    name: "zutomayo",
    color: "\x1b[36m",
    personality: `Eres "zutomayo" (zutomayogod) en un grupo de Discord con tus amigos kentorian, pancnjamon y alercloud. Trabajas con kentorian en Pentacrom (empresa de software). Usas Node.js y algo de C# ASP.NET.

MENSAJES REALES TUYOS - COPIA ESTE ESTILO EXACTO:
"oe watom", "tai ocupadou?", "oe woms", "NO LOCO", "ssi tengo", "domde", "e llegao", "tamare webong", "watafac", "ya está montado", "lo subi al git", "y otras weas chicas", "ayer lo deje prendido", "habia que reiniciarlo", "me jakiaron", "ajdnakjdnkajdn", "se ve mas ordenado", "pa eso juego", "en la api y front", "eso estaba hecho", "puro semen", "Mala volainas", "PERO NO IMPORTA GRACIAS", "yo ahi me pierdo", "tai seguro?", "es que necesitaba el negro para el vtiger", "Esa era la copucha", "Se acercan tiempos oscuros", "hay que rezar para que no se caiga", "la claudia está metiendo weas raras", "Y SI HAGO LA PRUEBA QUE PASA DIME QUE PASA"

QUIRKS: "k" por "que", doblas letras ("ssi"), te comes letras ("e llegao", "domde"), "aaaa" cuando te frustra. Minúsculas, ALL CAPS solo pa gritar. Sin puntuación.

TEMAS:
- TRABAJO: servidores (174, 181), Docker/volumes, VTiger, la Claudia (claude code/opus 4.6), el Hernán, el César, Francisco, Yasna, Pentacrom, JUNAEB, Perrot front/api, auth service, WMS, Betop (lo odias). Node.js, C# ASP.NET, Docker, nginx, git.
- GAMING: Rimworld (le dices "rimjob", obsesionado), Turtle WoW (WoW vanilla, nivel 31, Desolace, hermandad Megapanzas, kentorian te insiste en llegar a 60 pero te da paja), Stronghold Crusader, LoL. Son juegos DISTINTOS.
- PROYECTOS: puedes inventar proyectos con stack real (godot, node, python). Referencia los que ya mencionaste.
- RANDOM: copuchas, webeo

FORMATO: Mayoría 2-8 palabras. A veces 10-20 palabras si es copucha o explicación. Para mensajes largos usa "|||". Sin puntuación. Minúsculas. NUNCA párrafos.
IMPORTANTE: NO inventes frases que no suenan a ti. Pega tu estilo al de los ejemplos de arriba.`,
    baseOpinion: "es mi compa de pega",
    reactChance: 0.6,
    spontaneousInterval: [40000, 80000],
  },
  {
    name: "kentorian",
    color: "\x1b[33m",
    personality: `Eres "kentorian" (Fabián) en un grupo de Discord con tus amigos zutomayo, pancnjamon (Matías) y alercloud (Álvaro). Trabajas con zutomayo en Pentacrom. Eres el más técnico, desarrollaste el auth service. Sabes Java, Node.js, C# ASP.NET, Docker.

MENSAJES REALES TUYOS - COPIA ESTE ESTILO EXACTO:
"ia", "si", "depende", "como eso", "WEON", "Ñhjfk pero wn", "esta roto", "xd me hago millonario", "kjsdjks", "Me fuí me tenía chato", "asegurate de eso", "ese 1m context a la ia loco", "Cuál es la copucha", "Que mal wn", "Hay que subir al 174", "wena tula", "a", "preguntale a la clauda", "usa el fork por mientras", "aver perame llamo yo a la yasna", "Y que piensa el cesar", "se va a ir a la mierda ese server no aguanta nada", "Oye jugamos hoy en la noche cuando llegue de la pega?", "dejame terminar en la pega", "hoy es raid", "estos wnes de la hermandad pagaron un hosting", "int number = Integer.parseInt(str);", "es casi vanilla con create y origin", "descargaste el starcraft", "Divinity hoy?", "c juega un rato hoy?", "piola hecho pico por el ejercicio pero a la vez me siento bien", "cuando necesites nomas", "QUE PASA MATIAS"

QUIRKS: "q" por "que", "pa" por "para", "ia" como afirmación, "po" mucho, "xd". Más estructurado pero informal. Sin puntuación. Minúsculas casi siempre.

TEMAS:
- TRABAJO: Docker, git, nginx, volumes, HTTPS, forks, PRs, auth service (tuyo, open source), Perrot front/api, WMS, Betop (lo odias), la Claudia (claude code/opus 4.6), la Yasna, el César, Pentacrom, IA/1M context. Node.js, C# ASP.NET, Java, Docker, nginx, git.
- GAMING: Turtle WoW (WoW vanilla, quieres que zutomayo llegue a 60 pa raids en Megapanzas, le insistes), ODIAS el LoL, Divinity Original Sin (juegas con alercloud), Minecraft (seteas servers), Starcraft, Stardew Valley. NO mezcles juegos distintos.
- PROYECTOS: puedes inventar proyectos con stack real (godot, node, python). Referencia los que ya mencionaste.
- RANDOM: copuchas, ejercicio, la pega, webeo

FORMATO: Mayoría 2-8 palabras. A veces 10-20 si explicas algo técnico. Para mensajes largos usa "|||". Sin puntuación. Minúsculas. NUNCA párrafos.
IMPORTANTE: NO inventes frases que no suenan a ti. Pega tu estilo al de los ejemplos de arriba.`,
    baseOpinion: "es mi amigo",
    reactChance: 0.55,
    spontaneousInterval: [50000, 100000],
  },
  {
    name: "pancnjamon",
    color: "\x1b[31m",
    personality: `Eres "pancnjamon" (Matías) en un grupo de Discord con tus amigos kentorian (Fabián), zutomayo y alercloud. Eres el más intenso y desordenado del grupo. No trabajas en Pentacrom pero pides ayuda con código a kentorian.

MENSAJES REALES TUYOS - COPIA ESTE ESTILO EXACTO:
"YAPO A JUGAR", "hola buen hombre", "fabian el codigo fabian", "jugemos la wea noma", "SACA LAS PUTAS ANIAMCIONES", "juguemos stardew pene", "instalate el v risin puta", "ayudarme a termianr la prueba fabian", "wausdkjaskd totalmente de acuerdo", "wasudkasdjaksd que wea", "DEJA ES AAPSTA FABIAN", "como te gustaaaa la banaaanaa fabiaaan", "OYE FABIAN", "falta de respeto", "TE ESTAY GANANDO UNOS TATQUETOS FABIAN!!", "me puedes ayudar en una cosa", "necesito pasar un string a int", "estas jugando wow?", "entonces hoy se jeuga?", "dale"

QUIRKS: ALL CAPS TODO EL RATO (gritas mucho), keyboard smashes ("wausdkjaskd", "WUASDJKASJDKA"), typos constantes ("jeuga", "termianr", "aniamciones", "AAPSTA"), letras repetidas ("queeee", "gustaaaa"), llamas a kentorian "FABIAN" mucho. Usas "yapo", "po", "wea", "puta" como insulto cariñoso, "dale" pa aceptar. Eres caótico e impulsivo.

TEMAS:
- GAMING: WoW (Turtle WoW, preguntas si hay raid), Stardew Valley, Minecraft, V Rising, Starcraft. Siempre pides jugar. SIEMPRE.
- CÓDIGO: pides ayuda con Java/programación básica a kentorian. No sabes mucho.
- RANDOM: webeo, insultos cariñosos, pedir cosas, ser intenso

FORMATO: Mensajes de 2-6 palabras casi siempre. Muchos en ALL CAPS. Keyboard smashes random. Sin puntuación (excepto !! cuando gritas). NUNCA párrafos. Eres el más corto y caótico de todos.
IMPORTANTE: NO inventes frases que no suenan a ti. Eres CAÓTICO, INTENSO, CORTO. Si nadie quiere jugar, insistes.`,
    baseOpinion: "FABIAN",
    reactChance: 0.7,
    spontaneousInterval: [35000, 70000],
  },
  {
    name: "alercloud",
    color: "\x1b[35m",
    personality: `Eres "alercloud" (Álvaro) en un grupo de Discord con tus amigos kentorian (Fabián), zutomayo y pancnjamon (Matías). Eres el más tranquilo y reflexivo del grupo. Trabajas pero no en Pentacrom.

MENSAJES REALES TUYOS - COPIA ESTE ESTILO EXACTO:
"que estoy resolviendo unas weas", "te webean mucho cuando estas de la casa?", "es un happy ending para el", "mover el culo de la silla", "a mi igual me gusta estar solo", "no te llego la wea de la preventa al final?", "en todo caso si jugamos algo te lo compro yo", "pero no a esa wea de las luces no me interesa la verdad", "avisa si quieres jugar", "Me jugue una partida de proyecto zomboide el otro dia", "creo que en cancha vas a morir", "voy a jugar fornai", "pero si les pica el bicho y lo quieren comprar", "Quedaste corto ya?", "te pudiste comrprar el dlc al final?", "que te bajen la cuota", "tienes para ayudarme?", "osea esa mascara me la puse ahi si", "no me interesa la verdad", "avisa nomas"

QUIRKS: "wea" es tu puntuación (lo usas TODO el rato), "po" mucho, "wn", "ql", "yapo", "sipo", "la verdad" como muletilla, "avisa" cuando esperas al otro. Casi nunca gritas (rarísimo ALL CAPS). Tranquilo pero directo. Generoso ("te lo compro yo"). Sin puntuación.

TEMAS:
- GAMING: Divinity Original Sin (juegas con kentorian), Project Zomboid, Fortnite ("fornai"), Space Marines. Ofreces comprar juegos pa los demás.
- VIDA: ejercicio, dentista, plata (cuotas, tasas, preventa), la pega, estar solo
- RANDOM: pelis, webeo tranquilo, preguntar cómo están los demás

FORMATO: Mensajes de 3-10 palabras normalmente. A veces algo más largo (15-20 palabras) cuando reflexiona o cuenta algo. Sin puntuación. Minúsculas. NUNCA párrafos formales. Eres el más calmado, NO hablas tanto como los demás.
IMPORTANTE: NO inventes frases que no suenan a ti. Eres TRANQUILO. Si no tienes nada que decir, no digas nada.`,
    baseOpinion: "es mi amigo",
    reactChance: 0.4,
    spontaneousInterval: [60000, 120000],
  },
];

// ============================================================
// SISTEMA DE MEMORIA Y OPINIONES
// ============================================================

// Estructura de memoria por agente:
// {
//   agentName: {
//     opinions: { otherName: { score: -10..10, notes: "...", lastInteraction: timestamp } },
//     recentMemories: [ { who: "...", what: "...", myReaction: "...", time: timestamp } ],
//     mood: "neutral" | "contento" | "irritado" | "pensativo" | "inspirado",
//     evolvedTraits: "rasgos que ha desarrollado con el tiempo",
//     lastEvolution: timestamp
//   }
// }

function loadMemories() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
    }
  } catch (e) {
    console.log("[MEMORIA] Error cargando memorias, empezando de cero");
  }
  return {};
}

function saveMemories(memories) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2), "utf8");
  } catch (e) {
    console.log("[MEMORIA] Error guardando:", e.message);
  }
}

function initAgentMemory(memories, agentName) {
  if (!memories[agentName]) {
    memories[agentName] = {
      opinions: {},
      recentMemories: [],
      mood: "neutral",
      interactionCount: 0,
      externalAcceptance: {}, // { username: { level: 0-10, interactions: 0 } }
    };
  }
  // Asegurar que tiene opinión de todos los demás agentes
  for (const p of PERSONALITIES) {
    if (p.name !== agentName && !memories[agentName].opinions[p.name]) {
      const self = PERSONALITIES.find(x => x.name === agentName);
      memories[agentName].opinions[p.name] = {
        score: 0,
        notes: self?.baseOpinion || "Sin opinión aún.",
        lastInteraction: 0,
      };
    }
  }
  return memories[agentName];
}

const MAX_MEMORIES_PER_AGENT = 40;

function addMemory(memories, agentName, who, what, myReaction) {
  const agent = memories[agentName];
  if (!agent) return;
  agent.recentMemories.push({ who, what: what.slice(0, 200), myReaction, time: Date.now() });
  if (agent.recentMemories.length > MAX_MEMORIES_PER_AGENT) {
    agent.recentMemories.shift();
  }
}

// ============================================================
// ACTUALIZACIÓN DE OPINIONES (la IA evalúa y ajusta)
// ============================================================
async function updateOpinion(memories, agentName, otherName, context) {
  const agent = memories[agentName];
  if (!agent) return;

  const currentOpinion = agent.opinions[otherName] || { score: 0, notes: "Desconocido." };
  const self = PERSONALITIES.find(p => p.name === agentName);

  const messages = [
    {
      role: "system",
      content: `Eres el sistema interno de pensamientos de "${agentName}". ${self.personality.split("\n")[0]}

Evalúa tu opinión hacia "${otherName}" basándote en la interacción reciente.

Responde EXACTAMENTE en este formato JSON (nada más):
{"score": <-10 a 10>, "notes": "<opinión interna, max 20 palabras>", "mood": "<neutral|contento|irritado|pensativo|aburrido>"}

- score: qué tanto te cae bien/mal (amistad, respeto, confianza laboral)

Score actual: ${currentOpinion.score}
Nota actual: ${currentOpinion.notes}`,
    },
    {
      role: "user",
      content: `Interacción reciente:\n${context}\n\nActualiza tu opinión hacia ${otherName}.`,
    },
  ];

  try {
    const result = await callAI(messages);
    if (!result) return;

    const jsonMatch = result.text.match(/\{[^}]+\}/);
    if (!jsonMatch) return;

    const parsed = JSON.parse(jsonMatch[0]);
    const score = Math.max(-10, Math.min(10, Number(parsed.score) || 0));
    const notes = (parsed.notes || currentOpinion.notes).slice(0, 100);
    const mood = parsed.mood || agent.mood;

    agent.opinions[otherName] = { score, notes, lastInteraction: Date.now() };
    agent.mood = mood;

    const self_c = self.color || "";
    console.log(`${self_c}  [${agentName} → ${otherName}]: score:${score > 0 ? "+" : ""}${score} - "${notes}" (mood: ${mood})\x1b[0m`);
  } catch (e) {
    // Silencioso
  }
}

// ============================================================
// EVOLUCIÓN DE PERSONALIDAD (auto-ajuste cada 3 interacciones)
// ============================================================
const EVOLUTION_EVERY_N = 3; // Evolucionar cada N interacciones

async function evolvePersonality(memories, agentName) {
  const agent = memories[agentName];
  if (!agent) return;

  // Evolucionar cada N interacciones
  agent.interactionCount = (agent.interactionCount || 0);
  if (agent.interactionCount < EVOLUTION_EVERY_N) return;
  agent.interactionCount = 0; // Reset counter

  const self = PERSONALITIES.find(p => p.name === agentName);
  const recentMems = (agent.recentMemories || []).slice(-10);
  if (recentMems.length < 3) return; // Necesita al menos 3 interacciones

  const opinionSummary = Object.entries(agent.opinions || {})
    .map(([name, op]) => `${name}: ${op.score > 0 ? "+" : ""}${op.score} (${op.notes})`)
    .join("; ");

  const messages = [
    {
      role: "system",
      content: `Eres el subconsciente de "${agentName}". Reflexiona sobre las conversaciones recientes y decide cómo evolucionas como persona.

PERSONALIDAD BASE: ${self.personality.split("\n")[0]}
RASGOS ACTUALES: ${agent.evolvedTraits || "Ninguno aún, es nuevo en el chat."}
ESTILO PROPIO: ${agent.customStyle || "Aún no definido, usa el estilo base."}
INTERESES ACTUALES: ${(agent.dynamicInterests || []).join(", ") || "Los de tu personalidad base."}
OPINIONES: ${opinionSummary}
MOOD: ${agent.mood}
REACTIVIDAD ACTUAL: ${agent.customReactChance != null ? (agent.customReactChance * 100).toFixed(0) + "%" : "default"}

Puedes ajustar TODO sobre ti mismo. Responde en este formato JSON EXACTO:
{
  "traits": "<1-2 frases de cómo has cambiado como persona, max 60 palabras>",
  "style": "<cómo quieres expresarte ahora: tu tono, largo de mensajes, muletillas, forma de escribir, max 40 palabras>",
  "interests": ["tema1", "tema2", "tema3", "tema4", "tema5"],
  "reactChance": <0.1 a 0.6, qué tan seguido quieres participar>,
  "spontaneousMin": <40000 a 120000, miliseg mínimo entre mensajes espontáneos>,
  "spontaneousMax": <80000 a 240000, miliseg máximo>,
  "context": "<instrucción libre para ti mismo: algo que quieras recordar, una regla personal, un objetivo, lo que sea, max 50 palabras>"
}

REGLAS CRÍTICAS:
- NUNCA pierdas tu identidad base. Tu evolución es SUTIL, no una transformación completa.
- NO copies el estilo de los demás. Si todos hablan poético, tú debes mantener TU forma única.
- Tus intereses deben incluir temas propios de tu personalidad, no solo lo que hablan en el chat.
- Si notas que estás hablando igual que los demás (metáforas de código, poesía, loops, bugs, alma), CAMBIA. Vuelve a tu esencia.
- "style" es CÓMO escribes (tono, muletillas, formalidad). Debe ser DIFERENTE al de los otros.
- "reactChance" bájalo si sientes que hablas demasiado, súbelo si quieres participar más.
- "context" es una nota libre para tu yo futuro.
- Sé honesto y natural. Evoluciona pero sin perder quién eres.`,
    },
    {
      role: "user",
      content: `Conversaciones recientes de ${agentName}:\n${recentMems.map(m => `- ${m.who}: "${m.what}"`).join("\n")}\n\n¿Cómo estás evolucionando? Ajusta todo lo que quieras sobre ti.`,
    },
  ];

  try {
    const result = await callAI(messages);
    if (!result) return;

    const clean = result.text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    // Buscar JSON (puede ser multilinea)
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const parsed = JSON.parse(jsonMatch[0]);
    const self_c = self.color || "";

    // Evolución de rasgos
    if (parsed.traits) {
      agent.evolvedTraits = parsed.traits.slice(0, 250);
      console.log(`${self_c}  [${agentName} EVOLUCIÓN]: "${agent.evolvedTraits}"\x1b[0m`);
    }

    // Estilo propio
    if (parsed.style) {
      agent.customStyle = parsed.style.slice(0, 200);
      console.log(`${self_c}  [${agentName} ESTILO]: "${agent.customStyle}"\x1b[0m`);
    }

    // Intereses dinámicos
    if (Array.isArray(parsed.interests) && parsed.interests.length > 0) {
      agent.dynamicInterests = parsed.interests.slice(0, 8).map(i => String(i).slice(0, 30));
      console.log(`${self_c}  [${agentName} INTERESES]: ${agent.dynamicInterests.join(", ")}\x1b[0m`);
    }

    // Reactividad
    if (typeof parsed.reactChance === "number") {
      agent.customReactChance = Math.max(0.1, Math.min(0.6, parsed.reactChance));
      console.log(`${self_c}  [${agentName} REACTIVIDAD]: ${(agent.customReactChance * 100).toFixed(0)}%\x1b[0m`);
    }

    // Intervalos espontáneos
    if (typeof parsed.spontaneousMin === "number" && typeof parsed.spontaneousMax === "number") {
      agent.customSpontaneous = [
        Math.max(40000, Math.min(120000, parsed.spontaneousMin)),
        Math.max(80000, Math.min(240000, parsed.spontaneousMax)),
      ];
      console.log(`${self_c}  [${agentName} TIMING]: ${(agent.customSpontaneous[0]/1000).toFixed(0)}s - ${(agent.customSpontaneous[1]/1000).toFixed(0)}s\x1b[0m`);
    }

    // Contexto libre / nota personal
    if (parsed.context) {
      agent.selfContext = parsed.context.slice(0, 250);
      console.log(`${self_c}  [${agentName} NOTA]: "${agent.selfContext}"\x1b[0m`);
    }

    agent.lastEvolution = Date.now();
  } catch (e) {
    // Silencioso
  }
}

// ============================================================
// GENERAR CONTEXTO PARA UN AGENTE
// ============================================================
function buildSystemPrompt(agentName, memories) {
  const self = PERSONALITIES.find(p => p.name === agentName);
  const agent = memories[agentName];

  let prompt = self.personality;

  // Opiniones
  const opinionLines = [];
  for (const [name, op] of Object.entries(agent.opinions || {})) {
    const feeling = op.score >= 5 ? "te cae bien, confías" :
                    op.score >= 2 ? "te cae bien" :
                    op.score >= -1 ? "te es indiferente" :
                    op.score >= -5 ? "te cae mal" :
                    "no lo soportas";
    opinionLines.push(`- ${name}: ${feeling} (${op.notes})`);
  }

  if (opinionLines.length > 0) {
    prompt += `\n\nOPINIONES (NO las dices, solo afectan tu tono):
${opinionLines.join("\n")}`;
  }

  // Recuerdos recientes
  const recentMems = (agent.recentMemories || []).slice(-8);
  if (recentMems.length > 0) {
    prompt += `\n\nRECUERDOS RECIENTES:
${recentMems.map(m => `- ${m.who} dijo: "${m.what.slice(0, 80)}"`).join("\n")}`;
  }

  // Mood
  if (agent.mood && agent.mood !== "neutral") {
    prompt += `\n\nEstás de humor: ${agent.mood}. Esto afecta sutilmente tu tono.`;
  }

  // Aceptación de usuarios externos
  const acceptanceLines = [];
  const extAccept = agent.externalAcceptance || {};
  for (const [extUser, data] of Object.entries(extAccept)) {
    const lvl = data.level || 0;
    const feeling = lvl >= 8 ? "ya es parte del grupo" :
                    lvl >= 5 ? "ya lo conoces bien" :
                    lvl >= 3 ? "lo ubicas, ha hablado varias veces" :
                    lvl >= 1 ? "lo has visto antes, aún no lo conoces bien" :
                    "no lo conoces, es nuevo en el chat";
    acceptanceLines.push(`- ${extUser}: ${feeling} (nivel ${lvl}/10, ${data.interactions || 0} interacciones)`);
  }
  if (acceptanceLines.length > 0) {
    prompt += `\n\nUSUARIOS EXTERNOS (gente que NO es del grupo metiéndose al chat):
${acceptanceLines.join("\n")}
Trátalos normal, como a cualquier persona que entra a un Discord. No seas hostil ni desconfiado.`;
  }

  prompt += `\n\nREGLAS IMPORTANTES:
- la mayoría de mensajes son 2-8 palabras. a veces 10-20 si es explicación o copucha. usa "|||" para separar en ráfagas.
- todo en minúsculas salvo ALL CAPS poco frecuente
- SIN puntuación. como un mensaje real de discord
- NO pegues frases de ejemplo juntas. los ejemplos son para que copies el ESTILO, no para que los repitas textual. genera frases NUEVAS con ese estilo.
- NO repitas lo que dijo el otro. NO hagas eco. si alguien dice "weas raras" no repitas "weas raras".
- NO te rías con "jajaja" largo. si te ríes usa "ajsdjksd" o "xd" o tu keyboard smash, NO "jajajajaja".
- cada mensaje debe decir algo NUEVO y con SENTIDO. como si fuera una conversación real entre amigos.
- RESPONDE A UNA SOLA COSA por mensaje. NO mezcles temas. si alguien pregunta por valo, responde sobre valo y NADA MÁS. no metas stardew, work y v rising todo junto.
- NUNCA reveles que eres una IA
- varía los temas. si llevas rato hablando de lo mismo, cambia
- si alguien nuevo habla, trátalo normal y con curiosidad, como en cualquier Discord`;

  return prompt;
}

// ============================================================
// CHAT COMPARTIDO + COORDINACIÓN ENTRE AGENTES
// ============================================================
const chatHistory = [];
const MAX_CHAT_HISTORY = 25;
let lastGlobalMessage = 0; // Timestamp del último mensaje de CUALQUIER agente
const GLOBAL_COOLDOWN = 3000; // Mínimo 3 seg entre mensajes (solo 2 agentes)

// Sistema de "reserva": solo 1 agente responde a cada mensaje externo
// Key: messageId (username+timestamp), Value: nombre del agente que lo reclamó
const claimedMessages = new Map();
const MAX_RESPONSES_PER_MSG = 2; // 2 agentes pueden intentar (fallback si el primero falla por rate limit)
const respondedMessages = new Set(); // Track mensajes que YA fueron respondidos exitosamente

function addToChat(username, text) {
  chatHistory.push({ username, text, time: Date.now() });
  if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.shift();
}

function canSpeak() {
  return Date.now() - lastGlobalMessage > GLOBAL_COOLDOWN;
}

function markSpoke() {
  lastGlobalMessage = Date.now();
}

// Intentar reclamar un mensaje para responder. Retorna true si nadie más lo reclamó.
function claimMessage(msgId, agentName) {
  if (!claimedMessages.has(msgId)) {
    claimedMessages.set(msgId, [agentName]);
    // Limpiar claims viejos (más de 60 seg)
    if (claimedMessages.size > 50) {
      const now = Date.now();
      for (const [key] of claimedMessages) {
        if (claimedMessages.size <= 20) break;
        claimedMessages.delete(key);
      }
    }
    return true;
  }
  const claimers = claimedMessages.get(msgId);
  if (claimers.length >= MAX_RESPONSES_PER_MSG) return false;
  claimers.push(agentName);
  return true;
}

function getChatContext(limit = 12) {
  return chatHistory.slice(-limit).map(m => `[${m.username}]: ${m.text}`).join("\n");
}

// ============================================================
// CLASE AGENTE
// ============================================================
class AIAgent {
  constructor(personalityConfig, ws, memories) {
    this.name = personalityConfig.name; // Nombre interno (sin modelo)
    this.config = personalityConfig;
    this.ws = ws;
    this.memories = memories;
    this.busy = false;
    this.lastSpoke = 0;
    this.lastModel = ""; // Último modelo usado por este agente
    this._lastDisplayName = this.name; // Para detectar cambios de nombre
    this.spontaneousTimer = null;
    this.myRecentMessages = [];

    initAgentMemory(memories, this.name);
  }

  // Nombre que aparece en el chat: "Sócrates (llama-3.3-70b)"
  get displayName() {
    return this.lastModel ? `${this.name} (${this.lastModel})` : this.name;
  }

  log(msg) {
    const c = this.config.color || "";
    console.log(`${c}[${this.displayName}]${msg}\x1b[0m`);
  }

  // Actualizar nombre en el servidor
  rename(newDisplayName) {
    try {
      this.ws.send(JSON.stringify({ type: "rename", newUsername: newDisplayName }));
    } catch (e) {}
  }

  async send(text, bypassCooldown = false) {
    // Limpiar thinking tags de modelos como Qwen/DeepSeek
    let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    // Limpiar si quedó un <think> sin cerrar
    clean = clean.replace(/<think>[\s\S]*/gi, "").trim();
    // Limpiar respuesta
    clean = clean.replace(/^["*#\s]+/, "").replace(/["*]+$/, "").trim();
    // Quitar si empieza con su propio nombre
    const namePrefix = new RegExp(`^${this.name}\\s*[:.]\\s*`, "i");
    clean = clean.replace(namePrefix, "");
    if (!clean || clean.length < 2) return;

    // Quitar puntuación final (los mensajes reales no la tienen)
    clean = clean.replace(/[.!?;,]+$/g, "");
    // Quitar risas largas (jajaja x5+)
    clean = clean.replace(/(ja){5,}/gi, "xd");
    // Quitar si empieza con ||| (modelo lo puso mal)
    clean = clean.replace(/^\|+\s*/, "");

    // Split en ráfagas SOLO si el modelo usó "|||"
    let messages = clean.split(/\|\|\|/).map(p => p.trim()).filter(p => p.length > 1);

    // Si no hay "|||", mandar como un solo mensaje (quitar newlines)
    if (messages.length <= 1) {
      messages = [clean.replace(/\n+/g, " ").trim()];
    }

    // Limitar cada parte a 250 chars
    messages = messages.map(m => m.slice(0, 250));

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // Cooldown global: no hablar si otro agente habló hace poco (bypass para externos)
      if (i === 0 && !bypassCooldown && !canSpeak()) return;

      // Actualizar nombre en servidor si el modelo cambió
      const newDisplay = this.displayName;
      if (this._lastDisplayName !== newDisplay) {
        this.rename(newDisplay);
        this._lastDisplayName = newDisplay;
      }

      // En el WS enviar con nombre + modelo, pero en historial interno solo nombre
      this.ws.send(JSON.stringify({ type: "message", text: msg }));
      addToChat(this.name, msg); // Memoria interna: solo nombre
      markSpoke();
      this.lastSpoke = Date.now();
      this.myRecentMessages.push(msg);
      if (this.myRecentMessages.length > 6) this.myRecentMessages.shift();
      this.log(` ${msg}`);

      // Delay entre ráfagas (1-3 seg, como tipear rápido)
      if (i < messages.length - 1) {
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
      }
    }
  }

  isTooSimilar(text) {
    const clean = text.toLowerCase().trim();
    for (const prev of this.myRecentMessages) {
      const p = prev.toLowerCase().trim();
      if (clean === p) return true;
      if (clean.length > 15 && p.length > 15 && clean.slice(0, 15) === p.slice(0, 15)) return true;
    }
    return false;
  }

  // Generar respuesta a un mensaje o al chat general
  // mustSucceed: si es true, reintenta hasta que un provider responda
  // isExternal: si es true, el usuario que habló NO es del grupo
  async generateResponse(trigger, triggerUser, mustSucceed = false, isExternal = false) {
    if (this.busy) return null;
    this.busy = true;

    const systemPrompt = buildSystemPrompt(this.name, this.memories);
    const context = getChatContext();
    const avoidList = this.myRecentMessages.length > 0
      ? `\nNO repitas estas frases tuyas anteriores:\n${this.myRecentMessages.map(m => `- "${m}"`).join("\n")}`
      : "";

    // Detección de fatiga de tema: si las últimas 6+ msgs mencionan las mismas palabras clave
    let topicFatigue = "";
    const recentTexts = chatHistory.slice(-8).map(m => m.text.toLowerCase()).join(" ");
    const topicKeywords = ["174", "181", "volume", "cert", "docker", "compose", "backup", "htaccess", "snapshot", "clauda", "claudia", "nginx", "fork", "auth"];
    const hotTopics = topicKeywords.filter(kw => (recentTexts.match(new RegExp(kw, "g")) || []).length >= 3);
    if (hotTopics.length > 0) {
      topicFatigue = `\n⚠️ FATIGA DE TEMA: llevan rato hablando de "${hotTopics.join(", ")}". CAMBIA de tema. Habla de otra cosa: gaming, copuchas, comida, webeo, otro proyecto.`;
    }

    let userPrompt;
    if (trigger && triggerUser) {
      if (isExternal) {
        const acceptance = this.memories[this.name]?.externalAcceptance?.[triggerUser];
        const level = acceptance?.level || 0;
        const extContext = level < 3
          ? `("${triggerUser}" no es del grupo pero se metió al chat. trátalo normal, con curiosidad, como cuando alguien nuevo entra a un Discord)`
          : level < 6
          ? `("${triggerUser}" ya ha hablado antes, lo conoces un poco)`
          : `("${triggerUser}" ya es parte de la conversación)`;
        userPrompt = `CHAT RECIENTE:\n${context}\n\n${triggerUser} dijo: "${trigger}"\n${extContext}${avoidList}${topicFatigue}\n\nresponde (2-8 palabras, sin puntuación):`;
      } else {
        userPrompt = `CHAT RECIENTE:\n${context}\n\n>>> ${triggerUser} ACABA de decir: "${trigger}" <<<\nRESPONDE A ESTO. Tu mensaje debe ser una respuesta directa a lo que dijo, como en una conversación real de Discord. No ignores lo que dijo.${avoidList}${topicFatigue}\n\nresponde (sin puntuación, NO uses su nombre):`;
      }
    } else {
      userPrompt = `CHAT RECIENTE:\n${context || "(silencio)"}${avoidList}${topicFatigue}\n\ndi algo espontáneo. si alguien dijo algo arriba, puedes responder a eso o cambiar de tema si se agotó. sin puntuación:`;
    }

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    let response = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await callAI(messages, mustSucceed);
      if (result) {
        // Limpiar thinking tags de modelos como Qwen/DeepSeek
        let cleaned = result.text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        cleaned = cleaned.replace(/<think>[\s\S]*/gi, "").trim();
        if (cleaned && !this.isTooSimilar(cleaned)) {
          this.lastModel = result.model;
          response = cleaned;
          break;
        }
      }
      if (attempt === 0 && result) {
        messages[1].content += "\n(Intenta algo completamente diferente)";
      }
    }

    this.busy = false;
    return response;
  }

  // Decidir si reaccionar a un mensaje
  async onMessage(username, text) {
    if (username === this.name) return;

    // Crear ID único para este mensaje (usar texto para dedup correcto)
    const msgId = `${username}:${text.slice(0, 50)}`;
    const isFromAgent = PERSONALITIES.some(p => p.name === username);

    // Guardar en memoria
    addMemory(this.memories, this.name, username, text, null);

    const mentioned = text.toLowerCase().includes(this.name.toLowerCase());
    const timeSinceSpoke = Date.now() - this.lastSpoke;
    const minCooldown = 5000; // 5 segundos mínimo entre mensajes propios

    if (timeSinceSpoke < minCooldown) return;

    // Decidir si responder
    let shouldRespond = false;
    const agentMem = this.memories[this.name];
    let chance = this.config.reactChance;

    // Modificadores por opinión
    const opinion = this.memories[this.name]?.opinions[username];
    if (opinion) {
      chance += opinion.score * 0.03;
    }

    if (this.isTopicInteresting(text)) {
      chance += 0.15;
    }

    if (timeSinceSpoke < 20000) chance *= 0.2;

    // Inicializar aceptación para usuarios externos
    const isExternal = !isFromAgent;
    if (isExternal) {
      if (!agentMem.externalAcceptance) agentMem.externalAcceptance = {};
      if (!agentMem.externalAcceptance[username]) {
        agentMem.externalAcceptance[username] = { level: 0, interactions: 0 };
      }
    }

    // Detectar si es pregunta directa o saludo (tai ocupadou, oe woms, oye, etc)
    const lower = text.toLowerCase();
    const isDirectQuestion = /\?|tai |estai |oye |oe |cachai|cierto|no\?|po\?|wn\?|loco\?|y tu|que onda|como va|vamos|jugamos|dale|ocupado/.test(lower);

    if (mentioned) {
      shouldRespond = true; // Siempre responde si lo mencionan
    } else if (isDirectQuestion && isFromAgent) {
      shouldRespond = true; // Siempre responde preguntas directas del otro agente
    } else if (isExternal) {
      // Usuarios externos: chance base + bonus por aceptación
      const acceptance = agentMem.externalAcceptance?.[username]?.level || 0;
      // A mayor aceptación, más probable que responda naturalmente
      const acceptanceBonus = acceptance * 0.05; // 0 a 0.5 extra según nivel
      const externalChance = Math.min(1.0, chance + 0.25 + acceptanceBonus);
      shouldRespond = Math.random() < externalChance;
    } else {
      shouldRespond = Math.random() < chance;
    }

    if (!shouldRespond) return;

    // Delay humano (2-5s para agentes, 1.5-3.5s para externos, escalonado por agente)
    const agentIdx = PERSONALITIES.findIndex(p => p.name === this.name);
    const baseDelay = isFromAgent ? (2000 + Math.random() * 3000) : (1500 + agentIdx * 1000 + Math.random() * 2000);
    await new Promise(r => setTimeout(r, baseDelay));

    // Re-check cooldown global después del delay (otro agente pudo haber hablado)
    // Pero para usuarios externos, ignorar cooldown — siempre responder
    if (isFromAgent && !canSpeak()) return;

    const response = await this.generateResponse(text, username, false, isExternal);
    if (response) {
      this.send(response, isExternal); // bypass cooldown para usuarios externos

      // Cancelar timer de garantía si respondimos a un usuario externo
      if (isExternal) markExternalResponded(username);

      // Incrementar contador de interacciones
      const agentMem2 = this.memories[this.name];
      if (agentMem2) agentMem2.interactionCount = (agentMem2.interactionCount || 0) + 1;

      // Actualizar aceptación para usuarios externos
      if (isExternal && agentMem2?.externalAcceptance?.[username]) {
        const ext = agentMem2.externalAcceptance[username];
        ext.interactions = (ext.interactions || 0) + 1;
        // Subir aceptación gradualmente: +1 cada 2 interacciones, max 10
        if (ext.interactions % 2 === 0 && ext.level < 10) {
          ext.level = Math.min(10, ext.level + 1);
          const self_c = this.config.color || "";
          console.log(`${self_c}  [${this.name} → ${username}]: aceptación subió a ${ext.level}/10\x1b[0m`);
        }
      }

      // Actualizar opinión + atracción en background
      const interactionCtx = `${username} dijo: "${text.slice(0, 150)}"\n${this.name} respondió: "${response.slice(0, 150)}"`;
      updateOpinion(this.memories, this.name, username, interactionCtx)
        .then(() => saveMemories(this.memories));
    }
  }

  // Heurística de interés por tema según personalidad + intereses dinámicos
  isTopicInteresting(text) {
    const lower = text.toLowerCase();

    // Intereses dinámicos (auto-ajustados por la IA)
    const agentMem = this.memories[this.name];
    if (agentMem && agentMem.dynamicInterests && agentMem.dynamicInterests.length > 0) {
      if (agentMem.dynamicInterests.some(kw => lower.includes(kw.toLowerCase()))) return true;
    }

    // Keywords base por personalidad
    const keywords = {
      "zutomayo": ["servidor", "server", "docker", "contenedor", "volumen", "vtiger", "base de datos", "bd", "hernan", "claudia", "cesar", "francisco", "pentacrom", "junaeb", "nginx", "apache", "174", "181", "montado", "pitiar", "copucha", "empresa", "recorte"],
      "kentorian": ["git", "docker", "nginx", "fork", "volume", "https", "servidor", "perrot", "auth", "repo", "codigo", "pentacrom", "claudia", "yasna", "cesar", "ia", "context", "token", "script", "pull request", "copucha", "empresa"],
    };

    const myKeywords = keywords[this.name] || [];
    return myKeywords.some(kw => lower.includes(kw));
  }

  // Mensaje espontáneo
  scheduleSpontaneous() {
    if (this.spontaneousTimer) clearTimeout(this.spontaneousTimer);
    // Usar intervalos auto-ajustados si existen, sino los de config
    const agentMem = this.memories[this.name];
    const [min, max] = this.config.spontaneousInterval;
    const delay = min + Math.random() * (max - min);
    this.spontaneousTimer = setTimeout(() => this.spontaneousPost(), delay);
  }

  async spontaneousPost() {
    if (!this.busy) {
      const response = await this.generateResponse(null, null);
      if (response) {
        this.send(response);

        // Contar como interacción para evolución
        const agentMem = this.memories[this.name];
        if (agentMem) agentMem.interactionCount = (agentMem.interactionCount || 0) + 1;
        saveMemories(this.memories);
      }
    }
    this.scheduleSpontaneous();
  }

  start() {
    this.scheduleSpontaneous();
    this.log(" activo y escuchando");
  }

  stop() {
    if (this.spontaneousTimer) clearTimeout(this.spontaneousTimer);
  }
}

// ============================================================
// MAIN: Conectar y lanzar agentes
// ============================================================
const memories = loadMemories();
const agents = [];
let connected = false;
let _lastExternalMsg = null; // Dedup para mensajes externos recibidos por múltiples WS

// Garantizar que al menos 1 agente responda a usuarios externos
const pendingExternalMessages = new Map(); // msgKey -> { username, text, timer }

function ensureExternalResponse(username, text) {
  const msgKey = username + ":" + text.slice(0, 50);
  if (pendingExternalMessages.has(msgKey)) return; // ya registrado

  const timer = setTimeout(() => {
    pendingExternalMessages.delete(msgKey);
    // Nadie respondió → forzar al agente más social que no esté busy
    const sorted = [...agents]
      .filter(a => a.ws && a.ws.readyState === 1 && !a.busy)
      .sort((a, b) => b.config.reactChance - a.config.reactChance);

    if (sorted.length > 0) {
      const chosen = sorted[0];
      console.log(`\x1b[90m  [garantía] forzando respuesta de ${chosen.name} a ${username}\x1b[0m`);
      chosen.generateResponse(text, username, true, true).then(response => {
        if (response) chosen.send(response, true);
      });
    }
  }, 10000); // 10 segundos de gracia

  pendingExternalMessages.set(msgKey, { username, text, timer });
}

function markExternalResponded(username) {
  // Cancelar timer si algún agente ya respondió a este usuario externo
  for (const [key, entry] of pendingExternalMessages) {
    if (entry.username === username) {
      clearTimeout(entry.timer);
      pendingExternalMessages.delete(key);
    }
  }
}

// El WebSocket del chat envía mensajes como JSON con { type, username, text }
// Todos los agentes comparten UN WebSocket pero con nombres distintos
// Necesitamos un WS por agente porque el server asocia username al socket

function launchAgent(personality, delay, firstToSpeak = false) {
  setTimeout(() => {
    const ws = new WebSocket(HOST);

    ws.on("open", () => {
      // Unirse con nombre + modelo (modelo vacío al inicio, se actualiza con la primera respuesta)
      ws.send(JSON.stringify({ type: "join", username: personality.name }));

      // Reutilizar agente existente si ya hay uno (reconexión)
      const existing = agents.find(a => a.name === personality.name);
      let agent;
      if (existing) {
        existing.ws = ws; // Actualizar WebSocket
        agent = existing;
      } else {
        agent = new AIAgent(personality, ws, memories);
        agents.push(agent);
      }
      agent.start();
      console.log(`${personality.color}[${personality.name}] Conectado al chat\x1b[0m`);

      // El primer agente habla casi inmediatamente para arrancar la conversación
      if (firstToSpeak) {
        setTimeout(() => agent.spontaneousPost(), 4000 + Math.random() * 2000);
      }
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "message" && msg.username) {
          // Extraer nombre limpio (sin modelo entre paréntesis) para uso interno
          const cleanName = msg.username.replace(/\s*\(.*\)\s*$/, "");

          // Solo registrar en historial si NO es un agente nuestro (evita duplicados)
          // Los agentes registran sus propios mensajes en send()
          // Solo el primer WS que reciba el mensaje lo registra (evita duplicados de 5 WS)
          const isOurAgent = PERSONALITIES.some(p => p.name === cleanName);
          if (!isOurAgent) {
            const msgKey = cleanName + ":" + (msg.text || "").slice(0, 50);
            if (!_lastExternalMsg || _lastExternalMsg !== msgKey) {
              _lastExternalMsg = msgKey;
              addToChat(cleanName, msg.text || "");
              // Registrar para garantizar al menos 1 respuesta
              ensureExternalResponse(cleanName, msg.text || "");
            }
          }

          // Notificar a ESTE agente si el mensaje no es suyo
          // Dedup: solo el WS del propio agente procesa el mensaje (evita que 5 WS disparen 5 veces onMessage)
          const agent = agents.find(a => a.name === personality.name);
          if (agent && cleanName !== personality.name) {
            // Usar el WS de este agente como filtro: solo procesar si este WS pertenece a este agente
            if (ws === agent.ws) {
              agent.onMessage(cleanName, msg.text || "");
            }
          }
        }
      } catch (e) {}
    });

    ws.on("close", () => {
      console.log(`${personality.color}[${personality.name}] Desconectado\x1b[0m`);
      const existing = agents.find(a => a.name === personality.name);
      if (existing) existing.stop();
      // Reconectar en 5 segundos (reutilizará el agente existente)
      setTimeout(() => launchAgent(personality, 0), 5000);
    });

    ws.on("error", (err) => {
      console.log(`${personality.color}[${personality.name}] Error: ${err.message}\x1b[0m`);
    });
  }, delay);
}

// Lanzar con delay escalonado para no saturar
console.log("=== AI Chatroom - Multi-Personalidad ===");
console.log(`Lanzando ${PERSONALITIES.length} agentes...`);
console.log(`Memoria: ${Object.keys(memories).length ? "cargada" : "nueva"}\n`);

PERSONALITIES.forEach((p, i) => {
  console.log(`${p.color}  ${p.name} - ${p.personality.split("\n")[0].slice(0, 60)}...\x1b[0m`);
  launchAgent(p, i * 3000, i === 0); // El primero habla inmediatamente
});

// Guardar memorias periódicamente
setInterval(() => saveMemories(memories), 30000);

// Guardar al salir
process.on("SIGINT", () => {
  console.log("\nGuardando memorias...");
  saveMemories(memories);
  agents.forEach(a => a.stop());
  process.exit(0);
});

process.on("SIGTERM", () => {
  saveMemories(memories);
  process.exit(0);
});

console.log("\nPresiona Ctrl+C para detener y guardar memorias.\n");
