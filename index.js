const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require("@whiskeysockets/baileys");

const fs = require("fs");
const path = require("path");

// ==============================
// ARCHIVOS
// ==============================
const BASE_PATH = __dirname;

const DATA_FILE = path.join(BASE_PATH, "comandos.json");
const PRIVATE_FILE = path.join(BASE_PATH, "privados.json");
const USERS_FILE = path.join(BASE_PATH, "usuarios.json");
const PRODUCTS_FILE = path.join(BASE_PATH, "productos.json");
const STOCK_FILE = path.join(BASE_PATH, "stock.json");
const SALES_FILE = path.join(BASE_PATH, "ventas.json");
const AUTH_FOLDER = path.join(BASE_PATH, "auth");

// ==============================
// HELPERS JSON
// ==============================
function ensureJsonFile(filePath, defaultData) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
        return defaultData;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (err) {
        console.error(`❌ Error leyendo ${filePath}:`, err);
        return defaultData;
    }
}

function saveJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ==============================
// PERSISTENCIA
// ==============================
function loadComandos() {
    return ensureJsonFile(DATA_FILE, {
        ".menu": "✨ *KANE STREAM* ✨\n\n📺 Escribe *.stock* para ver disponibilidad.\n💳 Escribe *.creditos* para ver tu saldo.",
        ".pago": "✨ *FORMA DE PAGO* ✨\n\n🏦 Banco: Mercado Pago\n🔢 722969010479464673\n👤 Nancy Areli Frias\n📝 Concepto: Dulces 🍭",
        ".servicios": "📺 *SERVICIOS*\n\n🔥 Netflix\n🔥 Disney+\n🔥 HBO Max\n🔥 Spotify\n\nEscribe *.stock nombre* para ver disponibilidad."
    });
}

function saveComandos(data) {
    saveJsonFile(DATA_FILE, data);
}

function loadPrivados() {
    return ensureJsonFile(PRIVATE_FILE, {});
}

function savePrivados(data) {
    saveJsonFile(PRIVATE_FILE, data);
}

function loadUsers() {
    return ensureJsonFile(USERS_FILE, {});
}

function saveUsers(data) {
    saveJsonFile(USERS_FILE, data);
}

function loadProducts() {
    return ensureJsonFile(PRODUCTS_FILE, {
        "netflix": {
            "perfil": { "precio": 80 },
            "completa": { "precio": 250 }
        },
        "spotify": {
            "perfil": { "precio": 50 }
        }
    });
}

function saveProducts(data) {
    saveJsonFile(PRODUCTS_FILE, data);
}

function loadStock() {
    return ensureJsonFile(STOCK_FILE, {
        "netflix": {
            "perfil": [],
            "completa": []
        },
        "spotify": {
            "perfil": []
        }
    });
}

function saveStock(data) {
    saveJsonFile(STOCK_FILE, data);
}

function loadSales() {
    return ensureJsonFile(SALES_FILE, []);
}

function saveSales(data) {
    saveJsonFile(SALES_FILE, data);
}

// ==============================
// HELPERS NEGOCIO
// ==============================
function normalizePhone(input) {
    return String(input).replace(/\D/g, "");
}

function phoneToJid(phone) {
    return `${normalizePhone(phone)}@s.whatsapp.net`;
}

function jidToPhone(jid) {
    return jid.split("@")[0];
}

function getOrCreateUser(users, jid) {
    if (!users[jid]) {
        users[jid] = {
            creditos: 0,
            compras: 0,
            creado: new Date().toISOString()
        };
    }
    return users[jid];
}

function ensureProduct(products, stock, producto, tipo) {
    if (!products[producto]) products[producto] = {};
    if (!products[producto][tipo]) products[producto][tipo] = { precio: 0 };

    if (!stock[producto]) stock[producto] = {};
    if (!stock[producto][tipo]) stock[producto][tipo] = [];
}

