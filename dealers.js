
const dealers = {
  zlmotors: {
    id: "zlmotors",
    denominazione: "ZL Motors",
    ubicazione: "via Lombardia2, Sarmeola di Tubano (PD)",
    referente: "Alessandro",
    telefono: "3518889999",
    email: "info@zlmotors.it",

    calendar: {
      provider: "google",
      calendarId: "",
      credentialEnv: "GOOGLE_TOKEN_ZLMOTORS"
    }
  },

  brama: {
    id: "brama",
    denominazione: "Brama Auto",
    ubicazione: "Via Bernardi 2, Maserà di Padova",
    referente: "Mattia",
    telefono: "3559998888",
    email: "commerciale@bramarent.it",

    calendar: {
      provider: "google",
      calendarId: "",
      credentialEnv: "GOOGLE_TOKEN_BRAMA"
    }
  }
};

export default dealers;
