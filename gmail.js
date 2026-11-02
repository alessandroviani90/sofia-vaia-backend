
import { google } from "googleapis";

export function createGmail(oauth2Client) {
  return google.gmail({
    version: "v1",
    auth: oauth2Client
  });
}

// Recupera un'intestazione senza rischiare errori
// se Gmail non la restituisce.
function getHeader(headers, name) {
  if (!Array.isArray(headers)) return "";

  const header = headers.find(
    h => h.name?.toLowerCase() === name.toLowerCase()
  );

  return header?.value || "";
}

// Decodifica il testo ricevuto da Gmail.
function decodeBody(data) {
  if (!data) return "";

  let base64 = data
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  while (base64.length % 4 !== 0) {
    base64 += "=";
  }

  return Buffer.from(base64, "base64").toString("utf8");
}

// Converte HTML in testo leggibile.
function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    )
    .replace(/[ \t]+/g, " ")
    .trim();
}

// Estrae il testo anche dalle email composte
// da più parti (multipart).
function extractText(payload) {
  if (!payload) return "";

  if (
    payload.mimeType === "text/plain" &&
    payload.body?.data
  ) {
    return decodeBody(payload.body.data);
  }

  // Cerca prima il testo semplice nelle parti interne.
  for (const part of payload.parts || []) {
    const text = extractText(part);

    if (text) return text;
  }

  // Se non esiste testo semplice, usa la versione HTML.
  if (
    payload.mimeType === "text/html" &&
    payload.body?.data
  ) {
    return htmlToText(decodeBody(payload.body.data));
  }

  return "";
}

export async function readLatestEmail(
  gmail,
  seenEmails = new Set()
) {
  const result = await gmail.users.messages.list({
    userId: "me",
    maxResults: 10
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
    if (!message.id) continue;

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

    if (
      !isSofiaEmail &&
      !seenEmails.has(candidate.data.id)
    ) {
      detail = candidate;
      break;
    }
  }

  if (!detail) {
    return {
      found: false,
      message: "Nessuna nuova email esterna trovata."
    };
  }

  const headers = detail.data.payload?.headers || [];
  const threadId = detail.data.threadId;

  // Recupera l'intera conversazione Gmail.
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

// Protegge le intestazioni da caratteri di nuova riga.
function cleanHeader(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

// Codifica correttamente l'oggetto anche se contiene
// lettere accentate o caratteri speciali.
function encodeSubject(subject) {
  const clean = cleanHeader(subject);

  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

export async function sendReply(
  gmail,
  { to, subject, body, threadId, messageId }
) {
  if (!to || !body) {
    throw new Error(
      "Destinatario e testo della risposta sono obbligatori."
    );
  }

  const message = [
    `To: ${cleanHeader(to)}`,
    `Subject: ${encodeSubject(subject || "")}`,
    ...(messageId
      ? [
          `In-Reply-To: ${cleanHeader(messageId)}`,
          `References: ${cleanHeader(messageId)}`
        ]
      : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    String(body).replace(/\r?\n/g, "\r\n")
  ].join("\r\n");

  const raw = Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      ...(threadId ? { threadId } : {})
    }
  });
}
