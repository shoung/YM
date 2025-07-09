// api/AdressToGPS.js
import fetch from 'node-fetch';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    // 從 Vercel 環境變數中安全地讀取 FileMaker 敏感資訊
    const FM_SERVER_HOST = process.env.FM_SERVER_HOST;
    const FM_ACCOUNT_NAME = process.env.FM_ACCOUNT_NAME;
    const FM_ACCOUNT_PASSWORD = process.env.FM_ACCOUNT_PASSWORD;
    // GoogleMap_API_Key 不再需要，因為不再進行地理編碼

    // 從前端請求的 body 中獲取非敏感資訊 (現在直接是經緯度)
    const { database, layout, recordId, latitude, longitude, latitudeField, longitudeField } = req.body;

    // 檢查必要的環境變數和請求參數
    if (!FM_SERVER_HOST || !FM_ACCOUNT_NAME || !FM_ACCOUNT_PASSWORD) {
        console.error('Missing required FileMaker environment variables!');
        return res.status(500).json({ success: false, message: 'Server configuration error: Missing FileMaker credentials.' });
    }
    // latitude 和 longitude 現在是直接從前端傳來的，所以需要檢查它們是否為有效數字
    if (!database || !layout || !recordId || typeof latitude !== 'number' || typeof longitude !== 'number' || !latitudeField || !longitudeField) {
        return res.status(400).json({ success: false, message: 'Missing required parameters or invalid GPS coordinates from client request.' });
    }

    let token = null;

    try {
        // 1. 認證 FileMaker Data API
        const authUrl = `https://${FM_SERVER_HOST}/fmi/data/vLatest/databases/${database}/sessions`;
        const authHeaders = {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + Buffer.from(`${FM_ACCOUNT_NAME}:${FM_ACCOUNT_PASSWORD}`).toString('base64')
        };

        const authResponse = await fetch(authUrl, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({})
        });

        if (!authResponse.ok) {
            const errorData = await authResponse.json();
            throw new Error(`FileMaker 認證失敗: ${authResponse.status} ${authResponse.statusText} - ${JSON.stringify(errorData)}`);
        }

        const authData = await authResponse.json();
        token = authData.response.token;
        console.log('FileMaker 認證成功，Token:', token);

        // 2. 更新 FileMaker 記錄
        const updateUrl = `https://${FM_SERVER_HOST}/fmi/data/vLatest/databases/${database}/layouts/${layout}/records/${recordId}`;
        const updateHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
        const updateBody = {
            fieldData: {
                [latitudeField]: latitude,
                [longitudeField]: longitude
            }
        };

        const updateResponse = await fetch(updateUrl, {
            method: 'PATCH',
            headers: updateHeaders,
            body: JSON.stringify(updateBody)
        });

        if (!updateResponse.ok) {
            const errorData = await updateResponse.json();
            throw new Error(`更新記錄失敗: ${updateResponse.status} ${updateResponse.statusText} - ${JSON.stringify(errorData)}`);
        }

        const updateData = await updateResponse.json();
        console.log('FileMaker 記錄更新成功:', updateData);

        // 成功回傳給前端，包含回傳的經緯度
        res.status(200).json({ success: true, message: 'GPS 座標已成功回傳 FileMaker！', latitude: latitude, longitude: longitude, data: updateData });

    } catch (error) {
        console.error('代理伺服器錯誤:', error);
        res.status(500).json({ success: false, message: `伺服器處理失敗: ${error.message}` });
    } finally {
        // 3. 登出 FileMaker Data API session (如果已獲取 token)
        if (token) {
            const logoutUrl = `https://${FM_SERVER_HOST}/fmi/data/vLatest/databases/${database}/sessions/${token}`;
            try {
                await fetch(logoutUrl, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                console.log('FileMaker session 已登出。');
            } catch (logoutError) {
                console.error('FileMaker session 登出錯誤:', logoutError);
            }
        }
    }
}
