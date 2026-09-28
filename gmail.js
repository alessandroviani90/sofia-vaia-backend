import { google } from "googleapis";

export function createGmail(oauth2Client) {

  return google.gmail({
    version: "v1",
    auth: oauth2Client
  });

}
