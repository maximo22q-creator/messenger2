import nodemailer from "nodemailer";

let transporterPromise: Promise<nodemailer.Transporter> | null = null;

function getTransporter(): Promise<nodemailer.Transporter> {
  if (!transporterPromise) {
    transporterPromise = nodemailer.createTestAccount().then((testAccount) => {
      console.log("📧 Nodemailer test account created:", testAccount.user);
      return nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
    });
  }
  return transporterPromise;
}

export function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendVerificationEmail(
  to: string,
  code: string
): Promise<void> {
  const transporter = await getTransporter();

  const info = await transporter.sendMail({
    from: '"Messenger App" <messenger@test.com>',
    to,
    subject: `Ваш код подтверждения: ${code}`,
    text: `Ваш код подтверждения: ${code}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #6366f1;">Подтверждение регистрации</h2>
        <p>Ваш 6-значный код подтверждения:</p>
        <div style="background: #f1f5f9; border-radius: 8px; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e293b;">
          ${code}
        </div>
        <p style="color: #64748b; margin-top: 16px;">Если вы не регистрировались, проигнорируйте это письмо.</p>
      </div>
    `,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  console.log("─".repeat(60));
  console.log("📬 Письмо отправлено!");
  console.log(`📧 Кому: ${to}`);
  console.log(`🔑 Код: ${code}`);
  console.log(`🔗 Просмотр письма: ${previewUrl}`);
  console.log("─".repeat(60));
}
