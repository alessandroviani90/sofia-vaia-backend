import { google } from "googleapis";

export function createGmail(oauth2Client) {
  return google.gmail({
    version: "v1",
    auth: oauth2Client
  });
}

export async function readLatestEmail(gmail) {

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

    const candidate = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "full"
    });

    const headers = candidate.data.payload?.headers || [];

    const from =
      headers.find(
        h => h.name.toLowerCase() === "from"
      )?.value || "";

    if (!from.toLowerCase().includes("vaia.sofia90@gmail.com")) {
      detail = candidate;
      break;
    }
  }

  if (!detail) {
    return {
      found: false,
      message: "Nessuna email ricevuta da un mittente esterno trovata."
    };
  }

  const headers = detail.data.payload?.headers || [];

  const getHeader = (name) =>
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

  let body = "";

  const payload = detail.data.payload;

  if (payload?.body?.data) {
    body = decodeBody(payload.body.data);
  }

  if (!body && payload?.parts) {
    for (const part of payload.parts) {

      if (
        part.mimeType === "text/plain" &&
        part.body?.data
      ) {
        body = decodeBody(part.body.data);
        break;
      }

    }
  }

  return {
    found: true,
    id: messages[0].id,
    threadId: detail.data.threadId,
    from: getHeader("From"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
    body
  };
}


export async function sendReply(gmail, { to, subject, body, threadId }) {

  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
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
