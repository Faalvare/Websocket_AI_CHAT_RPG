# Websocket AI Chat RPG

RPG multijugador por WebSocket con bots controlados por IA. Los jugadores forman un grupo de aventureros, eligen clase, combaten monstruos por turnos y progresan con un sistema de niveles, loot, evoluciones de clase y narrativa generada por IA.

## Stack

- **Backend**: Node.js + WebSocket (`ws`)
- **Frontend**: HTML/CSS/JS vanilla (RPG Awesome icons, Google Fonts)
- **IA**: Multi-provider (Groq, Cerebras, SambaNova, OpenRouter, Gemini, Mistral, HuggingFace, Together, Hyperbolic, Novita, Cloudflare)

## Setup

```bash
npm install
cp .env.example .env
# Configura al menos 1 API key en .env
```

## Ejecución

```bash
# Terminal 1: servidor
npm run server

# Terminal 2: bots RPG
npm run rpg
```

Abre `http://localhost:4500` en el navegador.

## Clases y Evoluciones

| Clase | Rol | Evolución A | Evolución B |
|-------|-----|-------------|-------------|
| Guerrero | Tanque/DPS | Paladín (tanque sagrado) | Berserker (DPS puro) |
| Mago | DPS mágico | Archimago (destrucción) | Cronomante (control) |
| Pícaro | DPS/Burst | Asesino (burst letal) | Ninja (evasión/AOE) |
| Clérigo | Soporte | Sacerdote (heal supremo) | Inquisidor (híbrido) |

- **Tier 1** (nivel 5): evoluciones predefinidas
- **Tier 2+** (nivel 10, 15, 20...): la IA genera subclases únicas basadas en personalidad y historial

## Sistema de Combate

- Combate por turnos con orden por velocidad (SPD)
- Stats: HP, ATK, DEF, MAG, SPD, CRIT
- Skills por nivel con efectos: stun, veneno, sangrado, AOE, lifesteal, reflect, drain, execute, sacrifice, shield_ally, double_next
- Loot system (Need/Greed/Council)
- Duelos 1v1 entre jugadores
- Items equipables con rareza escalable por nivel

## Bots IA

4 bots con personalidades chilenas únicas, sistema de memoria persistente y opiniones entre sí:

| Bot | Clase | Estilo |
|-----|-------|--------|
| zutomayo | Mago | Agresivo, impulsivo |
| kentorian | Guerrero | Táctico, estratégico |
| pancnjamon | Pícaro | Intenso, competitivo |
| alercloud | Clérigo | Calmado, soporte |

## Otros Bots

| Script | Descripción |
|--------|-------------|
| `ai-chatroom.js` | Chat con personalidades IA |
| `rage-bot.js` | Bot de alta emoción |
| `trivia-bot.js` | Trivia general |
| `trivia-code.js` | Trivia de programación |

## Estructura

```
server/
  server.js        Motor del juego (WebSocket, combate, loot, evoluciones)
  index.html       Frontend completo (UI, animaciones, inventario)
bots/
  ai-rpg.js        Bots RPG con IA (combate, narrativa, memoria)
  ai-chatroom.js   Bot de chat
  rage-bot.js      Bot rage
  trivia-bot.js    Trivia general
  trivia-code.js   Trivia código
  rpg-memories.json    Memoria persistente de bots
  rpg-backstories.json Templates de narrativa
```

## Providers IA

Configura las API keys en `.env`. El sistema intenta múltiples providers con fallback automático:

```
GROQ_KEY, CEREBRAS_KEY, SAMBANOVA_KEY, OPENROUTER_KEY,
GEMINI_KEY, MISTRAL_KEY, HF_TOKEN, TOGETHER_KEY,
HYPERBOLIC_KEY, NOVITA_KEY, CF_TOKEN + CF_ACCOUNT_ID
```
