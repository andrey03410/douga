import "server-only";
import { prisma } from "@/lib/db";
import { can } from "@/lib/domain/permissions";
import { fetchGrant, freshUser, kanameEnabled, kanameEnv } from "./kaname";
import { StudioError } from "./studio/errors";
import { releaseSnapshotIfFree } from "./studio/snapshots";

export type ModerationAction = "suspend" | "restore" | "cancel" | "unpublish" | "unpublish-interactive";

export async function moderationDashboard(actorId: string) {
  const actor = await freshUser(actorId);
  if (!kanameEnabled() || !can(actor.role, "site:moderate")) throw new StudioError("FORBIDDEN");
  const rows = await prisma.kanameIdentity.findMany({
    where: { issuer: kanameEnv("KANAME_OIDC_ISSUER") }, orderBy: { login: "asc" },
    select: { userId: true, subject: true, login: true, suspended: true, user: { select: {
      _count: { select: { studioProjects: true } },
      studioJobs: { where: { status: { in: ["queued", "running"] } }, select: { id: true, kind: true, status: true } },
      studioPublications: { select: { id: true, project: { select: { title: true } } } },
      studioInteractivePublications: { select: { id: true, project: { select: { title: true } } } },
    } } },
  });
  return Promise.all(rows.map(async row => {
    const rights = await fetchGrant(row.subject).catch(error => {
      if (error.message === "FORBIDDEN") return null;
      throw error;
    });
    const manageable = !!rights && row.userId !== actorId && rights.role !== "overlord" &&
      (actor.grant?.role === "overlord" || rights.role === "user");
    return { ...row, active: !!rights, manageable };
  }));
}

export async function moderate(actorId: string, targetId: string, action: ModerationAction, resource: string) {
  if (!kanameEnabled() || actorId === targetId) throw new StudioError("FORBIDDEN");
  return prisma.$transaction(async db => {
    const actor = await freshUser(actorId, db);
    if (!can(actor.role, "site:moderate")) throw new StudioError("FORBIDDEN");
    const target = await db.kanameIdentity.findUnique({ where: { userId: targetId } });
    if (!target || target.issuer !== kanameEnv("KANAME_OIDC_ISSUER")) throw new StudioError("NOT_FOUND");
    const rights = await fetchGrant(target.subject);
    if (rights.role === "overlord" || (actor.grant?.role !== "overlord" && rights.role !== "user"))
      throw new StudioError("FORBIDDEN");
    if (action === "suspend" || action === "restore") {
      await db.kanameIdentity.update({ where: { userId: targetId }, data: { suspended: action === "suspend" } });
      if (action === "suspend") {
        await db.kanameSession.deleteMany({ where: { userId: targetId } });
        await db.studioJob.updateMany({ where: { userId: targetId, status: { in: ["running","queued"] } }, data: { status: "canceled" } });
      }
    } else if (action === "cancel") {
      const changed = await db.studioJob.updateMany({ where: { userId: targetId, id: resource, status: { in: ["queued", "running"] } }, data: { status: "canceled" } });
      if (!changed.count) throw new StudioError("NOT_FOUND");
    } else if (action === "unpublish" || action === "unpublish-interactive") {
      const where = { id: resource, userId: targetId };
      const row = action === "unpublish" ? await db.studioPublication.findFirst({ where }) : await db.studioInteractivePublication.findFirst({ where });
      if (!row) throw new StudioError("NOT_FOUND");
      if (action === "unpublish") await db.studioPublication.delete({ where: { id: row.id } });
      else await db.studioInteractivePublication.delete({ where: { id: row.id } });
      await releaseSnapshotIfFree(row.snapshotId, db);
    } else throw new StudioError("FORBIDDEN");
  });
}
