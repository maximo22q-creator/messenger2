import { db } from "@/db";
import { users, verificationCodes } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, code } = body as { email: string; code: string };

    if (!email || !code) {
      return Response.json(
        { error: "Email и код обязательны" },
        { status: 400 }
      );
    }

    // Find matching verification code
    const [record] = await db
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.email, email),
          eq(verificationCodes.code, code)
        )
      )
      .limit(1);

    if (!record) {
      return Response.json(
        { error: "Неверный код подтверждения" },
        { status: 400 }
      );
    }

    // Check if code is older than 10 minutes
    const codeAge = Date.now() - new Date(record.createdAt).getTime();
    if (codeAge > 10 * 60 * 1000) {
      return Response.json(
        { error: "Код истёк. Зарегистрируйтесь повторно." },
        { status: 400 }
      );
    }

    // Mark user as verified
    await db
      .update(users)
      .set({ verified: true })
      .where(eq(users.email, email));

    // Clean up codes
    await db
      .delete(verificationCodes)
      .where(eq(verificationCodes.email, email));

    return Response.json({ success: true });
  } catch (err) {
    console.error("Verification error:", err);
    return Response.json(
      { error: "Ошибка сервера" },
      { status: 500 }
    );
  }
}
