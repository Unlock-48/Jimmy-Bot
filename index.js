// index.js
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import OpenAI from 'openai';
import { initDatabase, getAllFolders } from './src/database.js';
import { checkAttachments } from './src/fileHandler.js';
import { handleFileUIWorkflow } from './src/fileUI.js'; // 🆕 ใช้ตัวจัดการระบบปุ่มกดที่แยกไฟล์ไว้

// ตรวจสอบตัวแปรใน .env ให้ครบถ้วน ปลอดภัยระดับ Production
if (!process.env.DISCORD_TOKEN || !process.env.GROQ_API_KEY || 
    !process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN || 
    !process.env.GOOGLE_MAIN_FOLDER_ID) {
    console.error("❌ Error: ข้อมูลในไฟล์ .env ไม่ครบถ้วน กรุณาเช็คค่าคอนฟิกต่างๆ ให้ครบครับ");
    process.exit(1);
}

// 1. ตั้งค่าการเชื่อมต่อ Groq Cloud AI
const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1"
});

// 2. ตั้งค่าการเชื่อมต่อบอท Discord พร้อมสิทธิ์การดักอ่านข้อความ
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const AI_CHANNEL_ID = "1514319805681762405"; // ไอดีห้องล็อกสำหรับใช้งานบอท
const chatHistoryMap = new Map();
const MAX_HISTORY = 10;

// เมื่อบอทออนไลน์ สั่งให้เริ่มเปิดท่อเชื่อมต่อฐานข้อมูลคลาวด์ Turso ทันที
client.on('ready', async () => {
    console.log(`✅ บอทระบบจัดการไฟล์อัตโนมัติ ออนไลน์แล้ว: ${client.user.tag}`);
    try {
        await initDatabase();
        console.log("🟢 [Database] ระบบคลาวด์ฐานข้อมูล Turso พร้อมใช้งาน!");
    } catch (dbError) {
        console.error("❌ [Database Error] ไม่สามารถเชื่อมต่อ Turso ได้:", dbError);
    }
});

// สัญญาณดักรับข้อความจาก Discord
client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // ไม่ตอบสนองต่อบอทตัวอื่น

    const isAiChannel = message.channel.id === AI_CHANNEL_ID;
    const isBotMentioned = message.mentions.has(client.user);

    if (isAiChannel || isBotMentioned) {
        try {
            const botRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
            const prompt = message.content.replace(botRegex, '').trim();
            const lowerPrompt = prompt.toLowerCase();

            // =========================================================
            // 📂 [1. ระบบดักจับไฟล์ และส่งต่อให้โมดูล UI ปุ่มกดทำงาน]
            // =========================================================
            const uploadedFiles = checkAttachments(message);
            if (uploadedFiles) {
                const initialStatus = await message.reply("⏳ ให้ AI ช่วยวิเคราะห์ชื่อโฟลเดอร์แนะนำแป๊บเดียวครับ...");
                const firstFile = uploadedFiles[0];
                
                // 🚀 ส่งต่อไปให้โมดูล fileUI จัดการพ่นปุ่มกดและ Dropdown รองรับมือถือ
                return await handleFileUIWorkflow(groq, message, firstFile, prompt, initialStatus);
            }

            // =========================================================
            // 💬 [2. ระบบคำสั่งจัดการ และแชทคุยปกติระบบเดิม]
            // =========================================================
            
            // คำสั่งล้างความจำบริบทแชท
            if (lowerPrompt === 'clear' || lowerPrompt === 'ล้างสมอง') {
                chatHistoryMap.delete(AI_CHANNEL_ID);
                return message.reply("🧹 ล้างประวัติการคุยในห้องนี้เรียบร้อยแล้วครับ!");
            }

            // คำสั่งดึงดูตารางพิกัดโฟลเดอร์บน SQLite คลาวด์ของ Turso
            if (lowerPrompt === 'check db' || lowerPrompt === 'ดูโฟลเดอร์') {
                const rows = await getAllFolders();
                if (rows.length === 0) {
                    return message.reply("📁 **คลาวด์ฐานข้อมูลว่างเปล่า:** ตอนนี้ยังไม่มีโฟลเดอร์ใดๆ ถูกบันทึกไว้ครับ");
                }
                
                let listText = "🗂️ **รายชื่อโฟลเดอร์ที่บันทึกบน SQLite คลาวด์:**\n";
                for (const row of rows) {
                    listText += `• ประเภท: \`${row.category_name}\` -> Google Drive Folder ID: \`${row.google_drive_folder_id}\`\n`;
                }
                return message.reply(listText);
            }

            // เคสส่งข้อความเปล่าๆ มา
            if (!prompt || lowerPrompt === 'token' || lowerPrompt === 'status') {
                return message.reply("มีคำถามอะไรให้ผมช่วยไหมครับ? ระบบจัดเก็บบันทึกไฟล์คลาวด์สมบูรณ์แบบแล้วครับ!");
            }

            // เริ่มระบบแชทจดจำบริบทปกติ
            await message.channel.sendTyping();

            let history = chatHistoryMap.get(AI_CHANNEL_ID) || [];

            const messagesToSend = [
                { role: 'system', content: 'คุณคือผู้ช่วยอัจฉริยะ ตอบคำถามอย่างเป็นมิตร สั้นกระชับ และเข้าใจง่าย เป็นภาษาไทย และจดจำสิ่งที่คุยกันก่อนหน้านี้ด้วย' },
                ...history,
                { role: 'user', content: prompt }
            ];

            const chatCompletion = await groq.chat.completions.create({
                messages: messagesToSend,
                model: 'llama-3.1-8b-instant',
            });

            const response = chatCompletion.choices[0].message.content;

            history.push({ role: 'user', content: prompt });
            history.push({ role: 'assistant', content: response });

            if (history.length > MAX_HISTORY * 2) {
                history = history.slice(2);
            }

            chatHistoryMap.set(AI_CHANNEL_ID, history);

            if (response.length > 2000) {
                await message.reply(response.substring(0, 1995) + "...");
            } else {
                await message.reply(response);
            }

        } catch (error) {
            console.error("❌ Error Main Catch:", error);
            await message.reply("ขออภัยครับ ตอนนี้ระบบเกิดข้อผิดพลาด ลองใหม่อีกครั้งนะครับ");
        }
    }
});

client.login(process.env.DISCORD_TOKEN);