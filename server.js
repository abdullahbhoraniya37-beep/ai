const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const state = {
  settings: {
    appName: "AI Workspace",
    aiName: "AI Assistant",
    primaryProvider: "groq",
    fallbackProvider: "openrouter",
    groqModel: "llama-3.3-70b-versatile",
    openrouterModel: "openai/gpt-oss-20b:free",
    systemPrompt: "You are a helpful, accurate and professional AI assistant.",
    dailyLimit: 50,
    monthlyLimit: 1000,
    groqEnabled: Boolean(process.env.GROQ_API_KEY),
    openrouterEnabled: Boolean(process.env.OPENROUTER_API_KEY)
  },
  users: [],
  conversations: [],
  usage: [],
  logs: []
};

const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
const adminPassword = process.env.ADMIN_PASSWORD || "ChangeMe123!";

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-only-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 86400000 }
}));
app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Authentication required." });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") return res.status(403).json({ error: "Admin access required." });
  next();
}
function safeUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt, lastActive: u.lastActive };
}
function providerEnabled(p) {
  return p === "groq" ? state.settings.groqEnabled && !!process.env.GROQ_API_KEY : state.settings.openrouterEnabled && !!process.env.OPENROUTER_API_KEY;
}
async function callProvider(provider, messages, model) {
  const url = provider === "groq" ? "https://api.groq.com/openai/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
  const key = provider === "groq" ? process.env.GROQ_API_KEY : process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Provider API key is not configured.");
  const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${key}` };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost:" + PORT;
    headers["X-Title"] = state.settings.appName;
  }
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages, temperature: 0.7 })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `Provider returned HTTP ${r.status}`);
  return data?.choices?.[0]?.message?.content || "The provider returned an empty response.";
}
async function generateAI(messages) {
  const order = [state.settings.primaryProvider];
  if (state.settings.fallbackProvider && state.settings.fallbackProvider !== "none") order.push(state.settings.fallbackProvider);
  let last;
  for (const provider of order) {
    if (!providerEnabled(provider)) continue;
    const model = provider === "groq" ? state.settings.groqModel : state.settings.openrouterModel;
    try {
      const content = await callProvider(provider, messages, model);
      return { content, provider, model };
    } catch (e) { last = e; state.logs.unshift({time:new Date().toISOString(), type:"provider_error", provider, error:e.message}); }
  }
  throw last || new Error("No AI provider is configured. Add a Groq or OpenRouter API key in the Admin Panel.");
}

app.post("/api/auth/register", async (req,res) => {
  const {name,email,password} = req.body;
  if (!name || !email || !password || password.length < 6) return res.status(400).json({error:"Enter a name, valid email and password of at least 6 characters."});
  if (state.users.some(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({error:"An account with this email already exists."});
  const user = {id: crypto.randomUUID(), name, email:email.toLowerCase(), password:await bcrypt.hash(password,10), role:"user", status:"active", createdAt:new Date().toISOString(), lastActive:new Date().toISOString()};
  state.users.push(user);
  req.session.user = safeUser(user);
  res.json({user:req.session.user});
});

app.post("/api/auth/login", async (req,res) => {
  const {email,password} = req.body;
  if (email === adminEmail && password === adminPassword) {
    req.session.user = {id:"admin",name:"Administrator",email:adminEmail,role:"admin",status:"active"};
    return res.json({user:req.session.user});
  }
  const user = state.users.find(u => u.email === String(email||"").toLowerCase());
  if (!user || !(await bcrypt.compare(password || "", user.password))) return res.status(401).json({error:"Invalid email or password."});
  if (user.status === "blocked") return res.status(403).json({error:"Your account has been blocked by an administrator."});
  user.lastActive = new Date().toISOString();
  req.session.user = safeUser(user);
  res.json({user:req.session.user});
});
app.post("/api/auth/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/auth/me",(req,res)=>res.json({user:req.session.user||null}));

app.get("/api/config", (req,res)=>res.json({
  appName:state.settings.appName, aiName:state.settings.aiName,
  primaryProvider:state.settings.primaryProvider,
  model:state.settings.primaryProvider==="groq"?state.settings.groqModel:state.settings.openrouterModel,
  aiOnline: providerEnabled("groq") || providerEnabled("openrouter")
}));

app.get("/api/chats", requireAuth, (req,res)=>{
  const chats = state.conversations.filter(c=>c.userId===req.session.user.id).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
  res.json({chats});
});
app.post("/api/chats", requireAuth, (req,res)=>{
  const c={id:crypto.randomUUID(),userId:req.session.user.id,title:req.body.title||"New conversation",messages:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  state.conversations.push(c); res.json({chat:c});
});
app.get("/api/chats/:id", requireAuth,(req,res)=>{
  const c=state.conversations.find(x=>x.id===req.params.id && x.userId===req.session.user.id);
  if(!c) return res.status(404).json({error:"Conversation not found."}); res.json({chat:c});
});
app.patch("/api/chats/:id", requireAuth,(req,res)=>{
  const c=state.conversations.find(x=>x.id===req.params.id && x.userId===req.session.user.id);
  if(!c) return res.status(404).json({error:"Conversation not found."});
  if(req.body.title) c.title=String(req.body.title).slice(0,100);
  c.updatedAt=new Date().toISOString(); res.json({chat:c});
});
app.delete("/api/chats/:id", requireAuth,(req,res)=>{
  const i=state.conversations.findIndex(x=>x.id===req.params.id && x.userId===req.session.user.id);
  if(i<0) return res.status(404).json({error:"Conversation not found."}); state.conversations.splice(i,1); res.json({ok:true});
});

app.post("/api/chat", requireAuth, async (req,res)=>{
  const {conversationId,message}=req.body;
  if(!message || !String(message).trim()) return res.status(400).json({error:"Message cannot be empty."});
  const c=state.conversations.find(x=>x.id===conversationId && x.userId===req.session.user.id);
  if(!c) return res.status(404).json({error:"Conversation not found."});
  const recent = state.usage.filter(x=>x.userId===req.session.user.id && new Date(x.time)>new Date(Date.now()-86400000)).length;
  if(recent >= state.settings.dailyLimit) return res.status(429).json({error:"You have reached your daily AI request limit."});
  const safeMessage=String(message).slice(0,12000);
  c.messages.push({role:"user",content:safeMessage,time:new Date().toISOString()});
  if(c.title==="New conversation") c.title=safeMessage.slice(0,45);
  const start=Date.now();
  try {
    const result=await generateAI([{role:"system",content:state.settings.systemPrompt},...c.messages.map(m=>({role:m.role,content:m.content}))]);
    c.messages.push({role:"assistant",content:result.content,time:new Date().toISOString(),provider:result.provider,model:result.model});
    c.updatedAt=new Date().toISOString();
    state.usage.push({userId:req.session.user.id,provider:result.provider,model:result.model,status:"success",time:new Date().toISOString(),responseTime:Date.now()-start});
    state.logs.unshift({time:new Date().toISOString(),type:"chat",userId:req.session.user.id,provider:result.provider,model:result.model,status:"success"});
    res.json({message:result.content,provider:result.provider,model:result.model});
  } catch(e) {
    state.usage.push({userId:req.session.user.id,provider:"none",model:"none",status:"error",time:new Date().toISOString(),responseTime:Date.now()-start});
    res.status(503).json({error:e.message});
  }
});

app.get("/api/admin/dashboard",requireAdmin,(req,res)=>{
  const success=state.usage.filter(x=>x.status==="success").length;
  res.json({users:state.users.length,activeUsers:state.users.filter(u=>u.status==="active").length,requests:state.usage.length,success,conversations:state.conversations.length,aiOnline:providerEnabled("groq")||providerEnabled("openrouter"),settings:state.settings});
});
app.get("/api/admin/users",requireAdmin,(req,res)=>res.json({users:state.users.map(safeUser)}));
app.patch("/api/admin/users/:id",requireAdmin,(req,res)=>{
  const u=state.users.find(x=>x.id===req.params.id); if(!u)return res.status(404).json({error:"User not found."});
  if(req.body.status)u.status=req.body.status; res.json({user:safeUser(u)});
});
app.delete("/api/admin/users/:id",requireAdmin,(req,res)=>{
  const i=state.users.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"User not found."});
  state.users.splice(i,1); state.conversations=state.conversations.filter(c=>c.userId!==req.params.id);res.json({ok:true});
});
app.get("/api/admin/providers",requireAdmin,(req,res)=>res.json({
  groq:{enabled:state.settings.groqEnabled,configured:!!process.env.GROQ_API_KEY,model:state.settings.groqModel},
  openrouter:{enabled:state.settings.openrouterEnabled,configured:!!process.env.OPENROUTER_API_KEY,model:state.settings.openrouterModel},
  primary:state.settings.primaryProvider,fallback:state.settings.fallbackProvider
}));
app.patch("/api/admin/providers",requireAdmin,(req,res)=>{
  const s=req.body||{};
  if(["groq","openrouter"].includes(s.primaryProvider))state.settings.primaryProvider=s.primaryProvider;
  if(["none","groq","openrouter"].includes(s.fallbackProvider))state.settings.fallbackProvider=s.fallbackProvider;
  if(s.groqModel)state.settings.groqModel=String(s.groqModel);
  if(s.openrouterModel)state.settings.openrouterModel=String(s.openrouterModel);
  if(typeof s.groqEnabled==="boolean")state.settings.groqEnabled=s.groqEnabled;
  if(typeof s.openrouterEnabled==="boolean")state.settings.openrouterEnabled=s.openrouterEnabled;
  res.json({ok:true});
});
app.post("/api/admin/providers/test",requireAdmin,async(req,res)=>{
  const p=req.body.provider;
  try {
    if(!["groq","openrouter"].includes(p)) throw new Error("Unsupported provider.");
    const model=p==="groq"?state.settings.groqModel:state.settings.openrouterModel;
    const result=await callProvider(p,[{role:"user",content:"Reply with exactly: CONNECTION_OK"}],model);
    res.json({ok:true,provider:p,response:result});
  }catch(e){res.status(400).json({ok:false,error:e.message});}
});
app.get("/api/admin/logs",requireAdmin,(req,res)=>res.json({logs:state.logs.slice(0,100),usage:state.usage.slice(-100)}));
app.get("/api/admin/settings",requireAdmin,(req,res)=>res.json({settings:state.settings}));
app.patch("/api/admin/settings",requireAdmin,(req,res)=>{
  const s=req.body||{};
  ["appName","aiName","systemPrompt"].forEach(k=>{if(typeof s[k]==="string")state.settings[k]=s[k]});
  if(Number.isFinite(Number(s.dailyLimit)))state.settings.dailyLimit=Math.max(1,Number(s.dailyLimit));
  if(Number.isFinite(Number(s.monthlyLimit)))state.settings.monthlyLimit=Math.max(1,Number(s.monthlyLimit));
  res.json({settings:state.settings});
});

app.get("*",(req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"API route not found"});
  res.sendFile(path.join(__dirname,"public","index.html"));
});
app.listen(PORT,()=>console.log(`AI Workspace running on http://localhost:${PORT}`));
