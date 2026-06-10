// src/fileUI.js
import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { getAllFolders, insertFolder } from './database.js';
import { createSubFolder, uploadFileToDrive } from './googleDrive.js';

/**
 * ฟังก์ชันสร้างและจัดการระบบเมนูปุ่มกด/Dropdown สำหรับคัดแยกไฟล์ รองรับทั้งพีซีและมือถือ
 * เวอร์ชันอัปเกรดระบบ Auto-Healing ป้องกันโฟลเดอร์โดนลบบนไดรฟ์จริง (Error 404)
 */
export async function handleFileUIWorkflow(groq, message, firstFile, prompt, initialStatus) {
    try {
        // 1. ให้ AI ช่วยวิเคราะห์คิดชื่อแนะนำมาเป็นทางเลือกแรก
        const aiResponse = await groq.chat.completions.create({
            messages: [{ 
                role: 'user', 
                content: `คิดชื่อโฟลเดอร์ภาษาอังกฤษสั้นๆ 1 คำที่เหมาะกับไฟล์นี้: "${firstFile.name}" ${prompt ? `คำอธิบายจากผู้ใช้: "${prompt}"` : ''} ตอบเฉพาะชื่อคำนั้นเพียวๆ ห้ามมีเครื่องหมายคำพูด ห้ามมีจุด` 
            }],
            model: 'llama-3.1-8b-instant',
        });
        const aiSuggestedName = aiResponse.choices[0].message.content.trim().replace(/['"-.]/g, '');

        // 2. ดึงรายชื่อโฟลเดอร์เก่าทั้งหมดจากคลาวด์มาทำเมนู Dropdown
        const dbFolders = await getAllFolders();
        const components = [];

        // 🟢 แถวที่ 1: ปุ่มยืนยันเอาตาม AI หรือพิมพ์ตั้งชื่อใหม่เอง
        const actionRowButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('use_ai_name')
                .setLabel(`🟢 ใช้โฟลเดอร์แนะนำ: ${aiSuggestedName}`)
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('custom_name')
                .setLabel('🔴 พิมพ์ชื่อโฟลเดอร์เอง')
                .setStyle(ButtonStyle.Danger)
        );
        components.push(actionRowButtons);

        // 🔵 แถวที่ 2: เมนูเลือกจากโฟลเดอร์เดิม (ถ้าใน DB มีข้อมูลอยู่)
        if (dbFolders.length > 0) {
            const selectOptions = dbFolders.map(f => {
                // ตัดคำแสดงผลบน Label ไม่ให้เกินขีดจำกัด Discord (สูงสุด 100 ตัวอักษร)
                let displayLabel = f.category_name.length > 50 
                    ? f.category_name.substring(0, 47) + '...' 
                    : f.category_name;

                return {
                    label: `📂 โฟลเดอร์เดิม: ${displayLabel}`,
                    // ส่งไปเฉพาะตัวไอดีเพื่อไม่ให้ความยาว string เกิน 100 ตัวอักษร ป้องกันบั๊ก Builders
                    value: f.google_drive_folder_id, 
                };
            }).slice(0, 25); // Discord จำกัดเมนูสูงสุด 25 ตัวเลือก

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_old_folder')
                .setPlaceholder('🔵 หรือจิ้มเลือกใช้โฟลเดอร์เดิมตรงนี้ได้เลย...')
                .addOptions(selectOptions);

            components.push(new ActionRowBuilder().addComponents(selectMenu));
        }

        // พ่น UI อินเตอร์เฟสออกหน้าจอแชทดิสคอร์ด
        await initialStatus.edit({
            content: `📱 **[เมนูจัดการระบบไฟล์คลาวด์]**\n• **ไฟล์ของคุณ:** \`${firstFile.name}\`\n• พี่อยากเอาไฟล์นี้ไปหย่อนไว้ที่โฟลเดอร์ไหนดีครับ? จิ้มเลือกปุ่มด้านล่างจากหน้าจอมือถือได้เลยครับ!`,
            components: components
        });

        // เปิดระบบ Collector รอสกัดสัญญาณปุ่มกดภายในระยะเวลา 5 นาที
        const collector = initialStatus.createMessageComponentCollector({ idle: 300000 });

        collector.on('collect', async (interaction) => {
            if (interaction.user.id !== message.author.id) {
                return interaction.reply({ content: "❌ เมนูนี้เป็นของเจ้าของไฟล์เท่านั้นครับ", ephemeral: true });
            }

            let chosenFolderName = "Selected_Folder"; 
            let targetFolderId = "";

            if (interaction.customId === 'use_ai_name') {
                await interaction.update({ content: `⏳ กำลังเตรียมโฟลเดอร์ \`${aiSuggestedName}\` บนคลังระบบ...`, components: [] });
                chosenFolderName = aiSuggestedName;
            } 
            else if (interaction.customId === 'select_old_folder') {
                targetFolderId = interaction.values[0];
                
                const currentFolders = await getAllFolders();
                const found = currentFolders.find(f => f.google_drive_folder_id === targetFolderId);
                if (found) chosenFolderName = found.category_name;

                await interaction.update({ content: `⏳ เลือกใช้โฟลเดอร์เดิม \`${chosenFolderName}\`...`, components: [] });
            } 
            else if (interaction.customId === 'custom_name') {
                const modal = new ModalBuilder().setCustomId('custom_name_modal').setTitle('ตั้งชื่อโฟลเดอร์ใหม่');
                const nameInput = new TextInputBuilder()
                    .setCustomId('folder_name_input')
                    .setLabel('พิมพ์ชื่อโฟลเดอร์ภาษาอังกฤษที่คุณต้องการ')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('เช่น Slip, Work, Project')
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
                await interaction.showModal(modal);

                const modalSubmit = await interaction.awaitModalSubmit({ time: 60000 }).catch(() => null);
                if (!modalSubmit) return;

                chosenFolderName = modalSubmit.fields.getTextInputValue('folder_name_input').trim().replace(/['"-.]/g, '');
                await modalSubmit.update({ content: `⏳ กำลังเตรียมเปิดโฟลเดอร์ใหม่ชื่อ \`${chosenFolderName}\`...`, components: [] });
            }

            // ==========================================
            // 🚀 พาร์ทตรวจสอบพิกัด และอัปโหลดไฟล์จริง
            // ==========================================
            try {
                if (!targetFolderId) {
                    const currentFolders = await getAllFolders();
                    const match = currentFolders.find(f => f.category_name.toLowerCase() === chosenFolderName.toLowerCase());
                    
                    if (match) {
                        targetFolderId = match.google_drive_folder_id;
                    } else {
                        targetFolderId = await createSubFolder(chosenFolderName);
                        await insertFolder(chosenFolderName, targetFolderId);
                    }
                }

                await initialStatus.edit({ content: `🚀 สิทธิ์ผ่าน! กำลังส่งไฟล์ \`${firstFile.name}\` เข้าสู่ Google Drive ของคุณ...` });
                
                let link;
                try {
                    // ลองสั่งอัปโหลดไฟล์เข้าไปที่ Google Drive
                    link = await uploadFileToDrive(firstFile.url, firstFile.name, firstFile.contentType, targetFolderId);
                } catch (uploadErr) {
                    // 🔥 [Auto-Healing Logic] ถ้า Google สวนกลับมาว่าหาโฟลเดอร์ไม่เจอ (404) 
                    if (uploadErr.code === 404 || uploadErr.status === 404 || (uploadErr.message && uploadErr.message.includes('not found'))) {
                        await initialStatus.edit({ content: `⚠️ ตรวจพบว่าโฟลเดอร์เดิมบนไดรฟ์จริงถูกลบไปแล้ว... กำลังซ่อมแซมสร้างโฟลเดอร์ใหม่ให้คุณอัตโนมัติ...` });
                        
                        // สั่งชุบชีวิตสร้างโฟลเดอร์อันใหม่ชื่อเดิมบนไดรฟ์ แล้วบันทึกไอดีใหม่ทับลง Turso คลาวด์
                        targetFolderId = await createSubFolder(chosenFolderName);
                        await insertFolder(chosenFolderName, targetFolderId); 
                        
                        // สั่งอัปโหลดซ้ำอีกรอบเข้าพิกัดใหม่ที่ถูกต้อง
                        link = await uploadFileToDrive(firstFile.url, firstFile.name, firstFile.contentType, targetFolderId);
                    } else {
                        throw uploadErr; 
                    }
                }

                // ประกาศความสำเร็จพร้อมพ่นลิงก์ให้คนใช้กดดูได้เลย
                await initialStatus.edit({
                    content: `✅ **จัดเก็บลงคลาวด์เสร็จเรียบร้อยครับพี่!**\n• **ชื่อไฟล์:** \`${firstFile.name}\`\n• **ตำแหน่งที่เก็บ (Folder):** \`${chosenFolderName}\`\n• 🌐 **ลิงก์เปิดไฟล์บน Google Drive:**\n[คลิกเพื่อเปิดดูไฟล์ที่นี่](${link})`,
                    components: []
                });
                
                collector.stop();

            } catch (err) {
                console.error("❌ เกิดข้อผิดพลาดในตัวจัดเก็บย่อย:", err);
                await initialStatus.edit({ content: "❌ เกิดข้อผิดพลาดร้ายแรงในการอัปโหลด กรุณาลองใหมี่อีกครั้งครับ", components: [] });
                collector.stop();
            }
        });

    } catch (error) {
        console.error("❌ UI Workflow Error:", error);
        await initialStatus.edit({ content: "❌ ระบบวิเคราะห์อินเตอร์เฟสขัดข้อง ลองใหม่เปลี่ยนชื่อดูนะครับ", components: [] });
    }
}