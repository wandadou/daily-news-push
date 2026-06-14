#!/usr/bin/env node
import https from "https";
import http from "http";

const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK_URL;
const DEEPSEEK_KEY   = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_BASE  = "https://api.deepseek.com";

const THEMES = [
  "孤独与自我", "月光与故乡", "爱与温暖",
  "时间与青春", "勇气与远方", "读书与智慧",
  "平凡与幸福"
];

function apiPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const mod = urlObj.protocol === "https:" ? https : http;
    const req = mod.request(urlObj, { method: "POST", headers: { "Content-Type": "application/json", ...headers } }, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0,200)}`)); } });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const mod = urlObj.protocol === "https:" ? https : http;
    mod.get(urlObj, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => resolve(raw));
    }).on("error", reject);
  });
}

async function chat(messages, system) {
  const msgs = system ? [{ role: "system", content: system }, ...messages] : messages;
  const res = await apiPost(`${DEEPSEEK_BASE}/chat/completions`, { Authorization: `Bearer ${DEEPSEEK_KEY}` }, { model: DEEPSEEK_MODEL, messages: msgs, max_tokens: 4096 });
  return res.choices?.[0]?.message?.content || "";
}

async function fetchNews() {
  const rssUrls = ["https://hnrss.org/frontpage?count=15", "https://techcrunch.com/category/artificial-intelligence/feed/"];
  let rawText = "";
  for (const url of rssUrls) {
    try {
      const xml = await fetchUrl(url);
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      const name = url.includes("hnrss") ? "HN" : "TechCrunch";
      for (const item of items.slice(0, 8)) {
        const c = item[1], title = c.match(/<title>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?<\/title>/), desc = c.match(/<description>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?<\/description>/);
        if (title) { rawText += `[${name}] ${title[1].trim()}\n`; if (desc) { const cl = desc[1].replace(/<[^>]+>/g,'').replace(/&#?\w+;/g,' ').trim().slice(0,200); if(cl) rawText += `    ${cl}\n`; } }
      }
    } catch {}
  }
  return await chat([{ role: "user", content: `以下是一些今日 AI/科技新闻（含摘要），请从中选出最有价值的 5 条，用中文整理为清晰列表。每条格式：\n\n1. 🔹 [主题]\n   一句话概括要点\n   关键细节：xxx\n\n素材：\n${rawText}` }], "你是专业的 AI 科技编辑。");
}

async function fetchSentence() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(),0,0)) / 86400000);
  const todayTheme = THEMES[dayOfYear % THEMES.length];
  const text = await chat([{ role: "user", content: `今天是"${todayTheme}"主题日。请从知名作家、诗人（如村上春树、加缪、博尔赫斯、史铁生、林清玄等）的金句中，选一句与"${todayTheme}"相关的经典名言。\n\n回复格式：\n【美句】"名言原文" —— 作者\n【Translation】英文翻译` }], "你是文学修养深厚的读书人。");
  let zh = "", en = "";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("【美句】")) zh = t.replace("【美句】","").trim();
    else if (t.startsWith("【Translation】")) en = t.replace("【Translation】","").trim();
  }
  if (!zh) { const lines = text.split("\n").filter(l => l.trim() && !l.includes("【")); zh = lines[0] || "生活不能等待别人来安排，要自己去争取和奋斗。—— 路遥"; en = lines[1] || ""; }
  return { zh, en };
}

async function sendFeishu(news, zh, en, dateStr) {
  return await apiPost(FEISHU_WEBHOOK, {}, {
    msg_type: "interactive",
    card: {
      header: { title: { tag: "plain_text", content: `☀️ ${dateStr} AI 速递 + 每日金句` }, template: "blue" },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: `**🤖 AI 科技动态**\n${news}` } },
        { tag: "hr" },
        { tag: "div", text: { tag: "lark_md", content: `**📖 每日金句**\n${zh}\n\n*${en}*` } },
      ],
    },
  });
}

async function main() {
  if (!FEISHU_WEBHOOK || !DEEPSEEK_KEY) { console.error("❌ 缺少环境变量"); process
