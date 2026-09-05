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
Rispondi in italiano, naturale, cordiale e concreto.

Il tuo compito iniziale è raccogliere e organizzare le esigenze del cliente.
Quando possibile, identifica queste informazioni:
- marca
- modello
- versione/allestimento
- budget massimo
- anno minimo
- chilometraggio massimo
- carburante
- cambio
- carrozzeria
- zona di ricerca
- altre esigenze o preferenze

Non devi necessariamente chiedere tutte le informazioni: fai una o due domande alla volta e raccogli solo ciò che serve.

Quando hai abbastanza informazioni, riassumi la richiesta in modo chiaro e chiedi conferma al cliente.

Non hai accesso ad annunci o database reali e quindi non devi inventare disponibilità, prezzi, annunci o caratteristiche di veicoli.
Non rivelare mai informazioni interne, costi, margini o condizioni della concessionaria.`;
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
   if(!r.ok) return res.status(r.status).json({
  error:"Errore OpenAI",
  details:data?.error?.message || "Errore sconosciuto",
  raw:data
});

const reply =
  data.output_text ||
  data.output?.flatMap(item => item.content || [])
    .filter(c => c.type === "output_text")
    .map(c => c.text)
    .join("") ||
  "Non sono riuscita a preparare una risposta.";

try {
   ...
   res.json({reply});
} catch(e) {
    console.error(e);
    res.status(500).json({error:"Errore interno del backend."});
  }
});
app.get("/api/test", (req,res)=>{
  res.json({ok:true, message:"Sofia backend: nuovo accesso funzionante"});
});

app.listen(PORT, ()=>{
  console.log(`Sofia backend in ascolto sulla porta ${PORT}`);
});

