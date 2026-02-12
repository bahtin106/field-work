import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

// Загружаем переменные из .env.local
dotenv.config({ path: '.env.local' });

const testSmtpConnection = async () => {
  console.log('Testing SMTP connection...');
  console.log('Host:', process.env.SMTP_HOST);
  console.log('Port:', process.env.SMTP_PORT);
  console.log('From:', process.env.SMTP_FROM);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || '5.35.91.118',
    port: parseInt(process.env.SMTP_PORT || '25'),
    secure: false,
    tls: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('\n[1/3] Verifying connection...');
    await transporter.verify();
    console.log('✅ Connection verified!');

    console.log('\n[2/3] Sending test email...');
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@monitorapp.ru',
      to: 'test@example.com',
      subject: 'Test Email',
      html: '<h1>Test</h1><p>This is a test email</p>',
      text: 'Test email',
    });
    console.log('✅ Email sent!');
    console.log('Message ID:', info.messageId);

    console.log('\n[3/3] Checking if email is in queue on VPS...');
    console.log('Run this on VPS: mailq or postqueue -p');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nFull error:', error);
  }
};

testSmtpConnection();
