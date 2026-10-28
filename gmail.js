import { google } from "googleapis";

export function createGmail(oauth2Client) {
  return google.gmail({
    version: "v1",
    auth: oauth2Client
  });
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
    return { found: false, message: "Nessuna email trovata." };
  }

  let detail = null;

  for (const message of messages) {
    const candidate = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "full"
    });

    const headers = candidate.data.payload?.headers || [];
    const from =
      headers.find(h => h.name.toLowerCase() === "from")?.value || "";

    if (
      !from.toLowerCase().includes("vaia.sofia90@gmail.com") &&
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

  const getHeader = (headers, name) =>
    headers.find(
      h => h.name.toLowerCase() === name.toLowerCase()
    )?.value || "";

  function decodeBody(data) {
    if (!data) return "";

    return Buffer.from(
      data.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
  }

  function extractText(payload) {
    if (!payload) return "";

    if (payload.mimeType === "text/plain" && payload.body?.data) {
      return decodeBody(payload.body.data);
    }

    for (const part of payload.parts || []) {
      const text = extractText(part);
      if (text) return text;
    }

    if (payload.body?.data && payload.mimeType === "text/html") {
      return decodeBody(payload.body.data)
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    }

    return "";
  }

  const headers = detail.data.payload?.headers || [];
  const threadId = detail.data.threadId;

  // Recupera l'intera conversazione Gmail.
  const threadResult = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full"
  });

  const threadMessages = (threadResult.data.messages || [])
    .map(message => {
      const h = message.payload?.headers || {};

      return {
        id: message.id,
        date: getHeader(h, "Date"),
        from: getHeader(h, "From"),
        subject: getHeader(h, "Subject"),
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


export async function sendReply(gmail, { to, subject, body, threadId, messageId }) {

 const message = [
  `To: ${to}`,
  `Subject: ${subject}`,
  `In-Reply-To: ${messageId}`,
  `References: ${messageId}`,
  "Content-Type: text/plain; charset=utf-8",
  "",
  body
].join("\r\n");

  const raw = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      threadId
    }
  });
}
