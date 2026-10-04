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
    maxResults: 1
  });

  const messages = result.data.messages || [];

  if (!messages.length) {
    return {
      found: false,
      message: "Nessuna email trovata."
    };
  }

  const detail = await gmail.users.messages.get({
    userId: "me",
    id: messages[0].id,
    format: "full"
  });

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
