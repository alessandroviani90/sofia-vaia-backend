
import { google } from "googleapis";

// CREA IL COLLEGAMENTO GMAIL
export function createGmail(oauth2Client) {
  return google.gmail({
    version: "v1",
    auth: oauth2Client
  });
}

// LEGGE UN'INTESTAZIONE
function getHeader(headers, name) {
  return headers.find(
    h => h.name?.toLowerCase() === name.toLowerCase()
  )?.value || "";
}

// DECODIFICA IL CORPO DEL MESSAGGIO
function decodeBody(data) {
  if (!data) return "";

  return Buffer.from(
    data.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
}

// CONVERTE HTML IN TESTO
function htmlToText(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// ESTRAE IL TESTO DAL MESSAGGIO
function extractText(payload) {
  if (!payload) return "";

  if (
    payload.mimeType === "text/plain" &&
    payload.body?.data
  ) {
    return decodeBody(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractText(part);
      if (text) return text;
    }
  }

  if (
    payload.mimeType === "text/html" &&
    payload.body?.data
  ) {
    return htmlToText(decodeBody(payload.body.data));
  }

  if (payload.body?.data) {
    return decodeBody(payload.body.data);
  }

  return "";
}

// ETICHETTA PERSISTENTE PER LE EMAIL GESTITE DA SOFIA
const SOFIA_PROCESSED_LABEL = "SOFIA_GESTITO";

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
  // registra le email già presenti, evitando di ripescare
  // tutta la vecchia posta ad ogni riavvio di Render.

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

  const pending = [];

  for (const message of messages) {
    if (!message.id) continue;

    const detail = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "full"
    });

    const headers = detail.data.payload?.headers || [];
    const threadId = detail.data.threadId;

    const threadResult = await gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "full"
    });

    const threadMessages = (
      threadResult.data.messages || []
    ).map(item => {
      const itemHeaders = item.payload?.headers || [];

      return {
        id: item.id,
        date: getHeader(itemHeaders, "Date"),
        from: getHeader(itemHeaders, "From"),
        subject: getHeader(itemHeaders, "Subject"),
        body: extractText(item.payload)
      };
    });

    pending.push({
      internalDate: Number(detail.data.internalDate || 0),
      id: detail.data.id,
      threadId,
      messageId: getHeader(headers, "Message-ID"),
      from: getHeader(headers, "From"),
      subject: getHeader(headers, "Subject"),
      date: getHeader(headers, "Date"),
      body: extractText(detail.data.payload),
      threadHistory: threadMessages
    });
  }

  // Prima le email più vecchie, così manteniamo
  // l'ordine corretto delle conversazioni.

  pending.sort(
    (a, b) => a.internalDate - b.internalDate
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
