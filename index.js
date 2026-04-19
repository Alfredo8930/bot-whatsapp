const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const fs = require("fs");

// ─────────────────────────────────────────────
//  PERSISTENCIA — comandos.json
//  Estructura: { ".menu": "texto...", ".pago": "texto..." }
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
//  HELPER — verificar si es admin del grupo
// ─────────────────────────────────────────────
async function isAdmin(sock, groupId, participantJid) {
    try {
        const meta = await sock.groupMetadata(groupId);
        const p = meta.participants.find(p => p.id === participantJid);
        return p?.admin === "admin" || p?.admin === "superadmin";
    } catch {
        return false;
    }
}

// ─────────────────────────────────────────────
//  BOT
// ─────────────────────────────────────────────
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({ version, auth: state, printQRInTerminal: true });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
        if (qr) { console.log("📱 Escanea QR:"); qrcode.generate(qr, { small: true }); }
        if (connection === "close") {
            const reconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (reconectar) startBot();
        } else if (connection === "open") {
            console.log("✅ BOT CONECTADO");
        }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        const msg = messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        if (!from.endsWith("@g.us")) return; // solo grupos

        const senderJid = msg.key.participant || msg.participant;

        const rawText = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            ""
        ).trim();

        const text = rawText.toLowerCase();

        // ══════════════════════════════════════════
        //  COMANDOS DE ADMINISTRACIÓN (solo admins)
        // ══════════════════════════════════════════

        // .nuevo .comando Texto completo del mensaje
        if (text.startsWith(".nuevo ")) {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }
            // Separar el comando del texto
            // Formato: .nuevo .micomando Este es el mensaje\nque puede tener saltos
            const resto = rawText.slice(7).trim(); // quita ".nuevo "
            const primerEspacio = resto.indexOf(" ");
            if (primerEspacio === -1) {
                await sock.sendMessage(from, { text: "❌ Uso:\n.nuevo .comando Texto del mensaje\n\nEjemplo:\n.nuevo .promo 🔥 Promoción: 2x1 hoy únicamente" });
                return;
            }
            const comando = resto.slice(0, primerEspacio).toLowerCase();
            const mensaje = resto.slice(primerEspacio + 1).trim();

            if (!comando.startsWith(".")) {
                await sock.sendMessage(from, { text: "❌ El comando debe empezar con punto.\nEjemplo: .nuevo .promo Texto..." });
                return;
            }

            // Proteger comandos del sistema
            const reservados = [".nuevo", ".editar", ".eliminar", ".listar", ".ayuda", ".cerrargrupo", ".abrirgrupo", ".expulsar"];
            if (reservados.includes(comando)) {
                await sock.sendMessage(from, { text: `⛔ El comando *${comando}* está reservado y no puede usarse.` });
                return;
            }

            const comandos = loadComandos();
            const esNuevo = !comandos[comando];
            comandos[comando] = mensaje;
            saveComandos(comandos);
            await sock.sendMessage(from, { text: `${esNuevo ? "✅ Comando creado" : "✏️ Comando actualizado"}: *${comando}*` });
            return;
        }

        // .editar .comando Nuevo texto completo
        if (text.startsWith(".editar ")) {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }
            const resto = rawText.slice(8).trim();
            const primerEspacio = resto.indexOf(" ");
            if (primerEspacio === -1) {
                await sock.sendMessage(from, { text: "❌ Uso:\n.editar .comando Nuevo texto\n\nEjemplo:\n.editar .menu ✨ Menú actualizado ✨" });
                return;
            }
            const comando = resto.slice(0, primerEspacio).toLowerCase();
            const mensaje = resto.slice(primerEspacio + 1).trim();
            const comandos = loadComandos();
            if (!comandos[comando]) {
                await sock.sendMessage(from, { text: `❌ El comando *${comando}* no existe.\nUsa .listar para ver los disponibles.` });
                return;
            }
            comandos[comando] = mensaje;
            saveComandos(comandos);
            await sock.sendMessage(from, { text: `✏️ Comando *${comando}* actualizado correctamente.` });
            return;
        }

        // .eliminar .comando
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

        // .listar — ver todos los comandos activos
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

        // .ayuda — instrucciones para admins
        if (text === ".ayuda") {
            if (!await isAdmin(sock, from, senderJid)) return;
            const ayuda = `🛠️ *PANEL DE ADMINISTRADOR*\n\n` +
                `➕ *Crear o actualizar comando*\n.nuevo .comando Texto del mensaje\n\n` +
                `✏️ *Editar comando existente*\n.editar .comando Nuevo texto\n\n` +
                `🗑️ *Eliminar comando*\n.eliminar .comando\n\n` +
                `📋 *Ver todos los comandos*\n.listar\n\n` +
                `👥 *Expulsar usuario*\n.expulsar @usuario\n\n` +
                `🔒 *Cerrar grupo* (solo admins escriben)\n.cerrargrupo\n\n` +
                `🔓 *Abrir grupo* (todos escriben)\n.abrirgrupo`;
            await sock.sendMessage(from, { text: ayuda });
            return;
        }

        // .expulsar @usuario
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

        // .cerrargrupo
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

        // .abrirgrupo
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

        // ══════════════════════════════════════════
        //  RESPONDER COMANDOS PERSONALIZADOS
        // ══════════════════════════════════════════
        const comandos = loadComandos();
        if (comandos[text]) {
            await sock.sendMessage(from, { text: comandos[text] });
        }
    });
}

startBot();