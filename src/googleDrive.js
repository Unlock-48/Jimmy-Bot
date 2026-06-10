// src/googleDrive.js
import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { Readable } from 'stream';

// 1. ตั้งค่าที่อยู่ไฟล์กุญแจและไฟล์ Token ที่จะใช้บันทึกสิทธิ์ล็อกอิน
const CREDENTIALS_PATH = path.join(process.cwd(), 'src', 'oauth-credentials.json');
const TOKEN_PATH = path.join(process.cwd(), 'src', 'token.json');

// สิทธิ์สูงสุดในการจัดการไฟล์บน Google Drive
const SCOPES = ['https://www.googleapis.com/auth/drive'];

/**
 * ฟังก์ชันสร้างตัวตนล็อกอินแบบ OAuth2 ทำงานอัตโนมัติ
 */
async function getAuthenticatedClient() {
    // ตรวจสอบว่ามีไฟล์กุญแจตั้งค่าไว้หรือยัง
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        throw new Error('❌ ไม่พบไฟล์ src/oauth-credentials.json กรุณาดาวน์โหลดมาจาก Google Cloud Console ครับ');
    }

    const content = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
    const credentials = JSON.parse(content);
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web || {};
    
    // สร้าง OAuth2 Client ตามโครงสร้างที่ Google กำหนด
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris ? redirect_uris[0] : 'http://localhost');

    // ถ้าเคยล็อกอินผ่านแล้ว และมีไฟล์ token.json อยู่ในเครื่อง ให้ดึงมาใช้ล็อกอินทันที
    if (fs.existsSync(TOKEN_PATH)) {
        const token = fs.readFileSync(TOKEN_PATH, 'utf8');
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
    }

    // 🔑 กรณีรันครั้งแรก: ต้องเริ่มกระบวนการขอ Token สิทธิ์ล็อกอินใหม่บน Terminal
    return new Promise((resolve, reject) => {
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline', // ขอ Offline เพื่อให้ได้ Refresh Token มาใช้ปั๊ม Token ใหม่ยาวๆ
            scope: SCOPES,
        });

        console.log('\n================================================================');
        console.log('🔒 [Google OAuth2] บอทต้องการขอสิทธิ์เข้าถึง Google Drive ในฐานะตัวคุณ');
        console.log('👉 กรุณาคลิกลิงก์ด้านล่างนี้เพื่อเข้าสู่ระบบและอนุญาตสิทธิ์:');
        console.log(authUrl);
        console.log('================================================================\n');

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        rl.question('📥 หลังจากอนุญาตสิทธิ์เสร็จแล้ว ให้นำ "Code" ที่ได้จากหน้าเว็บมาวางตรงนี้: ', (code) => {
            rl.close();
            oAuth2Client.getToken(code, (err, token) => {
                if (err) {
                    console.error('❌ เกิดข้อผิดพลาดในการรับ Token:', err);
                    return reject(err);
                }
                oAuth2Client.setCredentials(token);
                // บันทึก Token ลงไฟล์ไว้ใช้ในครั้งต่อไปอัตโนมัติ
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
                console.log('✅ บันทึกสิทธิ์การเข้าถึงเรียบร้อยแล้วที่ src/token.json');
                resolve(oAuth2Client);
            });
        });
    });
}

// โหลดไอดีโฟลเดอร์ปลายทางจากไฟล์ .env (เป็นไอดีโฟลเดอร์ปกติบน Drive ของพี่ได้เลยครับ)
const MAIN_FOLDER_ID = process.env.GOOGLE_MAIN_FOLDER_ID;

/**
 * ฟังก์ชันสร้างโฟลเดอร์ย่อยข้างในโฟลเดอร์หลัก
 */
export async function createSubFolder(folderName) {
    try {
        const authClient = await getAuthenticatedClient();
        const drive = google.drive({ version: 'v3', auth: authClient });

        const fileMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [MAIN_FOLDER_ID],
        };

        const response = await drive.files.create({
            resource: fileMetadata,
            fields: 'id',
        });
        return response.data.id;
    } catch (error) {
        console.error(`❌ [Google Drive] เกิดข้อผิดพลาดในการสร้างโฟลเดอร์ ${folderName}:`, error);
        throw error;
    }
}

/**
 * ฟังก์ชันดาวน์โหลดไฟล์จาก Discord แล้วอัปโหลดตรงเข้า Google Drive ของคุณโดยตรง
 */
export async function uploadFileToDrive(fileUrl, fileName, mimeType, targetFolderId) {
    try {
        const authClient = await getAuthenticatedClient();
        const drive = google.drive({ version: 'v3', auth: authClient });

        // 1. ดึงไฟล์จากดิสคอร์ด
        const fileResponse = await fetch(fileUrl);
        if (!fileResponse.ok) throw new Error('ไม่สามารถดาวน์โหลดไฟล์จาก Discord ได้');
        
        const arrayBuffer = await fileResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        const bufferStream = new Readable();
        bufferStream.push(buffer);
        bufferStream.push(null);

        const fileMetadata = {
            name: fileName,
            parents: [targetFolderId],
        };

        const media = {
            mimeType: mimeType,
            body: bufferStream,
        };

        // 2. อัปโหลดตรงเข้าไดรฟ์ (ใช้พื้นที่โควต้า 15GB ของตัวพี่เองโดยตรง)
        const googleResponse = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id, webViewLink',
        });

        // 3. เปิดสิทธิ์ให้คนที่ได้ลิงก์สามารถกดเปิดอ่านดูรูปได้ตามปกติ
        await drive.permissions.create({
            fileId: googleResponse.data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });

        return googleResponse.data.webViewLink;
    } catch (error) {
        console.error('❌ [Google Drive] เกิดข้อผิดพลาดในการอัปโหลดไฟล์:', error);
        throw error;
    }
}