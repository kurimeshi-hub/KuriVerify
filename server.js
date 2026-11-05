const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const express = require('express');
const session = require('express-session');
const axios = require('axios');

// 1. 必要な環境変数がすべて揃っているかチェック
const requiredEnv = [
    'BOT_TOKEN', 
    'CLIENT_ID', 
    'CLIENT_SECRET', 
    'GUILD_ID', 
    'ROLE_ID', 
    'SESSION_SECRET', 
    'REDIRECT_URI', 
    'RECAPTCHA_SITE_KEY', 
    'RECAPTCHA_SECRET'
];

for (const env of requiredEnv) {
    if (!process.env[env]) {
        console.error(`Error: Environment variable ${env} is missing.`);
        process.exit(1);
    }
}

// Discord Client の初期化
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Express アプリの初期化
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
}));

const PORT = process.env.PORT || 10000;

// 2. トップページ（reCAPTCHA付き認証画面：環境変数からサイトキーを埋め込む）
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ja">
        <head>
            <meta charset="UTF-8">
            <title>KuriVerify - 認証</title>
            <script src="https://www.google.com/recaptcha/api.js" async defer></script>
            <style>
                body { font-family: sans-serif; text-align: center; margin-top: 100px; background-color: #313338; color: #dbdee1; }
                .card { background-color: #2b2d31; padding: 40px; border-radius: 8px; display: inline-block; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
                .btn { margin-top: 20px; padding: 12px 24px; font-size: 16px; background-color: #5865F2; color: white; border: none; border-radius: 4px; cursor: pointer; }
                .btn:hover { background-color: #4752C4; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Discord Server Verification</h2>
                <p>サーバーへアクセスするには、ロボットチェックを完了してください。</p>
                <form action="/auth/discord" method="GET">
                    <!-- 環境変数から安全にサイトキーを挿入 -->
                    <div class="g-recaptcha" data-sitekey="${process.env.RECAPTCHA_SITE_KEY}" style="display: inline-block;"></div>
                    <br>
                    <button type="submit" class="btn">Discordでログインして認証</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// 3. reCAPTCHA検証 & Discord OAuth2へリダイレクト
app.get('/auth/discord', async (req, res) => {
    const recaptchaResponse = req.query['g-recaptcha-response'];
    if (!recaptchaResponse) {
        return res.send('ロボットチェックを完了してください。<a href="/">戻る</a>');
    }

    try {
        const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET}&response=${recaptchaResponse}`;
        const response = await axios.post(verifyUrl);

        if (response.data.success) {
            const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join`;
            return res.redirect(discordAuthUrl);
        } else {
            return res.send('ロボットチェックに失敗しました。<a href="/">もう一度試す</a>');
        }
    } catch (err) {
        console.error('reCAPTCHA検証エラー:', err);
        return res.send('エラーが発生しました。');
    }
});

// 4. Discord OAuth2 コールバック処理（ロール付与・詳細エラーログ出力版）
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('認証コードがありません。');

    try {
        console.log('--- OAuth2コールバック処理開始 ---');
        
        // トークン取得
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
        console.log('アクセストークン取得成功');

        // ユーザー情報取得
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const userId = userResponse.data.id;
        console.log(`ユーザーID取得成功: ${userId}`);

        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        
        // サーバーへユーザーを追加 (guilds.joinスコープ)
        await axios.put(`https://discord.com/api/guilds/${process.env.GUILD_ID}/members/${userId}`, {
            access_token: accessToken
        }, {
            headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` }
        }).catch(err => {
            console.log('メンバー追加APIのレスポンス（既にいる場合はエラーになりますが通常続行します）:', err.response?.data || err.message);
        });

        // メンバー情報とロール付与
        const member = await guild.members.fetch(userId);
        if (member) {
            await member.roles.add(process.env.ROLE_ID);
            console.log(`ユーザー ${userId} にロール ${process.env.ROLE_ID} を付与しました！`);
        } else {
            console.error('メンバーの取得に失敗しました');
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="ja">
            <head><meta charset="UTF-8"><title>認証成功</title></head>
            <body style="font-family: sans-serif; text-align: center; margin-top: 100px; background-color: #313338; color: #dbdee1;">
                <h2>認証が成功しました！</h2>
                <p>Discordサーバーに戻ってロールが付与されているか確認してください。</p>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('--- コールバック処理でエラー発生 ---');
        console.error(error.response?.data || error.message);
        res.status(500).send('認証処理中にエラーが発生しました。詳細はRenderのLogsをご確認ください。');
    }
});

// 5. Discord Bot: !verify コマンドで認証パネルを送信
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    if (message.content === '!verify') {
        const isAdmin = message.guild.ownerId === message.author.id || 
                        message.member.permissions.has('Administrator') || 
                        message.member.permissions.has(PermissionsBitField.Flags.Administrator);

        if (!isAdmin) {
            return message.reply('このコマンドを実行する権限がありません。').catch(() => {});
        }

        await message.delete().catch(() => {});

        const embed = new EmbedBuilder()
            .setTitle('Verification Required!')
            .setDescription('To access this server, you need to pass verification first.\nClick on the Verify button below to start.')
            .setColor(0x5865F2);

        const verifyButton = new ButtonBuilder()
            .setLabel('Verify')
            .setStyle(ButtonStyle.Link)
            .setURL('https://kuriverify.onrender.com/');

        const row = new ActionRowBuilder().addComponents(verifyButton);

        await message.channel.send({ embeds: [embed], components: [row] })
            .catch(err => console.error('パネルの送信に失敗しました:', err));
    }
});

client.once('ready', () => {
    console.log(`Botがログインしました: ${client.user.tag}`);
});

app.listen(PORT, () => {
    console.log(`サーバーが起動しました (Port: ${PORT})`);
});

client.login(process.env.BOT_TOKEN);
