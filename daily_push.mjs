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
    const req = mod.request(urlObj, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers }
    }, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error("HTTP " + res.statusCode)); }
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

async function chat(messages, system) {
  const msgs = system ? [{ role: "system", content: system }, ...messages] : messages;
  const res = await apiPost(DEEPSEEK_BASE + "/chat/completions", {
    Authorization: "Bearer " + DEEPSEEK_KEY
  }, { model: DEEPSEEK_MODEL, messages: msgs, max_tokens: 4096 });
  return res.choices?.[0]?.message?.content || "";
}

async function fetchNews() {
  const urls = [
    "https://hnrss.org/frontpage?count=15",
    "https://techcrunch.com/category/artificial-intelligence/feed/"
  ];
  let raw = "";
  for (const url of urls) {
    try {
      const xml = await fetchUrl(url);
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      const src = url.includes("hnrss") ? "HN" : "TC";
      for (const item of items.slice(0, 8)) {
        const c = item[1];
        const t = c.match(/<title>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?<\/title>/);
        const d = c.match(/<description>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?<\/description>/);
        if (t) { raw += "[" + src + "] " + t[1].trim() + "\n"; }
        if (d) { const cl = d[1].replace(/<[^>]+>/g,"").trim().slice(0, 200); if (cl) raw += "    " + cl + "\n"; }
      }
    } catch {}
  }
  return await chat([{ role: "user", content: "以下是一些今日AI科技新闻，请选出最有价值的5条，用中文整理为清晰列表：\n\n1. 🔹 [主题]\n   要点\n   细节\n\n素材：\n" + raw }], "你是专业的AI科技编辑。");
}
async function fetchSentence() {
  const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(),0,0)) / 86400000);
  const theme = THEMES[doy % THEMES.length];
  const text = await chat([{ role: "user", content: "今天是\"" + theme + "\"主题日。请从知名作家诗人的金句中，选一句与\"" + theme + "\"相关的名言。\n\n【美句】\"名言\" —— 作者\n【Translation】英文翻译" }], "你是文学修养深厚的读书人。");
  let zh = "", en = "";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("【美句】")) zh = t.slice(4).trim();
    else if (t.startsWith("【Translation】")) en = t.slice(14).trim();
  }
  if (!zh) { zh = "生活不能等待别人来安排，要自己去争取和奋斗。—— 路遥"; }
  return { zh, en };
}

async function sendFeishu(news, zh, en, dateStr) {
  return await apiPost(FEISHU_WEBHOOK, {}, {
    msg_type: "interactive",
    card: {
      header: { title: { tag: "plain_text", content: "☀️ " + dateStr + " AI速递+每日金句" }, template: "blue" },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: "**🤖 AI科技动态**\n" + news } },
        { tag: "hr" },
        { tag: "div", text: { tag: "lark_md", content: "**📖 每日金句**\n" + zh + "\n\n*" + en + "*" } }
      ]
    }
  });
}

async function main() {
  if (!FEISHU_WEBHOOK || !DEEPSEEK_KEY) { console.error("缺少环境变量"); process.exit(1); }
  const dateStr = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  console.log("新闻…"); let news; try { news = await fetchNews(); console.log("OK"); } catch { news = "今日新闻暂不可用。"; }
  console.log("金句…"); let zh, en; try { ({ zh, en } = await fetchSentence()); console.log(zh); } catch { zh = "生活不能等待别人来安排，要自己去争取和奋斗。—— 路遥"; en = ""; }
  console.log("飞书…"); await sendFeishu(news, zh, en, dateStr); console.log("OK");
}
main().catch(e => { console.error("失败", e); process.exit(1); });
