import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;
const KEY = process.env.OPENAI_API_KEY;
const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";

app.use(express.json({limit:"20kb"}));
app.use((req,res,next)=>{
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  res.setHeader("Access-Control-Allow-Methods","POST,GET,OPTIONS");
  if(req.method==="OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (req,res)=>res.json({ok:true, service:"Sofia / VA.IA backend", status:"online"}));

app.post("/api/sofia", async (req,res)=>{
  try {
    if(!KEY) return res.status(500).json({error:"OPENAI_API_KEY non configurata sul server."});
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if(!message) return res.status(400).json({error:"Messaggio mancante."});

    const system = `Sei Sofia, assistente virtuale di VA.IA per la ricerca di automobili usate.
Rispondi in italiano, naturale, cordiale e concreto. In questa prima versione non hai accesso ad annunci o database reali: puoi solo conversare e raccogliere le caratteristiche dell'auto. Fai una o due domande alla volta. Quando hai abbastanza informazioni, riassumi la richiesta e chiedi conferma. Non inventare disponibilità, prezzi o annunci.`;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${KEY}`},
      body:JSON.stringify({
        model:MODEL,
        input:[
          {role:"system",content:system},
          {role:"user",content:message}
        ],
        max_output_tokens:350
      })
    });
    const data = await r.json();
    if(!r.ok) return res.status(r.status).json({error:"Errore OpenAI", details:data?.error?.message || "Errore sconosciuto"});
    res.json({reply:data.output_text || "Non sono riuscita a preparare una risposta."});
  } catch(e) {
    console.error(e);
    res.status(500).json({error:"Errore interno del backend."});
  }
});

app.listen(PORT,()=>console.log(`Sofia backend in ascolto sulla porta ${PORT}`));
