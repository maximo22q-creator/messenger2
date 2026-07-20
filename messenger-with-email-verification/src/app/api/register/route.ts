import { db } from "@/db";
import { users, verificationCodes } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { generateCode, sendVerificationEmail } from "@/lib/mailer";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, password } = body as {
      name: string;
      email: string;
      password: string;
    };

    if (!name || !email || !password) {
      return Response.json(
        { error: "Все поля обязательны" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return Response.json(
        { error: "Пароль должен быть не менее 6 символов" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing && existing.verified) {
      return Response.json(
        { error: "Пользователь с такой почтой уже зарегистрирован" },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    if (existing && !existing.verified) {
      // Update existing unverified user
      await db
        .update(users)
        .set({ name, password: hashedPassword })
        .where(eq(users.email, email));
    } else {
      // Create new user
      await db.insert(users).values({
        name,
        email,
        password: hashedPassword,
        verified: false,
      });
    }

    // Generate and store verification code
    const code = generateCode();

    // Delete old codes for this email
    await db
      .delete(verificationCodes)
      .where(eq(verificationCodes.email, email));

    await db.insert(verificationCodes).values({ email, code });

    // Send email
    await sendVerificationEmail(email, code);

    return Response.json({ success: true, email });
  } catch (err) {
    console.error("Registration error:", err);
    return Response.json(
      { error: "Ошибка сервера" },
      { status: 500 }
    );
  }
}
