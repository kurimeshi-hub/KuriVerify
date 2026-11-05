const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const app = express();

// Expressセッション設定
app.use(session({
    secret: process.env.SESSION_SECRET || 'random_secret_key_here',
    resave: false,
    saveUninitialized: false,
}));

// Discord Botのクライアント（サーバーにユーザーを追加・ロール付与するため）
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once('ready', () => {
    console.log(`Botがログインしました: ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN);

// 1. トップページ（ログインボタンを表示）
app.get('/', (req, res) => {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join`;
    
    res.send(`
        <html>
            <body style="font-family: sans-serif; text-align: center; margin-top: 100px; background-color: #f4f6f8;">
                <div style="background: white; padding: 40px; display: inline-block; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                    <h1>サーバー認証ページ</h1>
                    <p style="color: #666; margin-bottom: 30px;">下のボタンを押してDiscord連携を行い、サーバーに参加してください。</p>
                    <a href="${discordAuthUrl}" style="background: #5865F2; color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Discordでログインして認証</a>
                </div>
            </body>
        </html>
    `);
});

// 2. 認証後のコールバック処理
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('認証コードが見つかりません。');

    try {
        // A. 認証コードを使ってアクセストークンを取得
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.REDIRECT_URI,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;

        // B. ユーザーのDiscordプロフィール情報を取得
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const userId = userResponse.data.id;
        const userName = userResponse.data.username;

        // C. サーバーにユーザーを強制参加させ、ロールを付与する
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        
        // ユーザーをサーバーに追加（guilds.joinスコープが必要）
        await guild.members.add(userId, { accessToken: accessToken });
        
        // メンバー情報を取得してロールを付与
        const member = await guild.members.fetch(userId);
        await member.roles.add(process.env.ROLE_ID);

        console.log(`[認証成功] ${userName} (${userId}) にロールを付与しました。`);

        res.send(`
            <html>
                <body style="font-family: sans-serif; text-align: center; margin-top: 100px;">
                    <h1 style="color: #2ecc71;">認証成功！</h1>
                    <p>${userName}さん、Discordサーバーへの参加と認証が完了しました。Discordアプリをご確認ください。</p>
                </body>
            </html>
        `);

    } catch (error) {
        console.error('認証エラー:', error.response?.data || error.message);
        res.status(500).send('認証処理中にエラーが発生しました。コンソールログを確認してください。');
    }
});

// DiscloudはPORT環境変数を自動指定するため、それに合わせる
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーが起動しました (Port: ${PORT})`);
});