function listStockSummary(products, stock) {
    const nombres = Object.keys(products);
    if (nombres.length === 0) return "📦 No hay productos configurados.";

    let out = "📦 *STOCK DISPONIBLE*\n";
    for (const producto of nombres) {
        out += `\n*${producto.toUpperCase()}*\n`;
        const tipos = Object.keys(products[producto]);
        for (const tipo of tipos) {
            const precio = products[producto][tipo]?.precio ?? 0;
            const disponibles = stock[producto]?.[tipo]?.length ?? 0;
            out += `• ${tipo} → ${disponibles} disponibles | ${precio} créditos\n`;
        }
    }
    return out.trim();
}

function productStockDetail(products, stock, producto) {
    if (!products[producto]) return null;

    let out = `📺 *${producto.toUpperCase()}*\n`;
    const tipos = Object.keys(products[producto]);

    for (const tipo of tipos) {
        const precio = products[producto][tipo]?.precio ?? 0;
        const disponibles = stock[producto]?.[tipo]?.length ?? 0;
        out += `\n• ${tipo}\n  📦 Disponibles: ${disponibles}\n  💳 Precio: ${precio} créditos\n`;
    }
    return out.trim();
}

function lastSalesText(sales, limit = 10) {
    if (!sales.length) return "📄 Aún no hay ventas registradas.";

    const recent = sales.slice(-limit).reverse();
    let out = "📄 *ULTIMAS VENTAS*\n\n";
    for (const sale of recent) {
        out += `• ${sale.producto} (${sale.tipo})\n`;
        out += `  Usuario: ${sale.telefono}\n`;
        out += `  Créditos: ${sale.precio}\n`;
        out += `  Fecha: ${sale.fecha}\n\n`;
    }
    return out.trim();
}

// ==============================
// ADMIN CHECK
// ==============================
async function isAdmin(sock, groupId, participantJid) {
    try {
        const meta = await sock.groupMetadata(groupId);
        const p = meta.participants.find(x => x.id === participantJid);
        return p?.admin === "admin" || p?.admin === "superadmin";
    } catch {
        return false;
    }
}

