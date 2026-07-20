import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { createSession } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body as { email: string; password: string };

    if (!email || !password) {
      return Response.json(
        { error: "Все поля обязательны" },
        { status: 400 }
      );
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return Response.json(
        { error: "Неверный email или пароль" },
        { status: 401 }
      );
    }

    if (!user.verified) {
      return Response.json(
        { error: "Аккаунт не подтверждён. Проверьте почту." },
        { status: 403 }
      );
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return Response.json(
        { error: "Неверный email или пароль" },
        { status: 401 }
      );
    }

    await createSession(user.id);

    return Response.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error("Login error:", err);
    return Response.json(
      { error: "Ошибка сервера" },
      { status: 500 }
    );
  }
}
