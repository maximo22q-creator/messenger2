import { db } from "@/db";
import { messages, users } from "@/db/schema";
import { eq, and, or, asc } from "drizzle-orm";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Не авторизован" }, { status: 401 });
  }

  const url = new URL(request.url);
  const partnerId = parseInt(url.searchParams.get("partnerId") || "0", 10);

  if (!partnerId) {
    return Response.json({ error: "partnerId обязателен" }, { status: 400 });
  }

  const msgs = await db
    .select({
      id: messages.id,
      senderId: messages.senderId,
      receiverId: messages.receiverId,
      content: messages.content,
      createdAt: messages.createdAt,
      senderName: users.name,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(
      or(
        and(
          eq(messages.senderId, session.id),
          eq(messages.receiverId, partnerId)
        ),
        and(
          eq(messages.senderId, partnerId),
          eq(messages.receiverId, session.id)
        )
      )
    )
    .orderBy(asc(messages.createdAt));

  return Response.json({ messages: msgs });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Не авторизован" }, { status: 401 });
  }

  const body = await request.json();
  const { receiverId, content } = body as {
    receiverId: number;
    content: string;
  };

  if (!receiverId || !content?.trim()) {
    return Response.json(
      { error: "receiverId и content обязательны" },
      { status: 400 }
    );
  }

  const [msg] = await db
    .insert(messages)
    .values({
      senderId: session.id,
      receiverId,
      content: content.trim(),
    })
    .returning();

  return Response.json({ message: { ...msg, senderName: session.name } });
}
