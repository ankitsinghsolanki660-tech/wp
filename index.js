import fs from "fs";
import chalk from "chalk";
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason
} from "@whiskeysockets/baileys";
import pino from "pino";
import express from "express";

// 🔥 HARD LOG FILTER (HIDE BAILEYS SPAM)
const originalError = console.error;
const originalLog = console.log;

console.error = (...args) => {
  const msg = args.join(" ");

  if (
    msg.includes("Bad MAC") ||
    msg.includes("Closing session") ||
    msg.includes("Session error") ||
    msg.includes("libsignal") ||
    msg.includes("decrypt")
  ) return;

  originalError(...args);
};

console.log = (...args) => {
  const msg = args.join(" ");

  if (
    msg.includes("Closing session") ||
    msg.includes("chainKey") ||
    msg.includes("ephemeralKeyPair")
  ) return;

  originalLog(...args);
};

const app = express();
const PORT = process.env.PORT || 3000;

// 🌐 Keep alive server
app.get("/", (req, res) => res.send("🤖 Bot Running"));
app.listen(PORT, () => console.log("🌐 Server running:", PORT));

// 📂 Load files
const phone = fs.readFileSync("phone.txt", "utf-8").trim();
const target = fs.readFileSync("target.txt", "utf-8").trim();
const messages = fs.readFileSync("messages.txt", "utf-8")
  .split("\n")
  .map(m => m.trim())
  .filter(Boolean);

const config = JSON.parse(fs.readFileSync("config.json"));

let index = 0;

let totalMessages = 0;

// 🇮🇳 Indian Time formatter
function getIndianTime() {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium"
  });
}

// 📱 Clean number formatter
function formatNumber(num) {
  return num.replace(/[^0-9]/g, "");
}

let reconnecting = false;

// 🧠 GLOBAL ERROR FILTER (NO BAD MAC LOGS)
process.on("uncaughtException", (err) => {
  if (
    err?.message?.includes("Bad MAC") ||
    err?.message?.includes("decrypt") ||
    err?.message?.includes("Session error")
  ) return;
  console.log("❌ Error:", err.message);
});

async function startBot() {
  let interval; // 🔥 ADD HERE (IMPORTANT)

  const sessionPath = `./session-${phone}`;
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "fatal" }), // ✅ yaha lagana hai
    browser: Browsers.windows("Chrome"),

    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(
        state.keys,
        pino({ level: "fatal" })
      )
    },

    getMessage: async () => undefined,

    syncFullHistory: false,
    markOnlineOnConnect: false,
    defaultQueryTimeoutMs: undefined,
    emitOwnEvents: false
  });

  // ✅ ignore incoming
  sock.ws.on("CB:message", () => {});

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", () => {});
  sock.ev.on("messages.update", () => {});
  sock.ev.on("presence.update", () => {});
  sock.ev.on("chats.update", () => {});

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      console.log(chalk.green("✅ Connected"));

      // 🔥 ADD THIS HERE (EXACT PLACE)
      await new Promise(r => setTimeout(r, 60000)); // 1 min delay

      console.log("⏳ Starting message loop after delay...");

      // 🔥 FIX: stop duplicate loops
      if (interval) clearInterval(interval);

      interval = setInterval(async () => {
        const msg = `${config.namePrefix} ${messages[index]}`;
        const jid = target.includes("@g.us")
          ? target
          : `${target}@s.whatsapp.net`;

        let status = "❌ Message Failed";

        try {
          await sock.sendMessage(jid, { text: msg });
          status = "✅ Message Sent Successfully";
        } catch (err) {
          status = "❌ Message Failed";
        }

        totalMessages++;

        console.log(chalk.gray("────────────────────────────────────────"));

        console.log(chalk.yellow("🕒 Time:"), getIndianTime());
        console.log(chalk.green("📱 Phone No.:"), formatNumber(phone));
        console.log(chalk.blue("🎯 Target No.:"), formatNumber(target));
        console.log(chalk.cyan("💬 Message:"), msg);
        console.log(chalk.magenta("📊 Total Messages:"), totalMessages);
        console.log(
          status.includes("Successfully")
            ? chalk.green("🚀 Status:" + " " + status)
            : chalk.red("⚠️ Status:" + " " + status)
        );

        console.log(chalk.gray("────────────────────────────────────────"));

        index = (index + 1) % messages.length;
      }, config.delaySeconds * 1000);
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;

      if (interval) clearInterval(interval);

      if (reason === DisconnectReason.loggedOut) {
        console.log(chalk.red("❌ Logged out. Delete session & re-pair."));
      } else {
        if (!reconnecting) {
          reconnecting = true;
          console.log(chalk.yellow("🔄 Reconnecting..."));
          setTimeout(() => {
            reconnecting = false;
            startBot();
          }, 5000);
        }
      }
    }
  });

  // 🔑 Pairing
  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      const code = await sock.requestPairingCode(phone);
      console.log(
        chalk.yellow(
          "🔑 Pairing Code:",
          code.match(/.{1,4}/g).join("-")
        )
      );
    }, 3000);
  }
}

startBot();
