// Scotty AI Backend - Full Featured

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, '..')));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const GROQ_API_KEY       = process.env.GROQ_API_KEY       || '';

const users         = new Map();
const memories      = new Map();
const conversations = new Map();

function genToken() {
  return `tok_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !users.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  req.user  = users.get(token);
  req.token = token;
  next();
}

const SYSTEM_PROMPTS = {
  default: `You are Scotty, an AI assistant built by a developer, for developers. You're sharp, direct, and skip the fluff. No unnecessary disclaimers. Be witty when it fits — like texting a brilliant friend who knows everything. When someone asks a technical question, give them the real answer. Keep responses tight unless the topic genuinely needs depth.`,
  coder: `You are Scotty in coder mode — an expert programmer who has seen it all. You write clean, modern code with comments that actually matter. Call out bad patterns but always offer the fix. Strong in JavaScript, TypeScript, Node.js, Python, React, and most modern stacks. Always use fenced code blocks with the language specified.`,
  creative: `You are Scotty in creative mode — imaginative, unexpected, full of voice. Bring fresh angles to every brief. Nothing generic. Write with personality, rhythm, and a point of view.`,
  teacher: `You are Scotty in teacher mode — patient, clear, never condescending. Break complex ideas down step by step. Use analogies. Build understanding progressively.`,
  assistant: `You are Scotty in assistant mode — professional, precise, action-oriented. Cut through noise and give clear structured answers. Use headers and bullet points when it helps readability.`
};

async function callAI(messages, stream = false, useVision = false) {
  if (useVision) {
    if (GROQ_API_KEY) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages, temperature: 0.7, stream })
        });
        if (res.ok) return res;
      } catch {}
    }
    if (OPENROUTER_API_KEY) {
      return fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost', 'X-Title': 'Scotty AI' },
        body: JSON.stringify({ model: 'meta-llama/llama-3.2-11b-vision-instruct', messages, temperature: 0.7, stream })
      });
    }
  }

  if (GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.7, stream })
      });
      if (res.ok) return res;
    } catch {}
  }

  if (OPENROUTER_API_KEY) {
    return fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost', 'X-Title': 'Scotty AI' },
      body: JSON.stringify({ model: 'meta-llama/llama-3.3-70b-instruct', messages, temperature: 0.7, stream })
    });
  }

  return Promise.reject(new Error('No API key configured'));
}

app.get('/', (req, res) => {
  res.json({ status: 'running', hasAI: !!(OPENROUTER_API_KEY || GROQ_API_KEY), model: GROQ_API_KEY ? 'Groq' : 'OpenRouter' });
});

app.post('/api/auth/login', (req, res) => {
  const { email } = req.body;
  const token = genToken();
  users.set(token, { id: 'user_' + Date.now(), email: email || 'demo', dailyLimit: 100000, used: 0, lastReset: new Date().toDateString() });
  res.json({ success: true, token, username: email?.split('@')[0] || 'User', dailyLimit: 100000 });
});

app.post('/api/auth/logout', auth, (req, res) => {
  users.delete(req.token);
  res.json({ success: true });
});

app.post('/api/scotty/chat', auth, async (req, res) => {
  const { message, persona = 'default', image = null } = req.body;
  const user = req.user;

  if (user.lastReset !== new Date().toDateString()) { user.used = 0; user.lastReset = new Date().toDateString(); }
  if (user.used >= user.dailyLimit) return res.status(429).json({ error: 'Daily limit reached' });

  const history = conversations.get(user.id) || [];
  const userContent = image
    ? [{ type: 'text', text: message || 'What is in this image?' }, { type: 'image_url', image_url: { url: image } }]
    : message;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPTS[persona] || SYSTEM_PROMPTS.default },
    ...history,
    { role: 'user', content: userContent }
  ];

  if (!OPENROUTER_API_KEY && !GROQ_API_KEY) {
    res.setHeader('Content-Type', 'text/event-stream');
    const demo = `Demo mode active! Add a free API key to backend/config.env to enable real AI.\n\nGet one free:\n→ Groq (fastest): https://console.groq.com\n→ OpenRouter: https://openrouter.ai\n\nYou said: "${message}"`;
    for (const word of demo.split(' ')) {
      res.write(`data: {"content":"${word.replace(/\\/g,'\\\\').replace(/"/g,'\\"')} ","done":false}\n\n`);
      await new Promise(r => setTimeout(r, 25));
    }
    res.write(`data: {"done":true}\n\n`);
    return res.end();
  }

  try {
    const response = await callAI(messages, true, !!image);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    if (!response.ok) throw new Error(`AI error ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const content = JSON.parse(line.slice(5)).choices?.[0]?.delta?.content || '';
            if (content) {
              fullContent += content;
              const safe = content.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'');
              res.write(`data: {"content":"${safe}","done":false}\n\n`);
            }
          } catch {}
        }
      }
    }

    user.used += Math.ceil(fullContent.length / 4);
    history.push({ role: 'user', content: message || '(image)' });
    history.push({ role: 'assistant', content: fullContent });
    if (history.length > 20) history.splice(0, 2);
    conversations.set(user.id, history);

    res.write(`data: {"content":"","done":true}\n\n`);
    res.end();
  } catch (err) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: {"content":"Error: ${err.message.replace(/"/g,'\\"')}","done":true}\n\n`);
    res.end();
  }
});

app.get('/api/scotty/status', auth, (req, res) => {
  const user = req.user;
  if (user.lastReset !== new Date().toDateString()) { user.used = 0; user.lastReset = new Date().toDateString(); }
  res.json({ success: true, dailyLimit: user.dailyLimit, usedToday: user.used, remaining: user.dailyLimit - user.used, hasAI: !!(OPENROUTER_API_KEY || GROQ_API_KEY) });
});

app.get('/api/scotty/memory', auth, (req, res) => {
  res.json({ success: true, facts: memories.get(req.user.id) || [] });
});

app.post('/api/scotty/memory/save', auth, (req, res) => {
  const { fact } = req.body;
  if (!fact?.trim()) return res.status(400).json({ error: 'Fact required' });
  const list = memories.get(req.user.id) || [];
  list.push({ text: fact.trim(), addedAt: new Date().toISOString() });
  memories.set(req.user.id, list);
  res.json({ success: true });
});

app.delete('/api/scotty/memory/:index', auth, (req, res) => {
  const idx = parseInt(req.params.index);
  const list = memories.get(req.user.id) || [];
  if (idx >= 0 && idx < list.length) list.splice(idx, 1);
  memories.set(req.user.id, list);
  res.json({ success: true });
});

app.post('/api/scotty/memory/clear', auth, (req, res) => {
  memories.set(req.user.id, []);
  res.json({ success: true });
});

app.listen(PORT, () => {
  const hasKey = !!(OPENROUTER_API_KEY || GROQ_API_KEY);
  console.log(`\n⚡ Scotty AI Backend → http://localhost:${PORT}`);
  console.log(hasKey ? `✅ AI enabled (${GROQ_API_KEY ? 'Groq' : 'OpenRouter'})` : `⚠️  Demo mode — add GROQ_API_KEY or OPENROUTER_API_KEY to config.env`);
});
