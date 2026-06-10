// src/database.js
import { createClient } from '@libsql/client';

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    console.error("❌ Error: ไม่พบค่าตั้งค่าความลับของ Turso ในไฟล์ .env");
    process.exit(1);
}

// 1. เปิดท่อเชื่อมต่อตรงเข้าคลาวด์
const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

// 2. ฟังก์ชันช่วยสร้างตารางอัตโนมัติ (สคริปต์เริ่มต้น)
export async function initDatabase() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS drive_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_name TEXT UNIQUE,
            google_drive_folder_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

// 3. ฟังก์ชันดึงรายชื่อโฟลเดอร์ทั้งหมด
export async function getAllFolders() {
    const result = await db.execute("SELECT * FROM drive_folders");
    return result.rows;
}

// 4. บันทึกโฟลเดอร์ใหม่
export async function insertFolder(categoryName, folderId) {
    await db.execute({
        sql: "INSERT OR REPLACE INTO drive_folders (category_name, google_drive_folder_id) VALUES (?, ?)",
        args: [categoryName, folderId]
    });
}