SOFIA / VA.IA - BACKEND DI PROVA

Flusso:
Wix -> backend -> OpenAI API -> Wix

1. Installa Node.js 20 o superiore.
2. Apri il terminale nella cartella.
3. Esegui: npm install
4. Copia .env.example in .env
5. Inserisci OPENAI_API_KEY nel file .env
6. Avvia: npm start

Endpoint:
GET  /
POST /api/sofia

Esempio POST:
{"message":"Cerco una Fiat 500 Cabrio sotto i 18.000 euro"}

IMPORTANTE:
- NON mettere mai la API key nell'HTML di Wix.
- NON pubblicare il file .env.
- Prima testiamo localmente.
- Poi scegliamo l'hosting e colleghiamo Wix.
- In produzione ALLOWED_ORIGIN va impostato sul dominio Wix.

L'API OpenAI è fatturata separatamente dall'abbonamento ChatGPT.
