import { db } from "@dokploy/server/db";
import { getRemoteDocker } from "../servers/remote-docker";

export const MISSING_IMAGE_REBUILD_TITLE = "Recover missing image";

export async function canRecoverMissingImage(applicationId: string) {
	const app = await db.query.applications.findFirst({
		where: (table, { eq }) => eq(table.applicationId, applicationId),
		columns: {
			appName: true,
			serverId: true,
			sourceType: true,
			applicationStatus: true,
		},
		with: {
			server: { columns: { sshKeyId: true } },
			deployments: {
				columns: { title: true },
				limit: 1,
				where: (table, { eq }) => eq(table.isPreviewDeployment, false),
				orderBy: (table, { desc }) => [desc(table.createdAt)],
			},
		},
	});
	if (
		app?.applicationStatus !== "done" ||
		app.sourceType === "docker" ||
		app.deployments[0]?.title === MISSING_IMAGE_REBUILD_TITLE ||
		(app.serverId && !app.server?.sshKeyId)
	)
		return false;
	const docker = await getRemoteDocker(app.serverId);
	const abortSignal = AbortSignal.timeout(15_000);
	const service = await docker.getService(app.appName).inspect({ abortSignal });
	if (!service.Spec?.Mode?.Replicated?.Replicas) return false;
	const spec = service.Spec.TaskTemplate;
	const image =
		spec && "ContainerSpec" in spec ? spec.ContainerSpec?.Image : undefined;
	if (!image) return false;
	const tasks: {
		CreatedAt: string;
		Spec?: { ContainerSpec?: { Image?: string } };
		Status?: { State?: string; Err?: string };
	}[] = await docker.listTasks({
		filters: { service: [service.ID] },
		abortSignal,
	});
	if (tasks.some((task) => task.Status?.State === "running")) return false;
	const latest = tasks.sort(
		(a, b) => Date.parse(b.CreatedAt) - Date.parse(a.CreatedAt),
	)[0];
	return (
		latest?.Spec?.ContainerSpec?.Image === image &&
		/\bNo such image:/i.test(latest?.Status?.Err ?? "")
	);
}
