import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSession();
  if (!user) {
    return Response.json({ error: "Не авторизован" }, { status: 401 });
  }
  return Response.json({ user });
}
