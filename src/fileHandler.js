// src/fileHandler.js

/**
 * ฟังก์ชันตรวจสอบและดึงข้อมูลไฟล์แนบจากข้อความ Discord
 * @param {import('discord.js').Message} message 
 * @returns {Array<{name: string, url: string, contentType: string}> | null}
 */
export function checkAttachments(message) {
    // ถ้าไม่มีไฟล์แนบมาเลย ให้ส่งค่ากลับเป็น null
    if (message.attachments.size === 0) return null;

    const filesData = [];

    // วนลูปดึงข้อมูลไฟล์ทั้งหมดที่อัปโหลดมาในข้อความนั้น (เผื่อผู้ใช้โยนมาพร้อมกันหลายไฟล์)
    message.attachments.forEach(attachment => {
        filesData.push({
            name: attachment.name,             // ชื่อไฟล์ เช่น receipt.png
            url: attachment.url,               // ลิงก์ดาวน์โหลดชั่วคราวจากเซิร์ฟเวอร์ Discord
            contentType: attachment.contentType // ประเภทไฟล์ เช่น image/png, application/pdf
        });
    });

    return filesData;
}