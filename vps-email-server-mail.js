import express from 'express';
import { execSync } from 'child_process';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

app.post('/send-email', async (req, res) => {
  try {
    const { type, email, firstName, lastName, resetLink } = req.body;

    if (!type || !email) {
      return res.status(400).json({ error: 'Missing required fields: type, email' });
    }

    const fullName = `${firstName || ''} ${lastName || ''}`.trim() || 'Сотрудник';
    let subject, text;

    if (type === 'invite') {
      subject = 'Приглашение в MonitorApp';
      text = `Добро пожаловать в MonitorApp!\n\nПривет, ${fullName}!\n\nВы приглашены в систему управления заказами MonitorApp.\n\nПеревейти по ссылке для установки пароля: ${resetLink}`;
    } else if (type === 'password-reset') {
      subject = 'Восстановление пароля в MonitorApp';
      text = `Восстановление пароля\n\nПривет, ${fullName}!\n\nВы запросили восстановление пароля.\n\nПеревейти по ссылке: ${resetLink}\n\nСсылка действительна 24 часа.`;
    } else {
      return res.status(400).json({ error: 'Invalid email type' });
    }

    // Создаём временный файл с письмом
    const tempFile = `/tmp/email-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.txt`;
    fs.writeFileSync(tempFile, text);

    try {
      // Отправляем через mail команду
      const cmd = `mail -s "${subject}" -r "noreply@monitorapp.ru" "${email}" < "${tempFile}"`;
      execSync(cmd, { stdio: 'pipe' });
      
      console.log(`[${new Date().toISOString()}] Email sent to ${email}: ${subject}`);
    } finally {
      // Удаляем временный файл
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {
        console.warn(`Could not delete temp file: ${tempFile}`);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Email sent successfully',
    });
  } catch (error) {
    console.error('[/send-email] Error:', error.message);
    return res.status(500).json({
      error: error.message || 'Failed to send email',
    });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Email server running on port ${PORT}`);
  console.log(`POST http://localhost:${PORT}/send-email - Send email`);
  console.log(`GET http://localhost:${PORT}/health - Health check`);
});
