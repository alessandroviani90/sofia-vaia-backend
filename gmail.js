
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

// REGISTRA TUTTE LE EMAIL GIÀ PRESENTI IN POSTA
// IN MODO CHE SOFIA NON RIPRENDA VECCHI MESSAGGI
export async function markExistingInboxAsSeen(
  gmail,
  seenEmails = new Set()
) {
  let pageToken;

  do {
    const result = await gmail.users.messages.list({
      userId: "me",
      q: "in:inbox",
      maxResults: 100,
      ...(pageToken ? { pageToken } : {})
    });

    for (const message of result.data.messages || []) {
      if (message.id) {
        seenEmails.add(message.id);
      }
    }

    pageToken = result.data.nextPageToken;
  } while (pageToken);

  return seenEmails;
}

// CERCA UNA NUOVA EMAIL
export async function readLatestEmail(
  gmail,
  seenEmails = new Set()
) {
  const result = await gmail.users.messages.list({
    userId: "me",
    q: "in:inbox",
    maxResults: 100
  });

  const messages = result.data.messages || [];

  if (!messages.length) {
    return {
      found: false,
      message: "Nessuna email trovata."
    };
  }

  let detail = null;

  for (const message of messages) {
    if (!message.id || seenEmails.has(message.id)) {
      continue;
    }

    const candidate = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "full"
    });

    const headers = candidate.data.payload?.headers || [];
    const from = getHeader(headers, "From");

    const isSofiaEmail = from
      .toLowerCase()
      .includes("vaia.sofia90@gmail.com");

    if (isSofiaEmail) {
      seenEmails.add(candidate.data.id);
      continue;
    }

    detail = candidate;
    break;
  }

  if (!detail) {
    return {
      found: false,
      message: "Nessuna nuova email esterna trovata."
    };
  }

  const headers = detail.data.payload?.headers || [];
  const threadId = detail.data.threadId;

  const threadResult = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full"
  });

  const threadMessages = (
    threadResult.data.messages || []
  ).map(message => {
    const messageHeaders =
      message.payload?.headers || [];

    return {
      id: message.id,
      date: getHeader(messageHeaders, "Date"),
      from: getHeader(messageHeaders, "From"),
      subject: getHeader(messageHeaders, "Subject"),
      body: extractText(message.payload)
    };
  });

  return {
    found: true,
    id: detail.data.id,
    threadId,
    messageId: getHeader(headers, "Message-ID"),
    from: getHeader(headers, "From"),
    subject: getHeader(headers, "Subject"),
    date: getHeader(headers, "Date"),
    body: extractText(detail.data.payload),
    threadHistory: threadMessages
  };
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