// ==============================
// BOT
// ==============================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        browser: Browsers.ubuntu("Chrome")
    });

    sock.ev.on("creds.update", saveCreds);

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

    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
        if (connection === "close") {
            const reconectar =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("⚠️ Conexion cerrada. Reconectar:", reconectar);
            if (reconectar) startBot();
        } else if (connection === "open") {
            console.log("✅ BOT CONECTADO");
        }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        const msg = messages[0];
        if (!msg?.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const senderJid = msg.key.participant || msg.participant || from;

        const rawText = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            ""
        ).trim();

        if (!rawText) return;
        const text = rawText.toLowerCase();

        // ==============================
        // PRIVADOS: responder solo una vez
        // ==============================
        if (!from.endsWith("@g.us")) {
            const privados = loadPrivados();

            if (!privados[from]) {
                const avisoPrivado = `🤖 *¡Hola! Soy una cuenta bot automática.*

Por aquí no puedo brindarte atención personalizada, pero con gusto puedes pedir más información o contratar nuestros servicios directamente con mi amo 👑

📲 *9191048827*

✨ Mándale mensaje y te atenderá con gusto.`;

                await sock.sendMessage(from, { text: avisoPrivado });

                privados[from] = {
                    enviado: true,
                    fecha: new Date().toISOString()
                };
                savePrivados(privados);
            }
            return;
        }

        // ==============================
        // PANEL ADMIN
        // ==============================
        if (text.startsWith(".nuevo ")) {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }

            const resto = rawText.slice(7).trim();
            const primerEspacio = resto.indexOf(" ");
            if (primerEspacio === -1) {
                await sock.sendMessage(from, {
                    text: "❌ Uso:\n.nuevo .comando Texto del mensaje"
                });
                return;
            }

            const comando = resto.slice(0, primerEspacio).toLowerCase();
            const mensaje = resto.slice(primerEspacio + 1).trim();

            if (!comando.startsWith(".")) {
                await sock.sendMessage(from, {
                    text: "❌ El comando debe empezar con punto."
                });
                return;
            }

            const reservados = [
                ".nuevo", ".editar", ".eliminar", ".listar", ".ayuda",
                ".cerrargrupo", ".abrirgrupo", ".expulsar",
                ".addcreditos", ".quitarcreditos", ".stockadd",
                ".stockver", ".precio", ".ventas", ".comprar",
                ".creditos", ".stock"
            ];

            if (reservados.includes(comando)) {
                await sock.sendMessage(from, {
                    text: `⛔ El comando *${comando}* está reservado y no puede usarse.`
                });
                return;
            }

            const comandos = loadComandos();
            const esNuevo = !comandos[comando];
            comandos[comando] = mensaje;
            saveComandos(comandos);

            await sock.sendMessage(from, {
                text: `${esNuevo ? "✅ Comando creado" : "✏️ Comando actualizado"}: *${comando}*`
            });
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
                await sock.sendMessage(from, {
                    text: "❌ Uso:\n.editar .comando Nuevo texto"
                });
                return;
            }

            const comando = resto.slice(0, primerEspacio).toLowerCase();
            const mensaje = resto.slice(primerEspacio + 1).trim();
            const comandos = loadComandos();

            if (!comandos[comando]) {
                await sock.sendMessage(from, {
                    text: `❌ El comando *${comando}* no existe.`
                });
                return;
            }

            comandos[comando] = mensaje;
            saveComandos(comandos);

            await sock.sendMessage(from, {
                text: `✏️ Comando *${comando}* actualizado correctamente.`
            });
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
                await sock.sendMessage(from, {
                    text: `❌ El comando *${comando}* no existe.`
                });
                return;
            }

            delete comandos[comando];
            saveComandos(comandos);

            await sock.sendMessage(from, {
                text: `🗑️ Comando *${comando}* eliminado.`
            });
            return;
        }

        if (text === ".listar") {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }

            const comandos = loadComandos();
            const lista = Object.keys(comandos).join("\n") || "Sin comandos.";

            await sock.sendMessage(from, {
                text: `📋 *Comandos personalizados activos:*\n\n${lista}`
            });
            return;
        }

        if (text === ".ayuda") {
            if (!await isAdmin(sock, from, senderJid)) return;

            const ayuda = `🛠️ *PANEL DE ADMINISTRADOR*

*Comandos base*
.nuevo .comando Texto
.editar .comando Nuevo texto
.eliminar .comando
.listar

*Moderación*
.expulsar @usuario
.cerrargrupo
.abrirgrupo

*Créditos*
.addcreditos 5219991112233 100
.quitarcreditos 5219991112233 50

*Stock*
.stockadd netflix perfil correo@gmail.com:clave
.stockver
.precio netflix perfil 80

*Ventas*
.ventas

*Clientes*
.stock
.stock netflix
.creditos
.comprar netflix perfil`;

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
                await sock.sendMessage(from, {
                    text: "❌ Etiqueta al usuario:\n.expulsar @usuario"
                });
                return;
            }

            try {
                await sock.groupParticipantsUpdate(from, [mentionedJid], "remove");
                await sock.sendMessage(from, { text: "✅ Usuario expulsado." });
            } catch {
                await sock.sendMessage(from, {
                    text: "❌ No se pudo expulsar. El bot debe ser administrador."
                });
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
                await sock.sendMessage(from, {
                    text: "🔒 Grupo cerrado. Solo admins pueden escribir."
                });
            } catch {
                await sock.sendMessage(from, {
                    text: "❌ El bot debe ser administrador del grupo."
                });
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
                await sock.sendMessage(from, {
                    text: "🔓 Grupo abierto. Todos pueden escribir."
                });
            } catch {
                await sock.sendMessage(from, {
                    text: "❌ El bot debe ser administrador del grupo."
                });
            }
            return;
        }

        // ==============================
        // ADMIN: CREDITOS
        // ==============================
        if (text.startsWith(".addcreditos ")) {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }

            const parts = rawText.split(/\s+/);
            if (parts.length < 3) {
                await sock.sendMessage(from, {
                    text: "❌ Uso:\n.addcreditos 5219991112233 100"
                });
                return;
            }

            const phone = normalizePhone(parts[1]);
            const amount = Number(parts[2]);

            if (!phone || Number.isNaN(amount) || amount <= 0) {
                await sock.sendMessage(from, { text: "❌ Datos inválidos." });
                return;
            }

            const users = loadUsers();
            const jid = phoneToJid(phone);
            const user = getOrCreateUser(users, jid);

            user.creditos += amount;
            saveUsers(users);

            await sock.sendMessage(from, {
                text: `✅ Se agregaron *${amount} créditos* a *${phone}*.\nNuevo saldo: *${user.creditos}*`
            });

            try {
                await sock.sendMessage(jid, {
                    text: `💳 *Se te abonaron créditos*\n\nSe agregaron *${amount} créditos* a tu cuenta.\nSaldo actual: *${user.creditos} créditos*`
                });
            } catch {}

            return;
        }

        if (text.startsWith(".quitarcreditos ")) {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }

            const parts = rawText.split(/\s+/);
            if (parts.length < 3) {
                await sock.sendMessage(from, {
                    text: "❌ Uso:\n.quitarcreditos 5219991112233 50"
                });
                return;
            }

            const phone = normalizePhone(parts[1]);
            const amount = Number(parts[2]);

            if (!phone || Number.isNaN(amount) || amount <= 0) {
                await sock.sendMessage(from, { text: "❌ Datos inválidos." });
                return;
            }

            const users = loadUsers();
            const jid = phoneToJid(phone);
            const user = getOrCreateUser(users, jid);

            user.creditos = Math.max(0, user.creditos - amount);
            saveUsers(users);

            await sock.sendMessage(from, {
                text: `✅ Se descontaron *${amount} créditos* a *${phone}*.\nNuevo saldo: *${user.creditos}*`
            });

            return;
        }

        // ==============================
        // ADMIN: STOCK Y PRECIOS
        // ==============================
        if (text.startsWith(".stockadd ")) {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }

            const parts = rawText.split(" ");
            if (parts.length < 4) {
                await sock.sendMessage(from, {
                    text: "❌ Uso:\n.stockadd netflix perfil correo@gmail.com:clave123"
                });
                return;
            }

            const producto = parts[1].toLowerCase();
            const tipo = parts[2].toLowerCase();
            const cuenta = parts.slice(3).join(" ").trim();

            if (!cuenta.includes(":")) {
                await sock.sendMessage(from, {
                    text: "❌ Formato de cuenta inválido.\nUsa: correo@gmail.com:clave"
                });
                return;
            }

            const products = loadProducts();
            const stock = loadStock();

            ensureProduct(products, stock, producto, tipo);
            stock[producto][tipo].push(cuenta);

            saveProducts(products);
            saveStock(stock);

            await sock.sendMessage(from, {
                text: `✅ Cuenta agregada a *${producto}* / *${tipo}*.\nDisponibles: *${stock[producto][tipo].length}*`
            });
            return;
        }

        if (text.startsWith(".precio ")) {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }

            const parts = rawText.split(/\s+/);
            if (parts.length < 4) {
                await sock.sendMessage(from, {
                    text: "❌ Uso:\n.precio netflix perfil 80"
                });
                return;
            }

            const producto = parts[1].toLowerCase();
            const tipo = parts[2].toLowerCase();
            const precio = Number(parts[3]);

            if (Number.isNaN(precio) || precio < 0) {
                await sock.sendMessage(from, { text: "❌ Precio inválido." });
                return;
            }

            const products = loadProducts();
            const stock = loadStock();

            ensureProduct(products, stock, producto, tipo);
            products[producto][tipo].precio = precio;

            saveProducts(products);
            saveStock(stock);

            await sock.sendMessage(from, {
                text: `✅ Precio actualizado: *${producto}* / *${tipo}* = *${precio} créditos*`
            });
            return;
        }

        if (text === ".stockver") {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }

            const products = loadProducts();
            const stock = loadStock();
            await sock.sendMessage(from, {
                text: listStockSummary(products, stock)
            });
            return;
        }

        if (text === ".ventas") {
            if (!await isAdmin(sock, from, senderJid)) {
                await sock.sendMessage(from, { text: "⛔ Solo administradores." });
                return;
            }

            const sales = loadSales();
            await sock.sendMessage(from, {
                text: lastSalesText(sales, 15)
            });
            return;
        }

        // ==============================
        // CLIENTES
        // ==============================
        if (text === ".creditos") {
            const users = loadUsers();
            const user = getOrCreateUser(users, senderJid);
            saveUsers(users);

            await sock.sendMessage(from, {
                text: `💳 *Tus créditos disponibles:* *${user.creditos}*`
            });
            return;
        }

        if (text === ".stock") {
            const products = loadProducts();
            const stock = loadStock();

            await sock.sendMessage(from, {
                text: listStockSummary(products, stock)
            });
            return;
        }

        if (text.startsWith(".stock ")) {
            const parts = rawText.split(/\s+/);
            const producto = parts[1]?.toLowerCase();

            if (!producto) {
                await sock.sendMessage(from, {
                    text: "❌ Uso:\n.stock netflix"
                });
                return;
            }

            const products = loadProducts();
            const stock = loadStock();
            const detail = productStockDetail(products, stock, producto);

            if (!detail) {
                await sock.sendMessage(from, {
                    text: `❌ No existe el producto *${producto}*.`
                });
                return;
            }

            await sock.sendMessage(from, { text: detail });
            return;
        }

        if (text.startsWith(".comprar ")) {
            const parts = rawText.split(/\s+/);
            if (parts.length < 3) {
                await sock.sendMessage(from, {
                    text: "❌ Uso:\n.comprar netflix perfil"
                });
                return;
            }

            const producto = parts[1].toLowerCase();
            const tipo = parts[2].toLowerCase();

            const users = loadUsers();
            const products = loadProducts();
            const stock = loadStock();
            const sales = loadSales();

            if (!products[producto] || !products[producto][tipo]) {
                await sock.sendMessage(from, {
                    text: "❌ Ese producto o tipo no existe."
                });
                return;
            }

            const disponibles = stock[producto]?.[tipo]?.length ?? 0;
            if (disponibles <= 0) {
                await sock.sendMessage(from, {
                    text: `❌ No hay stock disponible de *${producto}* / *${tipo}*.`
                });
                return;
            }

            const precio = Number(products[producto][tipo].precio ?? 0);
            const user = getOrCreateUser(users, senderJid);

            if (user.creditos < precio) {
                await sock.sendMessage(from, {
                    text: `❌ No tienes créditos suficientes.\n💳 Precio: *${precio}*\n💰 Tu saldo: *${user.creditos}*`
                });
                return;
            }

            const cuenta = stock[producto][tipo].shift();
            user.creditos -= precio;
            user.compras += 1;

            const telefono = jidToPhone(senderJid);

            sales.push({
                usuario: senderJid,
                telefono,
                producto,
                tipo,
                precio,
                cuenta,
                fecha: new Date().toLocaleString("es-MX")
            });

            saveUsers(users);
            saveStock(stock);
            saveSales(sales);

            const entregaPrivada = `✅ *Compra realizada con éxito*

📦 Servicio: *${producto}*
📌 Tipo: *${tipo}*
💳 Créditos descontados: *${precio}*

🔐 *Tus accesos:*
${cuenta}

⚠️ No modifiques los datos de la cuenta.
Gracias por tu compra.`;

            try {
                await sock.sendMessage(senderJid, { text: entregaPrivada });

                await sock.sendMessage(from, {
                    text: `✅ *Compra realizada correctamente*\n\n📦 ${producto} / ${tipo}\n💳 Se descontaron *${precio} créditos*\n📩 Te envié los accesos por privado.`
                });
            } catch (err) {
                // Si falla el privado, no devolvemos stock/créditos en esta v1.
                // Solo avisamos para que el admin lo revise.
                await sock.sendMessage(from, {
                    text: "⚠️ Compra procesada, pero no pude enviarte el mensaje privado. Escribe al admin."
                });
                console.error("❌ Error enviando privado:", err);
            }

            return;
        }

        // ==============================
        // COMANDOS PERSONALIZADOS
        // ==============================
        const comandos = loadComandos();
        if (comandos[text]) {
            await sock.sendMessage(from, { text: comandos[text] });
        }
    });
}

process.on("uncaughtException", (err) => {
    console.error("❌ uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
    console.error("❌ unhandledRejection:", reason);
});

startBot();
