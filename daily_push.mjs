#!/usr/bin/env node
/**
 * 每日 14:50 推送 — 由 run_daily_push.sh 调用（环境变量由外层传入）
 */

import https from "https";
import http from "http";

const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK_URL;
const DEEPSEEK_KEY   = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_BASE  = "https://api.deepseek.com";

function apiPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const mod = urlObj.protocol === "https:" ? https : http;
    const req = mod.request(urlObj, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
    }, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0,200)}`)); }
      });
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

// ── DeepSeek ────────────────────────────────────
async function chat(messages, system) {
  const msgs = system ? [{ role: "system", content: system }, ...messages] : messages;
  const res = await apiPost(`${DEEPSEEK_BASE}/chat/completions`, {
    Authorization: `Bearer ${DEEPSEEK_KEY}`,
  }, { model: DEEPSEEK_MODEL, messages: msgs, max_tokens: 4096 });
  return res.choices?.[0]?.message?.content || "";
}

// ── 新闻（含内容摘要）────────────────────────────
async function fetchNews() {
  const rssUrls = [
    "https://hnrss.org/frontpage?count=15",
    "https://techcrunch.com/category/artificial-intelligence/feed/",
  ];
  let rawText = "";
  for (const url of rssUrls) {
    try {
      const xml = await fetchUrl(url);
      // 提取每个 item 的 title + description
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      const name = url.includes("hnrss") ? "HN" : "TechCrunch";
      for (const item of items.slice(0, 8)) {
        const content = item[1];
        const title = content.match(/<title>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?<\/title>/);
        const desc  = content.match(/<description>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?<\/description>/);
        if (title) {
          rawText += `[${name}] ${title[1].trim()}\n`;
          if (desc) {
            const clean = desc[1].replace(/<[^>]+>/g, '').replace(/&#?\w+;/g, ' ').trim().slice(0, 200);
            if (clean) rawText += `    ${clean}\n`;
          }
        }
      }
    } catch { /* skip failed source */ }
  }
  return await chat([
    { role: "user", content: `以下是一些今日 AI/科技新闻（含摘要），请从中选出最有价值的 5 条，用中文整理为清晰列表。每条格式：\n\n1. 🔹 [主题]\n   一句话概括要点\n   关键细节：xxx\n\n素材：\n${rawText}` }
  ], "你是专业的 AI 科技编辑，擅长提炼新闻核心信息并简明呈现。");
}

// ── 美句 ─────────────────────────────────────────
async function fetchSentence() {
  const text = await chat([
    { role: "user", content: "写一句美丽的中文短句（40字以内），关于生活、自然、成长或希望。要有画面感和意境。同时给出简短的英文翻译。\n\n回复格式示例：\n【美句】日落跌进昭昭星野。\n【Translation】The sunset falls into the vast starry field." }
  ], "你是富有诗意的文学创作者，擅长用简洁优美的文字表达意境。");

  let zh = "", en = "";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("【美句】")) {
      zh = t.replace("【美句】", "").trim();
    } else if (t.startsWith("【Translation】")) {
      en = t.replace("【Translation】", "").trim();
    }
  }
  // 如果没按格式返回，用整个内容作为后备
  if (!zh) {
    const lines = text.split("\n").filter(l => l.trim() && !l.includes("【"));
    zh = lines[0] || "每一天都是一个新的开始。";
    en = lines[1] || "Every day is a new beginning.";
  }
  return { zh, en };
}

// ── 飞书推送 ─────────────────────────────────────
async function sendFeishu(news, zh, en, dateStr) {
  const elements = [
    { tag: "div", text: { tag: "lark_md", content: `**🤖 AI 科技动态**\n${news}` } },
    { tag: "hr" },
    { tag: "div", text: { tag: "lark_md", content: `**📖 每日美句**\n${zh}\n\n*${en}*` } },
  ];
  return await apiPost(FEISHU_WEBHOOK, {}, {
    msg_type: "interactive",
    card: {
      header: { title: { tag: "plain_text", content: `☀️ ${dateStr} AI 速递 + 每日美句` }, template: "blue" },
      elements,
    },
  });
}

// ── main ─────────────────────────────────────────
async function main() {
  const errs = [];
  if (!FEISHU_WEBHOOK) errs.push("❌ 缺少 FEISHU_WEBHOOK_URL");
  if (!DEEPSEEK_KEY) errs.push("❌ 缺少 DEEPSEEK_API_KEY");
  if (errs.length) { console.error(errs.join("\n")); process.exit(1); }

  const dateStr = new Date().toLocaleDateString("zh-CN", {
    year: "numeric", month: "long", day: "numeric",
  });

  console.log("🔍 获取 AI 新闻（含摘要）…");
  let news;
  try {
    news = await fetchNews();
    console.log("✅");
  } catch (e) {
    console.error("⚠️ 新闻获取失败:", e.message);
    news = "今日新闻获取暂不可用。";
  }

  console.log("📝 生成每日美句…");
  let zh, en;
  try {
    ({ zh, en } = await fetchSentence());
    console.log(`   「${zh}」`);
  } catch (e) {
    console.error("⚠️ 美句生成失败:", e.message);
    zh = "每一天都是一个新的开始。";
    en = "Every day is a new beginning.";
  }

  console.log("📤 推送到飞书…");
  await sendFeishu(news, zh, en, dateStr);
  console.log("✅ 推送成功！");
}

main().catch(e => { console.error("❌ 运行失败:", e); process.exit(1); });
