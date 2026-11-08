
import { google } from "googleapis";

// ETICHETTA PERSISTENTE PER LE EMAIL GESTITE DA SOFIA
const SOFIA_PROCESSED_LABEL = "SOFIA_GESTITO";


// CREA IL COLLEGAMENTO GMAIL
export function createGmail(oauth2Client) {
  return google.gmail({
    version: "v1",
    auth: oauth2Client
  });
}


// LEGGE UN'INTESTAZIONE
function getHeader(headers, name) {
  return (headers || []).find(
    h => h.name?.toLowerCase() === name.toLowerCase()
  )?.value || "";
}


// DECODIFICA IL TESTO BASE64URL
function decodeBase64(data) {
  if (!data) return "";

  const normalized = data
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  return Buffer.from(
    normalized,
    "base64"
  ).toString("utf8");
}


// ESTRAE IL TESTO DAL CORPO DELL'EMAIL
function extractText(payload) {
  if (!payload) return "";

  const plainParts = [];
  const htmlParts = [];

  function collect(part) {
    if (!part) return;

    const mimeType = (
      part.mimeType || ""
    ).toLowerCase();

    if (part.parts?.length) {
      for (const child of part.parts) {
        collect(child);
      }
      return;
    }

    const data = part.body?.data;

    if (!data) return;

    const decoded = decodeBase64(data);

    if (mimeType === "text/plain") {
      plainParts.push(decoded);
    } else if (mimeType === "text/html") {
      htmlParts.push(decoded);
    }
  }

  collect(payload);

  if (plainParts.length) {
    return plainParts.join("\n").trim();
  }

  if (htmlParts.length) {
    return htmlParts
      .join("\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .trim();
  }

  return "";
}


// CREA O RECUPERA L'ETICHETTA
export async function ensureSofiaProcessedLabel(gmail) {
  const result = await gmail.users.labels.list({
    userId: "me"
  });

  const existing = (result.data.labels || []).find(
    label => label.name === SOFIA_PROCESSED_LABEL
  );

  if (existing) {
    console.log("Etichetta Sofia già presente.");
    return existing.id;
  }

  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: SOFIA_PROCESSED_LABEL,
      labelListVisibility: "labelShow",
      messageListVisibility: "show"
    }
  });

  // SOLO ALLA PRIMA INSTALLAZIONE:
  // registra le email già presenti.

  let pageToken;

  do {
    const page = await gmail.users.messages.list({
      userId: "me",
      q: "in:inbox",
      maxResults: 500,
      ...(pageToken ? { pageToken } : {})
    });

    const ids = (page.data.messages || [])
      .map(message => message.id)
      .filter(Boolean);

    for (let i = 0; i < ids.length; i += 1000) {
      await gmail.users.messages.batchModify({
        userId: "me",
        requestBody: {
          ids: ids.slice(i, i + 1000),
          addLabelIds: [created.data.id]
        }
      });
    }

    pageToken = page.data.nextPageToken;

  } while (pageToken);

  console.log(
    "Prima installazione: vecchie email registrate."
  );

  return created.data.id;
}


// SEGNA UN MESSAGGIO COME GESTITO
export async function markEmailAsProcessed(
  gmail,
  messageId,
  labelId
) {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: [labelId]
    }
  });
}


// LEGGE TUTTE LE NUOVE EMAIL NON ANCORA GESTITE
export async function readPendingEmails(gmail) {
  const messages = [];
  let pageToken;

  // RECUPERA TUTTE LE EMAIL NON ANCORA GESTITE
  do {
    const result = await gmail.users.messages.list({
      userId: "me",
      q: "in:inbox -label:" + SOFIA_PROCESSED_LABEL,
      maxResults: 500,
      ...(pageToken ? { pageToken } : {})
    });

    messages.push(...(result.data.messages || []));

    pageToken = result.data.nextPageToken;

  } while (pageToken);


  // CACHE TEMPORANEA DEI THREAD
  // Ogni conversazione viene scaricata una sola volta.
  const threadCache = new Map();

  const pending = [];

  for (const message of messages) {
    if (!message.id) continue;

    let threadId = message.threadId;

    // RECUPERO DI SICUREZZA SE MANCA THREAD ID
    if (!threadId) {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: message.id,
        format: "full"
      });

      threadId = detail.data.threadId;
    }

    if (!threadId) continue;

  // CONTROLLA SE IL THREAD È GIÀ IN CACHE
if (!threadCache.has(threadId)) {

  const threadResult = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full"
  });

  // RICOSTRUISCE LO STORICO COMPLETO
  const threadMessages = (
    threadResult.data.messages || []
  ).map(item => {
    const itemHeaders = item.payload?.headers || [];

    return {
      id: item.id,
      internalDate: Number(item.internalDate || 0),
      messageId: getHeader(itemHeaders, "Message-ID"),
      inReplyTo: getHeader(itemHeaders, "In-Reply-To"),
      references: getHeader(itemHeaders, "References"),
      date: getHeader(itemHeaders, "Date"),
      from: getHeader(itemHeaders, "From"),
      subject: getHeader(itemHeaders, "Subject"),
      body: extractText(item.payload)
    };
  });

  // ORDINA LO STORICO CRONOLOGICAMENTE
  threadMessages.sort(
    (a, b) => a.internalDate - b.internalDate
  );

  // SALVA IL THREAD PER I PROSSIMI MESSAGGI
  threadCache.set(threadId, threadMessages);
}

// RECUPERA LO STORICO DALLA CACHE
const threadMessages = threadCache.get(threadId);

// INDIVIDUA IL MESSAGGIO DA ELABORARE
const currentMessage = threadMessages.find(
  item => item.id === message.id
);
    
    if (!currentMessage) continue;

    pending.push({
      internalDate: currentMessage.internalDate,
      id: currentMessage.id,
      threadId,
      messageId: currentMessage.messageId,
      from: currentMessage.from,
      subject: currentMessage.subject,
      date: currentMessage.date,
      body: currentMessage.body,

      // STORICO COMPLETO DELLA CONVERSAZIONE
      threadHistory: threadMessages
    });
  }


  // PRIMA LE EMAIL PIÙ VECCHIE
  pending.sort(
    (a, b) => a.internalDate - b.internalDate
  );

  console.log(
    "Sofia: lette",
    pending.length,
    "email. Thread unici:",
    threadCache.size
  );

  return pending;
}


// INVIA UNA RISPOSTA ALL'INTERNO DELLA CONVERSAZIONE
export async function sendReply(
  gmail,
  {
    to,
    subject,
    body,
    threadId,
    messageId
  }
) {
  if (!to || !body) {
    throw new Error(
      "Destinatario o corpo dell'email mancante."
    );
  }

  const encodedSubject =
    "=?UTF-8?B?" +
    Buffer.from(subject || "", "utf8").toString("base64") +
    "?=";

  const headers = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`
  ];

  if (messageId) {
    headers.push(`In-Reply-To: ${messageId}`);
    headers.push(`References: ${messageId}`);
  }

  const rawMessage = [
    ...headers,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body
  ].join("\r\n");

  const raw = Buffer.from(
    rawMessage,
    "utf8"
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      ...(threadId ? { threadId } : {})
    }
  });
}

