// src/fileClassifier.js
import { getAllFolders, insertFolder } from './database.js';
import { createSubFolder } from './googleDrive.js';

/**
 * ฟังก์ชันให้ AI วิเคราะห์ประเภทไฟล์ และจัดการหาพิกัดโฟลเดอร์ปลายทาง
 * @param {import('openai').OpenAI} groq Instance ของ Groq AI
 * @param {object} file ข้อมูลไฟล์แนบ (name, url, contentType)
 * @param {string} userPrompt ข้อความที่ผู้ใช้พิมพ์แนบมาพร้อมไฟล์
 * @param {object} statusMessage Object ข้อความดิสคอร์ดสำหรับใช้อัปเดตสถานะหน้าจอ
 * @returns {Promise<{fileCategory: string, targetFolderId: string, isNew: boolean}>}
 */
export async function classifyAndGetFolder(groq, file, userPrompt, statusMessage) {
    const classificationPrompt = `จงวิเคราะห์ไฟล์นี้จากชื่อไฟล์: "${file.name}" และข้อความอธิบายจากผู้ใช้: "${userPrompt}"
    แล้วให้คุณคิดชื่อโฟลเดอร์/หมวดหมู่ที่เหมาะสมที่สุดสำหรับใช้จัดเก็บไฟล์นี้มา 1 ชื่อ
    กฎการตอบ:
    1. ตอบเป็นคำภาษาอังกฤษสั้นๆ 1-2 คำเท่านั้น เช่น Certificate, Tax_Invoice, Resume, Profile_Pic, Logo_Files
    2. ห้ามมีเครื่องหมายคำพวก ห้ามมีจุด และห้ามอธิบายเหตุผล ตอบเฉพาะชื่อโฟลเดอร์เพียวๆ เท่านั้น`;
    
    const aiResponse = await groq.chat.completions.create({
        messages: [{ role: 'user', content: classificationPrompt }],
        model: 'llama-3.1-8b-instant',
    });

    let fileCategory = aiResponse.choices[0].message.content.trim();
    fileCategory = fileCategory.replace(/['"-.]/g, ''); // ดัดนิสัยเคลียร์เครื่องหมายส่วนเกิน

    await statusMessage.edit(`📂 AI คัดแยกหมวดหมู่ได้เป็น: \`${fileCategory}\`\n⏳ กำลังตรวจสอบประวัติพิกัดบนฐานข้อมูลคลาวด์...`);

    // 2. ค้นหาในประวัติความจำคลาวด์ Turso
    const allFolders = await getAllFolders();
    const existingFolder = allFolders.find(f => f.category_name.toLowerCase() === fileCategory.toLowerCase());
    
    let targetFolderId = "";

    if (existingFolder) {
        // เคสที่ 1: เจอโฟลเดอร์เดิมในฐานข้อมูลคลาวด์
        targetFolderId = existingFolder.google_drive_folder_id;
        return {
            fileCategory: existingFolder.category_name,
            targetFolderId,
            isNew: false
        };
    } else {
        // เคสที่ 2: เป็นหมวดหมู่ใหม่เอี่ยม สั่งสร้างโฟลเดอร์บน Google Drive
        await statusMessage.edit(`🆕 ไม่พบโฟลเดอร์สำหรับหมวดหมู่ \`${fileCategory}\` ในระบบความจำ\n⏳ กำลังสร้างพื้นที่โฟลเดอร์ใหม่บน Google Drive...`);
        
        try {
            targetFolderId = await createSubFolder(fileCategory);
            await insertFolder(fileCategory, targetFolderId);
        } catch (error) {
            console.error("⚠️ [Classifier Error] สลับสิทธิ์หรือฐานข้อมูลมีปัญหา สร้างโฟลเดอร์สำรองซ้ำอีกครั้ง...");
            targetFolderId = await createSubFolder(fileCategory);
        }

        return {
            fileCategory,
            targetFolderId,
            isNew: true
        };
    }
}