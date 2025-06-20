// pages/api/fm-proxy.js (或者 api/fm-proxy.js，取決於您的 Vercel 項目結構)

// 從環境變數獲取敏感資訊
// 注意：這裡使用 process.env.FM_ACCOUNT_NAME 和 process.env.FM_ACCOUNT_PASSWORD，
// 假設這些是設定為 Vercel 的敏感環境變數，不以 NEXT_PUBLIC_ 開頭。
const FM_SERVER_HOST = process.env.FM_SERVER_HOST; // 例如：'ym-fm.thebarkingdog.tw'
const FM_DATABASE_NAME = process.env.FM_DATABASE_NAME; // 例如：'Cleaners'
const FM_ACCOUNT_NAME = process.env.FM_ACCOUNT_NAME; // 例如：'APIAPI'
const FM_PASSWORD = process.env.FM_ACCOUNT_PASSWORD; // 例如：'youngman@!'

// FileMaker 特定配置
const FM_LAYOUT_NAME = 'X_登入'; // 您要操作的布局名稱
const FM_UUID_FIELD = '系統UUID'; // 您要儲存 UUID 的字段名稱

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: '只允許 POST 請求' });
    }

    const { uuid } = req.body;

    if (!uuid) {
        return res.status(400).json({ message: '缺少 UUID 參數' });
    }

    let token = null;

    try {
        // 1. 認證 FileMaker Data API
        const authUrl = `https://${FM_SERVER_HOST}/fmi/data/v1/databases/${FM_DATABASE_NAME}/sessions`;
        const credentials = Buffer.from(`${FM_ACCOUNT_NAME}:${FM_PASSWORD}`).toString('base64');

        const authResponse = await fetch(authUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${credentials}`
            },
            body: JSON.stringify({}) // Empty body for session creation
        });

        if (!authResponse.ok) {
            const errorData = await authResponse.json();
            throw new Error(`FileMaker API 認證失敗: ${authResponse.status} - ${errorData.messages[0].message}`);
        }

        const authData = await authResponse.json();
        token = authData.response.token; // 獲取會話令牌

        // 2. 檢查 UUID 是否已存在於 FileMaker (透過查詢)
        const findUrl = `https://${FM_SERVER_HOST}/fmi/data/v1/databases/${FM_DATABASE_NAME}/layouts/${FM_LAYOUT_NAME}/_find`;
        const findResponse = await fetch(findUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                query: [{ [FM_UUID_FIELD]: `==${uuid}` }] // 查詢指定字段是否匹配UUID
            })
        });

        if (!findResponse.ok) {
            const errorData = await findResponse.json();
            throw new Error(`查詢 UUID 失敗: ${findResponse.status} - ${errorData.messages[0].message}`);
        }

        const findData = await findResponse.json();
        const uuidExists = findData.response.data.length > 0;

        // 3. 如果 UUID 不存在，則創建新記錄
        if (!uuidExists) {
            const createUrl = `https://${FM_SERVER_HOST}/fmi/data/v1/databases/${FM_DATABASE_NAME}/layouts/${FM_LAYOUT_NAME}/records`;
            const createResponse = await fetch(createUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    fieldData: { [FM_UUID_FIELD]: uuid } // 將 UUID 寫入指定字段
                })
            });

            if (!createResponse.ok) {
                const errorData = await createResponse.json();
                throw new Error(`創建 UUID 記錄失敗: ${createResponse.status} - ${errorData.messages[0].message}`);
            }
            res.status(200).json({ message: 'UUID 記錄已成功創建。', uuid: uuid, action: 'created' });
        } else {
            res.status(200).json({ message: 'UUID 記錄已存在。', uuid: uuid, action: 'exists' });
        }

    } catch (error) {
        console.error('API Route 處理裝置 UUID 流程時發生錯誤:', error);
        res.status(500).json({ message: '伺服器內部錯誤', error: error.message });
    } finally {
        // 4. 登出 Data API 會話 (如果已獲取令牌)
        if (token) {
            try {
                await fetch(`https://${FM_SERVER_HOST}/fmi/data/v1/databases/${FM_DATABASE_NAME}/sessions/${token}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                console.log('Data API session logged out.');
            } catch (logoutError) {
                console.error('Data API logout failed:', logoutError);
            }
        }
    }
}
