import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

const SESSION_COOKIE = "messenger_session";

export async function createSession(userId: number): Promise<void> {
  // Simple token: base64 of JSON with userId and timestamp
  const token = Buffer.from(
    JSON.stringify({ userId, ts: Date.now() })
  ).toString("base64");

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    sameSite: "lax",
  });
}

export async function getSession(): Promise<{
  id: number;
  name: string;
  email: string;
} | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const data = JSON.parse(Buffer.from(token, "base64").toString("utf-8"));
    const userId = data.userId as number;

    const [user] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user ?? null;
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
