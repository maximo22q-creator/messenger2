import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, ne } from "drizzle-orm";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Не авторизован" }, { status: 401 });
  }

  const allUsers = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(ne(users.id, session.id));

  return Response.json({ users: allUsers });
}
