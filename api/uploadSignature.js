// api/uploadSignature.js - 無伺服器函數 (適用於 Vercel, Netlify Functions 等)

// 導入必要的模組
// 注意: 在無伺服器環境中，node-fetch 通常是內建的，form-data 和 busboy 需要在 package.json 中聲明為依賴。
const fetch = require('node-fetch');
const FormData = require('form-data');
const Busboy = require('busboy');

// ==== FileMaker Data API 配置 (從環境變數讀取) ====
// 在 Vercel/Netlify 儀表板中設定這些環境變數，例如：
// FM_SERVER_HOST = ym-fm.thebarkingdog.tw
// FM_DATABASE_NAME = Cleaners
// FM_ACCOUNT_NAME = APIAPI
// FM_ACCOUNT_PASSWORD = youngman@!
// FM_LAYOUT_NAME = Y_合約簽名

const FILEMAKER_SERVER_HOST = process.env.FM_SERVER_HOST;
const FILEMAKER_DATABASE_NAME = process.env.FM_DATABASE_NAME;
const FILEMAKER_ACCOUNT_NAME = process.env.FM_ACCOUNT_NAME;
const FILEMAKER_ACCOUNT_PASSWORD = process.env.FM_ACCOUNT_PASSWORD;
const FILEMAKER_LAYOUT_NAME = process.env.FM_LAYOUT_NAME;

// 檢查是否所有必要的環境變數都已設定
if (!FILEMAKER_SERVER_HOST || !FILEMAKER_DATABASE_NAME || 
    !FILEMAKER_ACCOUNT_NAME || !FILEMAKER_ACCOUNT_PASSWORD || !FILEMAKER_LAYOUT_NAME) {
    console.error('錯誤: 缺少必要的 FileMaker 環境變數。請檢查您的託管平台設定。');
    // 在實際環境中，您可能需要更優雅的錯誤處理
    // 如果環境變數未設定，函數將會拋出錯誤。
}


// 無伺服器函數的入口點
// 對於 Vercel/Netlify，通常是 `module.exports = async (req, res) => { ... }`
module.exports = async (req, res) => {
    // 允許 CORS，因為前端網頁和此函數可能在不同子域名下
    // 嚴格來說，您可以限制只允許您的 GitHub Pages 網域。
    res.setHeader('Access-Control-Allow-Origin', '*'); // 允許所有來源 (為了開發方便)
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // 處理 CORS 預檢請求 (OPTIONS request)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // 只處理 POST 請求
    if (req.method !== 'POST') {
        res.status(405).json({ error: '只允許 POST 請求' });
        return;
    }

    // 獲取前端傳遞的參數 (從 URL 查詢字符串)
    const recordIdParam = req.query.recordIdParam;
    const fieldName = req.query.fieldName;

    if (!recordIdParam || !fieldName) {
        res.status(400).json({ error: '缺少必要的 FileMaker 參數 (recordIdParam 或 fieldName)。' });
        return;
    }

    // 使用 Promise 來處理 Busboy 的非同步文件解析
    let fileDataPromise = new Promise((resolve, reject) => {
        let fileData = null;
        let fileOriginalname = null;
        let fileMimeType = null;

        // 使用 busboy 解析 multipart/form-data 請求
        // req.headers 包含 Content-Type 和 boundary 信息
        const busboy = Busboy({ headers: req.headers });

        busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
            if (fieldname === 'upload') { // FileMaker Data API 期望的 part name 是 "upload"
                const chunks = [];
                file.on('data', data => chunks.push(data));
                file.on('end', () => {
                    fileData = Buffer.concat(chunks);
                    fileOriginalname = filename.filename;
                    fileMimeType = mimetype;
                });
            } else {
                file.resume(); // 忽略其他字段
            }
        });

        busboy.on('field', (fieldname, val, fieldnameTruncated, valTruncated, encoding, mimetype) => {
            // 您也可以在這裡處理其他文本字段，如果前端需要傳送
        });

        busboy.on('finish', () => {
            if (fileData) {
                resolve({ fileData, fileOriginalname, fileMimeType });
            } else {
                reject(new Error('沒有收到簽名檔案數據。'));
            }
        });

        busboy.on('error', (err) => {
            reject(new Error(`解析 multipart/form-data 失敗: ${err.message}`));
        });

        req.pipe(busboy); // 將入站請求管道傳遞給 busboy
    });

    try {
        const { fileData, fileOriginalname, fileMimeType } = await fileDataPromise;

        // Step 1: 登入 FileMaker Data API (在無伺服器函數中處理認證)
        const authUrl = `https://${FILEMAKER_SERVER_HOST}/fmi/data/v1/databases/${FILEMAKER_DATABASE_NAME}/sessions`;
        const authResponse = await fetch(authUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${FILEMAKER_ACCOUNT_NAME}:${FILEMAKER_ACCOUNT_PASSWORD}`).toString('base64')
            }
        });

        if (!authResponse.ok) {
            const errorData = await authResponse.json();
            console.error('FileMaker 登入失敗:', errorData);
            res.status(authResponse.status).json({
                error: `FileMaker 登入失敗: ${authResponse.statusText}`,
                details: errorData.messages
            });
            return;
        }

        const authData = await authResponse.json();
        const token = authData.response.token;

        // Step 2: 上傳容器數據到 FileMaker Data API
        const containerUploadURL = `https://${FILEMAKER_SERVER_HOST}/fmi/data/v1/databases/${FILEMAKER_DATABASE_NAME}/layouts/${FILEMAKER_LAYOUT_NAME}/records/${recordIdParam}/containers/${fieldName}/1`;

        const form = new FormData();
        form.append('upload', fileData, {
            filename: fileOriginalname || `signature_${recordIdParam}.png`,
            contentType: fileMimeType || 'image/png', // 使用解析到的 MIME 類型或預設
        });

        const containerUploadResponse = await fetch(containerUploadURL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                ...form.getHeaders() // 讓 form-data 模組設定正確的 Content-Type 和 boundary
            },
            body: form
        });

        if (!containerUploadResponse.ok) {
            const errorData = await containerUploadResponse.json();
            console.error('FileMaker 容器上傳失敗:', errorData);
            res.status(containerUploadResponse.status).json({
                error: `FileMaker 容器上傳失敗: ${containerUploadResponse.statusText}`,
                details: errorData.messages
            });
            return;
        }

        // 成功回應前端
        res.status(200).json({ message: '簽名已成功送出！' });

    } catch (error) {
        console.error('無伺服器函數處理請求時發生錯誤:', error);
        res.status(500).json({ error: '代理伺服器內部錯誤', details: error.message });
    }
};
