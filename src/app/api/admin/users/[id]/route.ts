import { studioProtectionResponse } from "@/lib/studio-protection";
import { NextResponse } from "next/server";
import { permissionOr403, badRequest, forbidden, notFound } from "@/lib/api";
import { deleteUser, setUserRole } from "@/server/users";

function mapError(e: Error) {
  const protectedResponse=studioProtectionResponse(e);if(protectedResponse)return protectedResponse;
  switch (e.message) {
    case "NOT_FOUND":
      return notFound();
    case "SELF_CHANGE":
      return forbidden("Нельзя менять или удалять собственный аккаунт");
    case "BAD_ROLE":
      return badRequest("Неизвестная роль");
    case "ADMIN_BOOTSTRAP":
      return NextResponse.json(
        {
          error:
            "Этот email указан в ADMIN_EMAILS, поэтому при следующем входе роль снова станет «Администратор». Чтобы понизить пользователя, сначала уберите его email из ADMIN_EMAILS в .env и перезапустите сервер.",
          code: "ADMIN_BOOTSTRAP",
        },
        { status: 409 },
      );
    default:
      throw e;
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await permissionOr403("admin:users");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const role = String(body.role ?? "");
  try {
    const user = await setUserRole(auth.userId, params.id, role);
    return NextResponse.json({ id: user.id, role: user.role });
  } catch (e) {
    return mapError(e as Error);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await permissionOr403("admin:users");
  if ("response" in auth) return auth.response;
  try {
    await deleteUser(auth.userId, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mapError(e as Error);
  }
}
