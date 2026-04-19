const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require("@whiskeysockets/baileys");

const fs = require("fs");

const DATA_FILE = "./comandos.json";

function loadComandos() {
    if (!fs.existsSync(DATA_FILE)) {
        const defaults = {
            ".menu": "✨ *KANE STREAM* ✨\n\n📺 Escribe .servicios o .pago para más info.",
            ".pago": "✨ *FORMA DE PAGO* ✨\n\n🏦 Banco: Mercado Pago\n🔢 722969010479464673\n👤 Nancy Areli Frias\n📝 Concepto: Dulces 🍭",
            ".servicios": "📺 *SERVICIOS*\n\n🔥 Netflix → $80\n🔥 Disney+ → $70\n🔥 HBO Max → $60\n🔥 Spotify → $50"
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(defaults, null, 2));
        return defaults;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

function saveComandos(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function isAdmin(sock, groupId, participantJid) {
    try {
        const meta = await sock.groupMetadata(groupId);
        const p = meta.participants.find(p => p.id === participantJid);
        return p?.admin === "admin" || p?.admin === "superadmin";
    } catch {
        return false;
    }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        browser: Browsers.ubuntu("Chrome")
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        if (connection === "close") {
            const reconectar =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (reconectar) startBot();
        } else if (connection === "open") {
            console.log("✅ BOT CONECTADO");
        }
    });

    // IMPORTANTE: usa tu número con código de país, sin + ni espacios
    const phoneNumber = process.env.PHONE_NUMBER;

    if (!sock.authState.creds.registered) {
        if (!phoneNumber) {
            console.log("❌ Falta la variable PHONE_NUMBER. Ejemplo: 521234567890");
        } else {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log("🔑 CODIGO DE VINCULACION:", code);
                } catch (err) {
                    console.log("❌ Error al pedir código de vinculación:", err);
                }
            }, 3000);
        }
    }

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        const msg = messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        if (!from.endsWith("@g.us")) return;

        const senderJid = msg.key.participant || msg.participant;

        const rawText = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            ""
        ).trim();

        const text = rawText.toLowerCase();

        if (text.startsWith(".nuevo ")) {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }
            const resto = rawText.slice(7).trim();
            const primerEspacio = resto.indexOf(" ");
            if (primerEspacio === -1) {
                await sock.sendMessage(from, { text: "❌ Uso:\n.nuevo .comando Texto del mensaje" });
                return;
            }
            const comando = resto.slice(0, primerEspacio).toLowerCase();
            const mensaje = resto.slice(primerEspacio + 1).trim();

            if (!comando.startsWith(".")) {
                await sock.sendMessage(from, { text: "❌ El comando debe empezar con punto." });
                return;
            }

            const reservados = [".nuevo", ".editar", ".eliminar", ".listar", ".ayuda", ".cerrargrupo", ".abrirgrupo", ".expulsar"];
            if (reservados.includes(comando)) {
                await sock.sendMessage(from, { text: `⛔ El comando *${comando}* está reservado.` });
                return;
            }

            const comandos = loadComandos();
            const esNuevo = !comandos[comando];
            comandos[comando] = mensaje;
            saveComandos(comandos);
            await sock.sendMessage(from, { text: `${esNuevo ? "✅ Comando creado" : "✏️ Comando actualizado"}: *${comando}*` });
            return;
        }

        if (text.startsWith(".editar ")) {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }
            const resto = rawText.slice(8).trim();
            const primerEspacio = resto.indexOf(" ");
            if (primerEspacio === -1) {
                await sock.sendMessage(from, { text: "❌ Uso:\n.editar .comando Nuevo texto" });
                return;
            }
            const comando = resto.slice(0, primerEspacio).toLowerCase();
            const mensaje = resto.slice(primerEspacio + 1).trim();
            const comandos = loadComandos();
            if (!comandos[comando]) {
                await sock.sendMessage(from, { text: `❌ El comando *${comando}* no existe.` });
                return;
            }
            comandos[comando] = mensaje;
            saveComandos(comandos);
            await sock.sendMessage(from, { text: `✏️ Comando *${comando}* actualizado correctamente.` });
            return;
        }

        if (text.startsWith(".eliminar ")) {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }
            const comando = rawText.slice(10).trim().toLowerCase();
            const comandos = loadComandos();
            if (!comandos[comando]) {
                await sock.sendMessage(from, { text: `❌ El comando *${comando}* no existe.` });
                return;
            }
            delete comandos[comando];
            saveComandos(comandos);
            await sock.sendMessage(from, { text: `🗑️ Comando *${comando}* eliminado.` });
            return;
        }

        if (text === ".listar") {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }
            const comandos = loadComandos();
            const lista = Object.keys(comandos).join("\n");
            await sock.sendMessage(from, { text: `📋 *Comandos activos:*\n\n${lista}` });
            return;
        }

        if (text === ".ayuda") {
            if (!await isAdmin(sock, from, senderJid)) return;
            const ayuda = `🛠️ *PANEL DE ADMINISTRADOR*\n\n` +
                `➕ *Crear o actualizar comando*\n.nuevo .comando Texto del mensaje\n\n` +
                `✏️ *Editar comando existente*\n.editar .comando Nuevo texto\n\n` +
                `🗑️ *Eliminar comando*\n.eliminar .comando\n\n` +
                `📋 *Ver todos los comandos*\n.listar\n\n` +
                `👥 *Expulsar usuario*\n.expulsar @usuario\n\n` +
                `🔒 *Cerrar grupo*\n.cerrargrupo\n\n` +
                `🔓 *Abrir grupo*\n.abrirgrupo`;
            await sock.sendMessage(from, { text: ayuda });
            return;
        }

        if (text.startsWith(".expulsar")) {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }
            const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!mentionedJid) {
                await sock.sendMessage(from, { text: "❌ Etiqueta al usuario:\n.expulsar @usuario" });
                return;
            }
            try {
                await sock.groupParticipantsUpdate(from, [mentionedJid], "remove");
                await sock.sendMessage(from, { text: "✅ Usuario expulsado." });
            } catch {
                await sock.sendMessage(from, { text: "❌ No se pudo expulsar. El bot debe ser administrador." });
            }
            return;
        }

        if (text === ".cerrargrupo") {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }
            try {
                await sock.groupSettingUpdate(from, "announcement");
                await sock.sendMessage(from, { text: "🔒 Grupo cerrado. Solo admins pueden escribir." });
            } catch {
                await sock.sendMessage(from, { text: "❌ El bot debe ser administrador del grupo." });
            }
            return;
        }

        if (text === ".abrirgrupo") {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }
            try {
                await sock.groupSettingUpdate(from, "not_announcement");
                await sock.sendMessage(from, { text: "🔓 Grupo abierto. Todos pueden escribir." });
            } catch {
                await sock.sendMessage(from, { text: "❌ El bot debe ser administrador del grupo." });
            }
            return;
        }

        const comandos = loadComandos();
        if (comandos[text]) {
            await sock.sendMessage(from, { text: comandos[text] });
        }
    });
}

startBot();
